import { Code, ConnectError, createConnectRouter } from "@connectrpc/connect";
import type { Interceptor } from "@connectrpc/connect";
import {
  universalServerRequestFromFetch,
  universalServerResponseToFetch,
} from "@connectrpc/connect/protocol";
import { createValidateInterceptor } from "@connectrpc/validate";

import { createCliApp } from "../app";
import type { CreateCliAppOptions } from "../app";
import { CLI_REQUEST_ID_HEADER, getCliRequestId } from "../error";
import { createCliConnectContextValues } from "./context";
import { ViolationsSchema } from "./gen/buf/validate/validate_pb";
import { CliService } from "./gen/onequery/cli/v1/cli_pb";
import {
  CliProblemCode,
  CliProblemDetailSchema,
  CliProblemStage,
} from "./gen/onequery/cli/v1/error_details_pb";
import { createCliService } from "./service";

type CliProblemExtensions = {
  code?: unknown;
  stage?: unknown;
  requestId?: unknown;
  retryable?: unknown;
  hint?: unknown;
  retryAfterMs?: unknown;
  errors?: unknown;
};

type CliProblemDetailsPayload = {
  status: number;
  title?: string;
  detail?: string;
  extensions?: CliProblemExtensions;
};

type CliProblemError = Error & {
  problemDetails: CliProblemDetailsPayload;
};

const cliProblemInterceptor: Interceptor = (next) => async (request) => {
  try {
    return await next(request);
  } catch (reason) {
    const honoContext = request.contextValues.get(
      createCliConnectContextValuesKey
    );
    const requestId = honoContext ? getCliRequestId(honoContext) : "unknown";

    if (isCliProblemError(reason)) {
      throw toConnectProblemError(reason, requestId, request.method.name);
    }

    const connectError = ConnectError.from(reason);
    if (connectError.findDetails(CliProblemDetailSchema).length > 0) {
      throw withRequestIdMetadata(connectError, requestId);
    }

    if (connectError.code === Code.InvalidArgument) {
      throw withCliInvalidRequestDetail(
        connectError,
        requestId,
        request.method.name
      );
    }

    throw withRequestIdMetadata(connectError, requestId);
  }
};

const createCliConnectContextValuesKey = {
  get(contextValues: ReturnType<typeof createCliConnectContextValues>) {
    return contextValues.get(
      // createCliConnectContextValues() always stores the Hono context on the
      // sole key used by this module.
      [...(contextValues.keys?.() ?? [])][0] as never
    );
  },
};

export function createCliConnectRoute(input: CreateCliAppOptions) {
  const app = createCliApp(input);
  const router = createConnectRouter({
    connect: true,
    grpc: false,
    grpcWeb: false,
    interceptors: [cliProblemInterceptor, createValidateInterceptor()],
  });
  router.service(CliService, createCliService());

  for (const handler of router.handlers) {
    app.all(handler.requestPath, async (c) => {
      const request = universalServerRequestFromFetch(c.req.raw, {
        httpVersion: "1.1",
      });
      request.contextValues = createCliConnectContextValues(c);

      const response = universalServerResponseToFetch(await handler(request));
      response.headers.set(CLI_REQUEST_ID_HEADER, getCliRequestId(c));
      return response;
    });
  }

  return app;
}

function isCliProblemError(value: unknown): value is CliProblemError {
  return (
    value instanceof Error &&
    "problemDetails" in value &&
    typeof value.problemDetails === "object" &&
    value.problemDetails !== null &&
    "status" in value.problemDetails &&
    typeof value.problemDetails.status === "number"
  );
}

function toConnectProblemError(
  error: CliProblemError,
  requestId: string,
  methodName: string
) {
  const problem = error.problemDetails;
  const extensions = problem.extensions;
  const metadata = new Headers();
  metadata.set(CLI_REQUEST_ID_HEADER, requestId);

  return new ConnectError(
    problem.detail ?? problem.title ?? "",
    httpStatusToCode(problem.status),
    metadata,
    [
      {
        desc: CliProblemDetailSchema,
        value: {
          code: toCliProblemCode(extensions?.code),
          stage: toCliProblemStage(
            extensions?.stage,
            defaultProblemStageForMethod(methodName)
          ),
          requestId,
          retryable: extensions?.retryable === true,
          ...(typeof extensions?.hint === "string"
            ? { hint: extensions.hint }
            : {}),
          ...(typeof extensions?.retryAfterMs === "number"
            ? { retryAfterMs: extensions.retryAfterMs }
            : {}),
          errors: parseCliProblemValidationIssues(extensions?.errors),
        },
      },
    ],
    error
  );
}

