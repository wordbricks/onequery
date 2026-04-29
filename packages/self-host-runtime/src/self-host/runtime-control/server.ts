import { chmod, mkdir, rm } from "node:fs/promises";
import http2 from "node:http2";
import { dirname } from "node:path";

import type { MessageInitShape } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import type {
  ConnectRouterOptions,
  Interceptor,
  ServiceImpl,
} from "@connectrpc/connect";
import { connectNodeAdapter } from "@connectrpc/connect-node";
import { createValidateInterceptor } from "@connectrpc/validate";
import { ViolationsSchema } from "@onequery/proto-runtime/buf/validate/validate_pb";
import {
  BadRequestSchema,
  ErrorInfoSchema,
  PreconditionFailureSchema,
  ResourceInfoSchema,
  RetryInfoSchema,
} from "@onequery/proto-runtime/google/rpc/error_details_pb";
import { RuntimeControlService } from "@onequery/proto-runtime/runtime/v1/control_pb";
import { TaggedError } from "better-result";

import type { RuntimeControlEndpoint } from "../lifecycle/types";
import {
  RuntimeControlActorError,
  RuntimeControlOperationConflictError,
  RuntimeControlTargetPreconditionError,
} from "./actor";
import type { RuntimeControlActor } from "./actor";

export class RuntimeControlServerError extends TaggedError(
  "RuntimeControlServerError"
)<{
  cause: unknown;
  message: string;
  socketPath: string;
}>() {}

export interface RuntimeControlServer {
  close(): Promise<void>;
  name: "runtime-control";
  socketPath: string;
}

export const RUNTIME_CONTROL_CONNECT_MAX_MESSAGE_BYTES = 64 * 1024;
export const RUNTIME_CONTROL_CONNECT_MAX_TIMEOUT_MS = 300_000;
export const RUNTIME_CONTROL_ERROR_INFO_DOMAIN = "onequery.runtime.v1";

const RUNTIME_CONTROL_SESSION_CLOSE_GRACE_MS = 250;
const RUNTIME_CONTROL_RETRY_DELAY_MS = 250;

type RuntimeControlConnectErrorDetails = NonNullable<
  ConstructorParameters<typeof ConnectError>[3]
>;

type RuntimeControlValidationIssue = {
  field: string;
  message: string;
  reason: string;
};

const runtimeControlValidationErrorInterceptor: Interceptor =
  (next) => async (request) => {
    try {
      return await next(request);
    } catch (cause) {
      const error = ConnectError.from(cause);
      if (!shouldNormalizeRuntimeControlValidationError(error)) {
        throw error;
      }

      throw createRuntimeControlConnectError({
        cause: error.cause,
        code: Code.InvalidArgument,
        details: [
          createRuntimeControlBadRequestDetail(
            collectRuntimeControlValidationIssues(error)
          ),
        ],
        message:
          error.rawMessage.length > 0
            ? error.rawMessage
            : `invalid ${request.method.name} request`,
        metadata: {
          operation: request.method.name,
        },
        operation: request.method.name,
        reason: "RUNTIME_CONTROL_REQUEST_INVALID",
        retryable: false,
      });
    }
  };

const runtimeControlConnectRouterOptions = {
  connect: true,
  grpc: false,
  grpcWeb: false,
  interceptors: [
    runtimeControlValidationErrorInterceptor,
    createValidateInterceptor(),
  ],
  maxTimeoutMs: RUNTIME_CONTROL_CONNECT_MAX_TIMEOUT_MS,
  readMaxBytes: RUNTIME_CONTROL_CONNECT_MAX_MESSAGE_BYTES,
  requireConnectProtocolHeader: true,
  writeMaxBytes: RUNTIME_CONTROL_CONNECT_MAX_MESSAGE_BYTES,
} satisfies Pick<
  ConnectRouterOptions,
  | "connect"
  | "grpc"
  | "grpcWeb"
  | "interceptors"
  | "maxTimeoutMs"
  | "readMaxBytes"
  | "requireConnectProtocolHeader"
  | "writeMaxBytes"
>;

