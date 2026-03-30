import { z } from "zod";

import type { Logger } from "./logger";
import type {
  AthenaQueryErrorResult,
  AthenaQueryJob,
  AthenaQuerySuccessResult,
  ConnectorSession,
  HeartbeatPayload,
} from "./types";

const registerResponseSchema = z.object({
  authToken: z.string(),
  connectorId: z.string(),
});

const nextJobEnvelopeSchema = z.object({
  job: z
    .object({
      database: z.string(),
      jobId: z.string(),
      maxRows: z.number().int().positive().optional(),
      sql: z.string(),
      timeoutMs: z.number().int().positive().optional(),
      type: z.literal("athena_query"),
      workgroup: z.string().optional(),
    })
    .nullable(),
});

const nextJobDirectSchema = z.object({
  database: z.string(),
  jobId: z.string(),
  maxRows: z.number().int().positive().optional(),
  sql: z.string(),
  timeoutMs: z.number().int().positive().optional(),
  type: z.literal("athena_query"),
  workgroup: z.string().optional(),
});

export class OneQueryHttpError extends Error {
  readonly status: number;
  readonly responseBody: string;

  constructor(input: {
    status: number;
    message: string;
    responseBody: string;
  }) {
    super(input.message);
    this.name = "OneQueryHttpError";
    this.status = input.status;
    this.responseBody = input.responseBody;
  }
}

export class OneQueryClient {
  readonly #baseUrl: string;
  readonly #logger: Logger;

  constructor(input: { baseUrl: string; logger: Logger }) {
    this.#baseUrl = input.baseUrl;
    this.#logger = input.logger;
  }

  async register(input: {
    enrollmentToken: string;
    organizationId: string;
    connectorName: string;
    awsRegion: string;
  }): Promise<ConnectorSession> {
    const body = {
      connectorName: input.connectorName,
      enrollmentToken: input.enrollmentToken,
      metadata: {
        version: "0.0.1",
        runtime: "bun",
        awsRegion: input.awsRegion,
      },
      organizationId: input.organizationId,
    };

    const raw = await this.#requestJson("/connectors/register", {
      body,
      method: "POST",
    });

    const normalized = normalizeRegisterResponse(raw);
    const parsed = registerResponseSchema.safeParse(normalized);
    if (!parsed.success) {
      throw new Error(
        `Invalid register response payload: ${parsed.error.issues
          .map((issue) => issue.message)
          .join(", ")}`
      );
    }

    return parsed.data;
  }

  async heartbeat(input: {
    session: ConnectorSession;
    payload: HeartbeatPayload;
  }): Promise<void> {
    await this.#requestJson(
      `/connectors/${input.session.connectorId}/heartbeat`,
      {
        authToken: input.session.authToken,
        body: input.payload,
        method: "POST",
      }
    );
  }

  async pollNextJob(input: {
    session: ConnectorSession;
  }): Promise<AthenaQueryJob | null> {
    const raw = await this.#requestJson(
      `/connectors/${input.session.connectorId}/jobs/next`,
      {
        authToken: input.session.authToken,
        body: {},
        method: "POST",
      }
    );

    if (raw === null || raw === undefined) {
      return null;
    }

    const envelopeParse = nextJobEnvelopeSchema.safeParse(raw);
    if (envelopeParse.success) {
      return envelopeParse.data.job;
    }

    const directParse = nextJobDirectSchema.safeParse(raw);
    if (directParse.success) {
      return directParse.data;
    }

    this.#logger.warn("connector.job_payload.invalid", {
      details: envelopeParse.error.issues
        .map((issue) => issue.message)
        .join(", "),
    });
    return null;
  }

  async submitResult(input: {
    session: ConnectorSession;
    payload: AthenaQuerySuccessResult;
  }): Promise<void> {
    await this.#requestJson(`/jobs/${input.payload.jobId}/result`, {
      authToken: input.session.authToken,
      body: input.payload,
      method: "POST",
    });
  }

  async submitError(input: {
    session: ConnectorSession;
    payload: AthenaQueryErrorResult;
  }): Promise<void> {
    await this.#requestJson(`/jobs/${input.payload.jobId}/error`, {
      authToken: input.session.authToken,
      body: input.payload,
      method: "POST",
    });
  }

  async #requestJson(
    path: string,
    input: {
      method: "POST" | "GET";
      authToken?: string;
      body?: unknown;
    }
  ): Promise<unknown> {
    const headers = new Headers({
      "content-type": "application/json",
    });

    if (input.authToken) {
      headers.set("authorization", `Bearer ${input.authToken}`);
    }

    const response = await fetch(`${this.#baseUrl}${path}`, {
      body: JSON.stringify(input.body),
      headers,
      method: input.method,
    });

    if (!response.ok) {
      const responseBody = await response.text();
      throw new OneQueryHttpError({
        message: `OneQuery API request failed: ${input.method} ${path} -> ${response.status}`,
        responseBody,
        status: response.status,
      });
    }

    if (response.status === 204) {
      return null;
    }

    const text = await response.text();
    if (!text) {
      return null;
    }

    return JSON.parse(text);
  }
}

function normalizeRegisterResponse(value: unknown): {
  connectorId: string | undefined;
  authToken: string | undefined;
} {
  if (!isRecord(value)) {
    return {
      authToken: undefined,
      connectorId: undefined,
    };
  }

  // Comment: the spec requires connector id and auth token but does not lock the exact
  // response field names; this normalization keeps the connector tolerant during early MVP.
  const connectorFromNested = isRecord(value.connector)
    ? value.connector.id
    : undefined;

  return {
    authToken: toOptionalString(
      value.authToken ?? value.token ?? value.connectorToken ?? value.secret
    ),
    connectorId: toOptionalString(
      value.connectorId ?? value.id ?? connectorFromNested
    ),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