function withCliInvalidRequestDetail(
  error: ConnectError,
  requestId: string,
  methodName: string
) {
  const metadata = new Headers(error.metadata);
  metadata.set(CLI_REQUEST_ID_HEADER, requestId);

  return new ConnectError(
    error.rawMessage,
    error.code,
    metadata,
    [
      ...error.details,
      {
        desc: CliProblemDetailSchema,
        value: {
          code: CliProblemCode.INVALID_REQUEST,
          stage: defaultProblemStageForMethod(methodName),
          requestId,
          retryable: false,
          errors: error
            .findDetails(ViolationsSchema)
            .flatMap((detail) => detail.violations)
            .map((violation) => ({
              field: violation.field?.elements
                .map((element) => {
                  const base = element.fieldName;
                  switch (element.subscript.case) {
                    case "index":
                      return `${base}[${element.subscript.value}]`;
                    case "boolKey":
                    case "intKey":
                    case "uintKey":
                    case "stringKey":
                      return `${base}[${String(element.subscript.value)}]`;
                    case undefined:
                      return base;
                    default:
                      return base;
                  }
                })
                .filter((element) => element.length > 0)
                .join("."),
              message: violation.message,
              code: violation.ruleId || "invalid",
            })),
        },
      },
    ],
    error.cause ?? error
  );
}

function withRequestIdMetadata(error: ConnectError, requestId: string) {
  const metadata = new Headers(error.metadata);
  metadata.set(CLI_REQUEST_ID_HEADER, requestId);
  return new ConnectError(
    error.rawMessage,
    error.code,
    metadata,
    error.details,
    error.cause ?? error
  );
}

function parseCliProblemValidationIssues(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((issue) => {
    if (
      typeof issue !== "object" ||
      issue === null ||
      typeof issue.field !== "string" ||
      typeof issue.message !== "string" ||
      typeof issue.code !== "string"
    ) {
      return [];
    }

    return [
      {
        field: issue.field,
        message: issue.message,
        code: issue.code,
      },
    ];
  });
}

function httpStatusToCode(status: number) {
  switch (status) {
    case 400:
    case 422:
      return Code.InvalidArgument;
    case 401:
      return Code.Unauthenticated;
    case 403:
      return Code.PermissionDenied;
    case 404:
      return Code.NotFound;
    case 409:
      return Code.AlreadyExists;
    case 410:
      return Code.FailedPrecondition;
    case 429:
      return Code.ResourceExhausted;
    case 503:
      return Code.Unavailable;
    case 504:
      return Code.DeadlineExceeded;
    default:
      return status >= 500 ? Code.Internal : Code.Unknown;
  }
}

function toCliProblemCode(value: unknown) {
  switch (value) {
    case "forbidden":
      return CliProblemCode.FORBIDDEN;
    case "invalid_request":
      return CliProblemCode.INVALID_REQUEST;
    case "login_denied":
      return CliProblemCode.LOGIN_DENIED;
    case "login_rate_limited":
      return CliProblemCode.LOGIN_RATE_LIMITED;
    case "login_session_expired":
      return CliProblemCode.LOGIN_SESSION_EXPIRED;
    case "not_logged_in":
      return CliProblemCode.NOT_LOGGED_IN;
    case "org_not_found":
      return CliProblemCode.ORG_NOT_FOUND;
    case "query_execution_failed":
      return CliProblemCode.QUERY_EXECUTION_FAILED;
    case "query_execution_timed_out":
      return CliProblemCode.QUERY_EXECUTION_TIMED_OUT;
    case "query_execution_unavailable":
      return CliProblemCode.QUERY_EXECUTION_UNAVAILABLE;
    case "query_preparation_failed":
      return CliProblemCode.QUERY_PREPARATION_FAILED;
    case "query_rejected":
      return CliProblemCode.QUERY_REJECTED;
    case "source_name_conflict":
      return CliProblemCode.SOURCE_NAME_CONFLICT;
    case "source_not_found":
      return CliProblemCode.SOURCE_NOT_FOUND;
    case "source_not_queryable":
      return CliProblemCode.SOURCE_NOT_QUERYABLE;
    default:
      return CliProblemCode.UNSPECIFIED;
  }
}

function toCliProblemStage(value: unknown, fallback: CliProblemStage) {
  switch (value) {
    case "auth":
      return CliProblemStage.AUTH;
    case "execute_query":
      return CliProblemStage.EXECUTE_QUERY;
    case "read_query_input":
      return CliProblemStage.READ_QUERY_INPUT;
    case "resolve_org":
      return CliProblemStage.RESOLVE_ORG;
    case "resolve_source":
      return CliProblemStage.RESOLVE_SOURCE;
    default:
      return fallback;
  }
}

function defaultProblemStageForMethod(methodName: string) {
  switch (methodName) {
    case "GetSession":
    case "RefreshSession":
    case "StartDeviceAuthorization":
    case "PollDeviceAuthorization":
    case "ListOrganizations":
      return CliProblemStage.AUTH;
    case "GetOrganization":
    case "ListSources":
      return CliProblemStage.RESOLVE_ORG;
    case "Use":
    case "GetSourceConnectGuide":
    case "ConnectSource":
    case "GetSource":
      return CliProblemStage.RESOLVE_SOURCE;
    case "ValidateQuery":
    case "ExecuteQuery":
      return CliProblemStage.READ_QUERY_INPUT;
    default:
      return CliProblemStage.UNSPECIFIED;
  }
}