export async function serveRuntimeControl(input: {
  actor: RuntimeControlActor;
  endpoint: RuntimeControlEndpoint;
}): Promise<RuntimeControlServer> {
  switch (input.endpoint.transport) {
    case "unix":
      return serveUnixRuntimeControl(input.actor, input.endpoint.socketPath);
    default:
      throw new RuntimeControlServerError({
        cause: null,
        message: "unsupported runtime control transport",
        socketPath: input.endpoint.socketPath,
      });
  }
}

function createRuntimeControlConnectHandler(
  actor: RuntimeControlActor,
  shutdownSignal: AbortSignal
) {
  const implementation: ServiceImpl<typeof RuntimeControlService> = {
    async getStatus(request) {
      return mapRuntimeControlError(async () => ({
        status: await actor.getStatus(request.target),
      }));
    },
    async stop(request) {
      return mapRuntimeControlError(() => actor.stop(request));
    },
    watchStatus(request, context) {
      return mapRuntimeControlStreamError(
        actor.watchStatus(request, context.signal)
      );
    },
  };

  return connectNodeAdapter({
    ...runtimeControlConnectRouterOptions,
    shutdownSignal,
    routes(router) {
      router.service(RuntimeControlService, implementation);
    },
  });
}

async function mapRuntimeControlError<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (cause) {
    throw toRuntimeControlConnectError(cause);
  }
}

async function* mapRuntimeControlStreamError<T>(
  stream: AsyncIterable<T>
): AsyncIterable<T> {
  try {
    yield* stream;
  } catch (cause) {
    throw toRuntimeControlConnectError(cause);
  }
}

function toRuntimeControlConnectError(cause: unknown): unknown {
  if (cause instanceof RuntimeControlOperationConflictError) {
    return createRuntimeControlConnectError({
      cause,
      code: Code.InvalidArgument,
      details: [
        createRuntimeControlBadRequestDetail([
          {
            field: "operation_id",
            message: cause.message,
            reason: "OPERATION_ID_REUSE_CONFLICT",
          },
          {
            field: cause.field,
            message: `expected ${cause.expected}, got ${cause.actual}`,
            reason: "OPERATION_ID_CONFLICTING_FIELD",
          },
        ]),
        createRuntimeControlResourceInfoDetail({
          description: cause.message,
          name: cause.operationId,
          type: "onequery.runtime.control.stop_operation",
        }),
      ],
      message: cause.message,
      metadata: {
        actual: cause.actual,
        expected: cause.expected,
        field: cause.field,
        operationId: cause.operationId,
      },
      operation: cause.operation,
      reason: "RUNTIME_CONTROL_OPERATION_CONFLICT",
      retryable: false,
    });
  }

  if (cause instanceof RuntimeControlTargetPreconditionError) {
    return createRuntimeControlConnectError({
      cause,
      code: Code.FailedPrecondition,
      details: [
        createRuntimeControlPreconditionFailureDetail({
          description: cause.message,
          subject: cause.field,
          type:
            cause.field === "target"
              ? "RUNTIME_TARGET_REQUIRED"
              : "RUNTIME_TARGET_MISMATCH",
        }),
        createRuntimeControlResourceInfoDetail({
          description: cause.message,
          name: `target.${cause.field}:${cause.expected}`,
          type: "onequery.runtime.control.target",
        }),
      ],
      message: cause.message,
      metadata: {
        actual: cause.actual,
        expected: cause.expected,
        field: cause.field,
      },
      operation: cause.operation,
      reason: "RUNTIME_CONTROL_TARGET_PRECONDITION_FAILED",
      retryable: false,
    });
  }

  if (cause instanceof RuntimeControlActorError) {
    const problem = classifyRuntimeControlActorError(cause);
    return createRuntimeControlConnectError({
      cause,
      code: problem.code,
      message: cause.message,
      metadata: {
        operation: cause.operation,
      },
      operation: cause.operation,
      reason: problem.reason,
      retryAfterMs: problem.retryAfterMs,
      retryable: problem.retryable,
    });
  }

  return cause;
}

