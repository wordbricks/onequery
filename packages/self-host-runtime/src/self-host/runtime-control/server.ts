import { chmod, lstat, mkdir, rm } from "node:fs/promises";
import http2 from "node:http2";
import net from "node:net";
import { dirname } from "node:path";

import type { MessageInitShape } from "@bufbuild/protobuf";
import { Code, ConnectError, createClient } from "@connectrpc/connect";
import type {
  ConnectRouterOptions,
  Interceptor,
  ServiceImpl,
} from "@connectrpc/connect";
import {
  connectNodeAdapter,
  createConnectTransport,
} from "@connectrpc/connect-node";
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
  endpoint?: string;
  message: string;
  socketPath?: string;
}>() {}

export interface RuntimeControlServer {
  close(): Promise<void>;
  endpoint: RuntimeControlEndpoint;
  name: "runtime-control";
}

export const RUNTIME_CONTROL_CONNECT_MAX_MESSAGE_BYTES = 64 * 1024;
export const RUNTIME_CONTROL_CONNECT_MAX_TIMEOUT_MS = 300_000;
export const RUNTIME_CONTROL_ERROR_INFO_DOMAIN = "onequery.runtime.v1";

const RUNTIME_CONTROL_SESSION_CLOSE_GRACE_MS = 250;
const RUNTIME_CONTROL_RETRY_DELAY_MS = 250;
const RUNTIME_CONTROL_SOCKET_PROBE_TIMEOUT_MS = 250;

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
  switch (input.endpoint.transport.kind) {
    case "unix":
      return serveUnixRuntimeControl(
        input.actor,
        input.endpoint,
        input.endpoint.transport.socketPath
      );
    case "loopback-h2c":
    case "windows-named-pipe":
      throw disabledNonUnixRuntimeControlTransportError(
        input.endpoint.transport
      );
  }
}

function disabledNonUnixRuntimeControlTransportError(
  transport: Extract<
    RuntimeControlEndpoint["transport"],
    { kind: "loopback-h2c" | "windows-named-pipe" }
  >
): RuntimeControlServerError {
  const missing = missingNonUnixRuntimeControlSecurity(transport);

  if (missing.length > 0) {
    return new RuntimeControlServerError({
      cause: null,
      endpoint: describeRuntimeControlTransport(transport),
      message: `runtime control ${transport.kind} transport requires launch-scoped bearer auth and fencing metadata before it can be enabled (missing ${missing.join(", ")})`,
    });
  }

  return new RuntimeControlServerError({
    cause: null,
    endpoint: describeRuntimeControlTransport(transport),
    message: `runtime control ${transport.kind} transport is not enabled by this runtime`,
  });
}

function missingNonUnixRuntimeControlSecurity(
  transport: Extract<
    RuntimeControlEndpoint["transport"],
    { kind: "loopback-h2c" | "windows-named-pipe" }
  >
): string[] {
  const missing: string[] = [];
  if (
    !transport.auth ||
    transport.auth.kind !== "bearer" ||
    transport.auth.token.trim().length === 0
  ) {
    missing.push("auth");
  }
  if (!transport.fencing || transport.fencing.launchId.trim().length === 0) {
    missing.push("launchId");
  }
  if (!transport.fencing || transport.fencing.dataDir.trim().length === 0) {
    missing.push("dataDir");
  }

  return missing;
}

function describeRuntimeControlTransport(
  transport: RuntimeControlEndpoint["transport"]
): string {
  switch (transport.kind) {
    case "unix":
      return transport.socketPath;
    case "loopback-h2c":
      return `${transport.host}:${transport.port}`;
    case "windows-named-pipe":
      return transport.pipeName;
  }
}

