import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";

import type { ServerEnv } from "../env";
import { zodProblemHook } from "../problem-details/zod-problem-hook";
import {
  findConnectorIdByAuthToken,
  pollConnectorJob,
  readBearerToken,
  recordConnectorHeartbeat,
  registerConnector,
  submitConnectorJobError,
  submitConnectorJobResult,
} from "../services/connectors/broker";
import type { StorageVariables } from "../storage";

const connectorRegisterSchema = z.object({
  connectorName: z.string().min(1),
  enrollmentToken: z.string().min(1),
  metadata: z
    .object({
      version: z.string().optional(),
      runtime: z.string().optional(),
      awsRegion: z.string().optional(),
    })
    .optional(),
  organizationId: z.string().min(1),
});

const connectorHeartbeatSchema = z.object({
  metadata: z
    .record(
      z.string(),
      z.union([z.string(), z.number(), z.boolean(), z.null()])
    )
    .optional(),
  status: z.enum(["healthy", "degraded"]),
  timestamp: z.string().datetime(),
});

const connectorJobResultSchema = z.object({
  columns: z.array(
    z.object({
      name: z.string().min(1),
      type: z.string().min(1),
    })
  ),
  jobId: z.string().min(1),
  rows: z.array(z.array(z.string())),
  stats: z
    .object({
      executionTimeMs: z.number().int().positive().optional(),
      rowCount: z.number().int().nonnegative().optional(),
      dataScannedBytes: z.string().min(1).optional(),
      queryExecutionId: z.string().min(1).optional(),
    })
    .optional(),
  status: z.literal("success"),
});

const connectorJobErrorSchema = z.object({
  error: z.object({
    code: z.string().min(1),
    message: z.string().min(1),
  }),
  jobId: z.string().min(1),
  status: z.literal("error"),
});

function requireBearerAuthToken(c: {
  req: {
    header: (name: string) => string | undefined;
  };
}) {
  const authToken = readBearerToken(c.req.header("authorization"));
  if (!authToken) {
    return {
      ok: false as const,
      response: { error: "Missing or invalid Authorization header" },
    };
  }

  return {
    authToken,
    ok: true as const,
  };
}

export const connectorsRoute = new Hono<{
  Bindings: ServerEnv;
  Variables: StorageVariables;
}>()
  .post(
    "/register",
    zValidator("json", connectorRegisterSchema, zodProblemHook()),
    async (c) => {
      const payload = c.req.valid("json");
      const configuredEnrollmentToken = c.env.CONNECTOR_ENROLLMENT_TOKEN;
      const db = c.var.storage.db;

      if (!configuredEnrollmentToken) {
        console.error("CONNECTOR_ENROLLMENT_TOKEN is not configured");
        return c.json({ error: "Connector enrollment is not configured" }, 503);
      }

      if (payload.enrollmentToken !== configuredEnrollmentToken) {
        return c.json({ error: "Invalid enrollment token" }, 401);
      }

      const { connectorId, authToken } = await registerConnector({
        connectorName: payload.connectorName,
        db,
        metadata: payload.metadata,
        organizationId: payload.organizationId,
      });

      console.info("[connector] registered", {
        awsRegion: payload.metadata?.awsRegion,
        connectorId,
        connectorName: payload.connectorName,
        organizationId: payload.organizationId,
        runtime: payload.metadata?.runtime,
        version: payload.metadata?.version,
      });

      return c.json({ authToken, connectorId }, 201);
    }
  )
  .post(
    "/:id/heartbeat",
    zValidator("json", connectorHeartbeatSchema, zodProblemHook()),
    async (c) => {
      const auth = requireBearerAuthToken(c);
      if (!auth.ok) {
        return c.json(auth.response, 401);
      }

      const db = c.var.storage.db;
      const result = await recordConnectorHeartbeat({
        authToken: auth.authToken,
        connectorId: c.req.param("id"),
        db,
        payload: c.req.valid("json"),
      });
      if (!result.ok) {
        return c.json({ error: result.error }, result.status);
      }

      return c.body(null, 204);
    }
  )
  .post("/:id/jobs/next", async (c) => {
    const auth = requireBearerAuthToken(c);
    if (!auth.ok) {
      return c.json(auth.response, 401);
    }

    const db = c.var.storage.db;
    const result = await pollConnectorJob({
      authToken: auth.authToken,
      connectorId: c.req.param("id"),
      db,
      signal: c.req.raw.signal,
    });
    if (!result.ok) {
      return c.json({ error: result.error }, result.status);
    }

    return c.json({ job: result.job });
  });

export const connectorJobsRoute = new Hono<{
  Bindings: ServerEnv;
  Variables: StorageVariables;
}>()
  .post(
    "/:jobId/result",
    zValidator("json", connectorJobResultSchema, zodProblemHook()),
    async (c) => {
      const auth = requireBearerAuthToken(c);
      if (!auth.ok) {
        return c.json(auth.response, 401);
      }

      const db = c.var.storage.db;
      const connectorId = await findConnectorIdByAuthToken({
        authToken: auth.authToken,
        db,
      });
      if (!connectorId) {
        return c.json({ error: "Invalid connector token" }, 401);
      }

      const result = await submitConnectorJobResult({
        authToken: auth.authToken,
        connectorId,
        db,
        jobId: c.req.param("jobId"),
        payload: c.req.valid("json"),
      });
      if (!result.ok) {
        return c.json({ error: result.error }, result.status);
      }

      return c.body(null, 204);
    }
  )
  .post(
    "/:jobId/error",
    zValidator("json", connectorJobErrorSchema, zodProblemHook()),
    async (c) => {
      const auth = requireBearerAuthToken(c);
      if (!auth.ok) {
        return c.json(auth.response, 401);
      }

      const db = c.var.storage.db;
      const connectorId = await findConnectorIdByAuthToken({
        authToken: auth.authToken,
        db,
      });
      if (!connectorId) {
        return c.json({ error: "Invalid connector token" }, 401);
      }

      const result = await submitConnectorJobError({
        authToken: auth.authToken,
        connectorId,
        db,
        jobId: c.req.param("jobId"),
        payload: c.req.valid("json"),
      });
      if (!result.ok) {
        return c.json({ error: result.error }, result.status);
      }

      return c.body(null, 204);
    }
  );