function createRuntimeControlConnectError(input: {
  cause?: unknown;
  code: Code;
  details?: RuntimeControlConnectErrorDetails;
  message: string;
  metadata?: Record<string, string>;
  operation: string;
  reason: string;
  retryAfterMs?: number;
  retryable: boolean;
}) {
  const details: RuntimeControlConnectErrorDetails = [
    createRuntimeControlErrorInfoDetail({
      metadata: input.metadata,
      operation: input.operation,
      reason: input.reason,
      retryable: input.retryable,
    }),
    ...(input.details ?? []),
  ];

  if (input.retryAfterMs !== undefined) {
    details.push(createRuntimeControlRetryInfoDetail(input.retryAfterMs));
  }

  return new ConnectError(
    input.message,
    input.code,
    undefined,
    details,
    input.cause
  );
}

function createRuntimeControlErrorInfoDetail(input: {
  metadata?: Record<string, string>;
  operation: string;
  reason: string;
  retryable: boolean;
}): RuntimeControlConnectErrorDetails[number] {
  return {
    desc: ErrorInfoSchema,
    value: {
      domain: RUNTIME_CONTROL_ERROR_INFO_DOMAIN,
      metadata: {
        component: "runtime-control",
        operation: input.operation,
        retryable: input.retryable ? "true" : "false",
        ...(input.metadata ?? {}),
      },
      reason: input.reason,
    } satisfies MessageInitShape<typeof ErrorInfoSchema>,
  };
}

function createRuntimeControlBadRequestDetail(
  issues: RuntimeControlValidationIssue[]
): RuntimeControlConnectErrorDetails[number] {
  return {
    desc: BadRequestSchema,
    value: {
      fieldViolations: issues.map((issue) => ({
        description: issue.message,
        field: issue.field,
        reason: issue.reason,
      })),
    } satisfies MessageInitShape<typeof BadRequestSchema>,
  };
}

function createRuntimeControlPreconditionFailureDetail(input: {
  description: string;
  subject: string;
  type: string;
}): RuntimeControlConnectErrorDetails[number] {
  return {
    desc: PreconditionFailureSchema,
    value: {
      violations: [
        {
          description: input.description,
          subject: input.subject,
          type: input.type,
        },
      ],
    } satisfies MessageInitShape<typeof PreconditionFailureSchema>,
  };
}

function createRuntimeControlResourceInfoDetail(input: {
  description: string;
  name: string;
  type: string;
}): RuntimeControlConnectErrorDetails[number] {
  return {
    desc: ResourceInfoSchema,
    value: {
      description: input.description,
      resourceName: input.name,
      resourceType: input.type,
    } satisfies MessageInitShape<typeof ResourceInfoSchema>,
  };
}

function createRuntimeControlRetryInfoDetail(
  retryAfterMs: number
): RuntimeControlConnectErrorDetails[number] {
  const normalizedRetryAfterMs = Math.max(0, Math.trunc(retryAfterMs));
  return {
    desc: RetryInfoSchema,
    value: {
      retryDelay: {
        nanos: (normalizedRetryAfterMs % 1000) * 1_000_000,
        seconds: BigInt(Math.trunc(normalizedRetryAfterMs / 1000)),
      },
    } satisfies MessageInitShape<typeof RetryInfoSchema>,
  };
}

function shouldNormalizeRuntimeControlValidationError(error: ConnectError) {
  return (
    error.code === Code.InvalidArgument &&
    (error.findDetails(BadRequestSchema).length > 0 ||
      error.findDetails(ViolationsSchema).length > 0) &&
    !hasRuntimeControlErrorInfo(error)
  );
}

function hasRuntimeControlErrorInfo(error: ConnectError) {
  return error
    .findDetails(ErrorInfoSchema)
    .some((detail) => detail.domain === RUNTIME_CONTROL_ERROR_INFO_DOMAIN);
}