function createRuntimeControlConnectHandler(actor: RuntimeControlActor) {
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
  endpoint: RuntimeControlEndpoint,
  socketPath: string
): Promise<RuntimeControlServer> {
  await mkdir(dirname(socketPath), {
    recursive: true,
    mode: 0o700,
  });
  await verifyRuntimeControlSocketParentDirectory(socketPath);
  await removeUnreachableRuntimeControlSocket(actor, socketPath);

  const sessions = new Set<http2.ServerHttp2Session>();
  const server = http2.createServer(createRuntimeControlConnectHandler(actor));
  server.on("session", (session) => {
    sessions.add(session);
    session.once("close", () => {
      sessions.delete(session);
    });
  });

  await listen(server, socketPath);
  await chmod(socketPath, 0o600);
  await verifyRuntimeControlSocketMode(socketPath);

  let closed = false;
  return {
    async close() {
      if (closed) {
        return;
      }

      closed = true;
      await closeRuntimeControlStatusWatches(actor);
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
    endpoint,
    name: "runtime-control",
  };
}

async function closeRuntimeControlStatusWatches(
  actor: RuntimeControlActor
): Promise<void> {
  try {
    await actor.closeStatusWatches();
  } catch {
    // Closing sessions below is the bounded fallback when the actor is already
    // unavailable during shutdown.
  }
}

async function verifyRuntimeControlSocketParentDirectory(
  socketPath: string
): Promise<void> {
  const parentDir = dirname(socketPath);
  const stat = await lstat(parentDir).catch((cause: unknown) => {
    throw new RuntimeControlServerError({
      cause,
      message: `failed to inspect runtime control socket parent directory ${parentDir}`,
      socketPath,
    });
  });

  if (!stat.isDirectory()) {
    throw new RuntimeControlServerError({
      cause: null,
      message: `runtime control socket parent ${parentDir} exists but is not a directory`,
      socketPath,
    });
  }

  const currentUid = process.getuid?.();
  if (currentUid !== undefined && stat.uid !== currentUid) {
    throw new RuntimeControlServerError({
      cause: null,
      message: `runtime control socket parent ${parentDir} is owned by uid ${stat.uid}; expected current uid ${currentUid}`,
      socketPath,
    });
  }

  const sharedMode = stat.mode & 0o077;
  if (sharedMode !== 0) {
    throw new RuntimeControlServerError({
      cause: null,
      message: `runtime control socket parent ${parentDir} must not be accessible by group or others`,
      socketPath,
    });
  }
}

async function verifyRuntimeControlSocketMode(
  socketPath: string
): Promise<void> {
  const stat = await lstat(socketPath).catch((cause: unknown) => {
    throw new RuntimeControlServerError({
      cause,
      message: `failed to inspect runtime control socket ${socketPath}`,
      socketPath,
    });
  });

  if (!stat.isSocket()) {
    throw new RuntimeControlServerError({
      cause: null,
      message: `runtime control path ${socketPath} exists but is not a Unix socket`,
      socketPath,
    });
  }

  const permissions = stat.mode & 0o777;
  if (permissions !== 0o600) {
    throw new RuntimeControlServerError({
      cause: null,
      message: `runtime control socket ${socketPath} must have mode 0600`,
      socketPath,
    });
  }
}

async function removeUnreachableRuntimeControlSocket(
  actor: RuntimeControlActor,
  socketPath: string
): Promise<void> {
  const existing = await inspectExistingRuntimeControlSocket(actor, socketPath);

  switch (existing.kind) {
    case "absent":
      return;
    case "unreachable":
      await rm(socketPath, {
        force: true,
      });
      return;
    case "reachable":
      throw new RuntimeControlServerError({
        cause: null,
        message: existing.matchesExpected
          ? `runtime control socket ${socketPath} is already reachable for current launch ${existing.actual.launchId}`
          : `runtime control socket ${socketPath} is already reachable for launch ${existing.actual.launchId}; expected ${existing.expected.launchId}`,
        socketPath,
      });
  }
}

type RuntimeControlSocketInspection =
  | {
      kind: "absent" | "unreachable";
    }
  | {
      actual: RuntimeControlSocketIdentity;
      expected: RuntimeControlSocketIdentity;
      kind: "reachable";
      matchesExpected: boolean;
    };

type RuntimeControlSocketIdentity = {
  dataDir: string;
  launchId: string;
  pid: number;
};

async function inspectExistingRuntimeControlSocket(
  actor: RuntimeControlActor,
  socketPath: string
): Promise<RuntimeControlSocketInspection> {
  const stat = await lstat(socketPath).catch((cause: unknown) => {
    if (isErrnoException(cause) && cause.code === "ENOENT") {
      return null;
    }

    throw new RuntimeControlServerError({
      cause,
      message: `failed to inspect runtime control socket ${socketPath}`,
      socketPath,
    });
  });
  if (stat === null) {
    return {
      kind: "absent",
    };
  }
  if (!stat.isSocket()) {
    throw new RuntimeControlServerError({
      cause: null,
      message: `runtime control path ${socketPath} exists but is not a Unix socket`,
      socketPath,
    });
  }

  const reachable = await runtimeControlSocketAcceptsConnection(socketPath);
  if (!reachable) {
    return {
      kind: "unreachable",
    };
  }

  const [expectedStatus, actualStatus] = await Promise.all([
    actor.getStatus(),
    getRuntimeControlStatusFromSocket(socketPath),
  ]);
  const expected = runtimeControlSocketIdentity(expectedStatus);
  const actual = runtimeControlSocketIdentity(actualStatus);

  return {
    actual,
    expected,
    kind: "reachable",
    matchesExpected: runtimeControlSocketIdentityMatches(actual, expected),
  };
}

function runtimeControlSocketAcceptsConnection(
  socketPath: string
): Promise<boolean> {
  return new Promise<boolean>((resolve, reject) => {
    const socket = net.connect(socketPath);
    const timeout = setTimeout(() => {
      cleanup();
      socket.destroy();
      resolve(false);
    }, RUNTIME_CONTROL_SOCKET_PROBE_TIMEOUT_MS);
    timeout.unref();

    const cleanup = () => {
      clearTimeout(timeout);
      socket.off("connect", handleConnect);
      socket.off("error", handleError);
    };
    const handleConnect = () => {
      cleanup();
      socket.end();
      resolve(true);
    };
    const handleError = (cause: unknown) => {
      cleanup();
      socket.destroy();
      if (
        isErrnoException(cause) &&
        (cause.code === "ENOENT" || cause.code === "ECONNREFUSED")
      ) {
        resolve(false);
        return;
      }

      reject(cause);
    };

    socket.once("connect", handleConnect);
    socket.once("error", handleError);
  });
}

async function getRuntimeControlStatusFromSocket(socketPath: string) {
  const client = createClient(
    RuntimeControlService,
    createConnectTransport({
      baseUrl: "http://onequery-runtime",
      httpVersion: "2",
      nodeOptions: {
        createConnection: () => net.connect(socketPath),
      },
    })
  );
  const abort = new AbortController();
  const timeout = setTimeout(() => {
    abort.abort();
  }, RUNTIME_CONTROL_SOCKET_PROBE_TIMEOUT_MS);
  timeout.unref();

  try {
    const response = await client.getStatus({}, { signal: abort.signal });
    if (!response.status) {
      throw new RuntimeControlServerError({
        cause: response,
        message: `runtime control socket ${socketPath} returned no status`,
        socketPath,
      });
    }

    return response.status;
  } catch (cause) {
    if (cause instanceof RuntimeControlServerError) {
      throw cause;
    }

    throw new RuntimeControlServerError({
      cause,
      message: `runtime control socket ${socketPath} is reachable but did not return runtime status`,
      socketPath,
    });
  } finally {
    clearTimeout(timeout);
  }
}

function runtimeControlSocketIdentity(
  status: NonNullable<Awaited<ReturnType<RuntimeControlActor["getStatus"]>>>
): RuntimeControlSocketIdentity {
  const identity = status.identity;
  return {
    dataDir: identity?.dataDir ?? "",
    launchId: identity?.launchId ?? "",
    pid: identity?.pid ?? 0,
  };
}

function runtimeControlSocketIdentityMatches(
  actual: RuntimeControlSocketIdentity,
  expected: RuntimeControlSocketIdentity
): boolean {
  return (
    actual.dataDir === expected.dataDir &&
    actual.launchId === expected.launchId &&
    actual.pid === expected.pid
  );
}

function isErrnoException(cause: unknown): cause is NodeJS.ErrnoException {
  return cause instanceof Error && "code" in cause;
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
