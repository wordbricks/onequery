import { zValidator } from "@hono/zod-validator";
import { Result, TaggedError } from "better-result";
import type { Result as ResultType } from "better-result";
import { Hono } from "hono";
import { z } from "zod";

import { zodProblemHook } from "../problem-details/zod-problem-hook";
import type { ServerRuntimeVariables } from "../runtime-context";
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
  timestamp: z.iso.datetime(),
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

class ConnectorAuthorizationError extends TaggedError(
  "ConnectorAuthorizationError"
)<{
  message: string;
  status: 401;
}>() {
  constructor(message: string) {
    super({ message, status: 401 });
  }
}

function requireBearerAuthToken(c: {
  req: {
    header: (name: string) => string | undefined;
  };
}): ResultType<string, ConnectorAuthorizationError> {
  const authToken = readBearerToken(c.req.header("authorization"));
  if (!authToken) {
    return Result.err(
      new ConnectorAuthorizationError("Missing or invalid Authorization header")
    );
  }

  return Result.ok(authToken);
}

export const connectorsRoute = new Hono<{
  Variables: ServerRuntimeVariables & StorageVariables;
}>()
  .post(
    "/register",
    zValidator("json", connectorRegisterSchema, zodProblemHook()),
    async (c) => {
      const payload = c.req.valid("json");
      const configuredEnrollmentToken =
        c.var.runtime.connectors.enrollmentToken;
      const db = c.var.storage.db;

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
      if (auth.isErr()) {
        return c.json({ error: auth.error.message }, auth.error.status);
      }

      const db = c.var.storage.db;
      const result = await recordConnectorHeartbeat({
        authToken: auth.value,
        connectorId: c.req.param("id"),
        db,
        payload: c.req.valid("json"),
      });
      if (result.isErr()) {
        return c.json({ error: result.error.message }, result.error.status);
      }

      return c.body(null, 204);
    }
  )
  .post("/:id/jobs/next", async (c) => {
    const auth = requireBearerAuthToken(c);
    if (auth.isErr()) {
      return c.json({ error: auth.error.message }, auth.error.status);
    }

    const db = c.var.storage.db;
    const result = await pollConnectorJob({
      authToken: auth.value,
      connectorId: c.req.param("id"),
      db,
      signal: c.req.raw.signal,
    });
    if (result.isErr()) {
      return c.json({ error: result.error.message }, result.error.status);
    }

    return c.json({ job: result.value });
  });

export const connectorJobsRoute = new Hono<{
  Variables: ServerRuntimeVariables & StorageVariables;
}>()
  .post(
    "/:jobId/result",
    zValidator("json", connectorJobResultSchema, zodProblemHook()),
    async (c) => {
      const auth = requireBearerAuthToken(c);
      if (auth.isErr()) {
        return c.json({ error: auth.error.message }, auth.error.status);
      }

      const db = c.var.storage.db;
      const connector = await findConnectorIdByAuthToken({
        authToken: auth.value,
        db,
      });
      if (connector.isErr()) {
        return c.json(
          { error: connector.error.message },
          connector.error.status
        );
      }

      const result = await submitConnectorJobResult({
        authToken: auth.value,
        connectorId: connector.value,
        db,
        jobId: c.req.param("jobId"),
        payload: c.req.valid("json"),
      });
      if (result.isErr()) {
        return c.json({ error: result.error.message }, result.error.status);
      }

      return c.body(null, 204);
    }
  )
  .post(
    "/:jobId/error",
    zValidator("json", connectorJobErrorSchema, zodProblemHook()),
    async (c) => {
      const auth = requireBearerAuthToken(c);
      if (auth.isErr()) {
        return c.json({ error: auth.error.message }, auth.error.status);
      }

      const db = c.var.storage.db;
      const connector = await findConnectorIdByAuthToken({
        authToken: auth.value,
        db,
      });
      if (connector.isErr()) {
        return c.json(
          { error: connector.error.message },
          connector.error.status
        );
      }

      const result = await submitConnectorJobError({
        authToken: auth.value,
        connectorId: connector.value,
        db,
        jobId: c.req.param("jobId"),
        payload: c.req.valid("json"),
      });
      if (result.isErr()) {
        return c.json({ error: result.error.message }, result.error.status);
      }

      return c.body(null, 204);
    }
  );