function collectRuntimeControlValidationIssues(
  error: ConnectError
): RuntimeControlValidationIssue[] {
  return [
    ...error.findDetails(BadRequestSchema).flatMap((detail) =>
      detail.fieldViolations.map((violation) => ({
        field: violation.field,
        message: violation.description,
        reason:
          violation.reason.length > 0 ? violation.reason : "FIELD_INVALID",
      }))
    ),
    ...error.findDetails(ViolationsSchema).flatMap((detail) =>
      detail.violations.map((violation) => ({
        field:
          violation.field?.elements
            .map((element) => element.fieldName)
            .filter((value) => value.length > 0)
            .join(".") ?? "",
        message: violation.message,
        reason: toRuntimeControlDetailReason(violation.ruleId, "FIELD_INVALID"),
      }))
    ),
  ];
}

function toRuntimeControlDetailReason(value: string, fallback: string) {
  const reason = value
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();
  const normalized = reason.length > 0 ? reason : fallback;
  const bounded = normalized.slice(0, 63).replace(/_+$/g, "");
  return bounded.length >= 2 ? bounded : fallback;
}

function classifyRuntimeControlActorError(error: RuntimeControlActorError): {
  code: Code;
  reason: string;
  retryAfterMs?: number;
  retryable: boolean;
} {
  if (error.message === "runtime shutdown controller is not attached") {
    return {
      code: Code.Unavailable,
      reason: "RUNTIME_CONTROL_STARTUP_NOT_READY",
      retryAfterMs: RUNTIME_CONTROL_RETRY_DELAY_MS,
      retryable: true,
    };
  }

  if (
    error.message.startsWith("failed to send runtime control actor message")
  ) {
    return {
      code: Code.Unavailable,
      reason: "RUNTIME_CONTROL_ACTOR_UNAVAILABLE",
      retryable: false,
    };
  }

  return {
    code: Code.Internal,
    reason: "RUNTIME_CONTROL_INTERNAL",
    retryable: false,
  };
}

async function serveUnixRuntimeControl(
  actor: RuntimeControlActor,
  socketPath: string
): Promise<RuntimeControlServer> {
  await mkdir(dirname(socketPath), {
    recursive: true,
    mode: 0o700,
  });
  await rm(socketPath, {
    force: true,
  });

  const sessions = new Set<http2.ServerHttp2Session>();
  const shutdownController = new AbortController();
  const server = http2.createServer(
    createRuntimeControlConnectHandler(actor, shutdownController.signal)
  );
  server.on("session", (session) => {
    sessions.add(session);
    session.once("close", () => {
      sessions.delete(session);
    });
  });

  await listen(server, socketPath);
  await chmod(socketPath, 0o600);

  let closed = false;
  return {
    async close() {
      if (closed) {
        return;
      }

      closed = true;
      shutdownController.abort(
        new ConnectError(
          "runtime control server shutting down",
          Code.Unavailable
        )
      );
      for (const session of sessions) {
        session.close();
      }

      const destroyTimer = setTimeout(() => {
        for (const session of sessions) {
          session.destroy();
        }
      }, RUNTIME_CONTROL_SESSION_CLOSE_GRACE_MS);
      destroyTimer.unref();
      try {
        await closeServer(server, socketPath);
      } finally {
        clearTimeout(destroyTimer);
        for (const session of sessions) {
          session.destroy();
        }
      }
      await rm(socketPath, {
        force: true,
      });
    },
    name: "runtime-control",
    socketPath,
  };
}

function listen(server: http2.Http2Server, socketPath: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const handleError = (cause: unknown) => {
      cleanup();
      reject(
        new RuntimeControlServerError({
          cause,
          message: `failed to listen on runtime control socket ${socketPath}`,
          socketPath,
        })
      );
    };
    const handleListening = () => {
      cleanup();
      resolve();
    };
    const cleanup = () => {
      server.off("error", handleError);
      server.off("listening", handleListening);
    };

    server.once("error", handleError);
    server.once("listening", handleListening);
    server.listen(socketPath);
  });
}

function closeServer(
  server: http2.Http2Server,
  socketPath: string
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    server.close((cause) => {
      if (cause) {
        reject(
          new RuntimeControlServerError({
            cause,
            message: `failed to close runtime control socket ${socketPath}`,
            socketPath,
          })
        );
        return;
      }

      resolve();
    });
  });
}
