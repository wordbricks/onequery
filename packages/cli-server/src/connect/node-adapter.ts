import { Code, ConnectError, createConnectRouter } from "@connectrpc/connect";
import type { ConnectRouterOptions, Interceptor } from "@connectrpc/connect";
import { connectNodeAdapter } from "@connectrpc/connect-node";
import type { ConnectNodeAdapterOptions } from "@connectrpc/connect-node";
import { createValidateInterceptor } from "@connectrpc/validate";

import { cliConnectRequestContextKey } from "./context";
import type { CliConnectValidationIssue } from "./error";
import { createCliInvalidRequestConnectError, withCliRequestId } from "./error";
import { ViolationsSchema } from "./gen/buf/validate/validate_pb";
import { BadRequestSchema } from "./gen/google/rpc/error_details_pb";
import {
  CliErrorDetailSchema,
  ProblemStage,
} from "./gen/onequery/cli/v1/common_pb";
import { registerCliConnectRoutes } from "./rpc";

const cliRequestIdInterceptor: Interceptor = (next) => async (request) => {
  try {
    return await next(request);
  } catch (reason) {
    const requestContext = request.contextValues.get(
      cliConnectRequestContextKey
    );
    const requestId = requestContext?.requestId ?? "unknown";
    throw withCliRequestId(ConnectError.from(reason), requestId);
  }
};

const cliValidationErrorInterceptor: Interceptor =
  (next) => async (request) => {
    try {
      return await next(request);
    } catch (reason) {
      const error = ConnectError.from(reason);
      if (!shouldNormalizeCliValidationError(error)) {
        throw error;
      }

      const descriptor = getCliInvalidRequestDescriptor(request.method.name);
      throw createCliInvalidRequestConnectError({
        cause: error.cause,
        detail:
          error.rawMessage.length > 0
            ? error.rawMessage
            : `invalid ${request.method.name} request`,
        errors: collectCliValidationIssues(error),
        hint: descriptor.hint,
        stage: descriptor.stage,
      });
    }
  };

const cliConnectRouterOptions = {
  connect: true,
  grpc: false,
  grpcWeb: false,
  interceptors: [
    cliRequestIdInterceptor,
    cliValidationErrorInterceptor,
    createValidateInterceptor(),
  ],
} satisfies Pick<
  ConnectRouterOptions,
  "connect" | "grpc" | "grpcWeb" | "interceptors"
>;

export type CreateCliConnectHandlerOptions = Omit<
  ConnectNodeAdapterOptions,
  "routes"
>;

const cliConnectRequestPaths = (() => {
  const router = createConnectRouter(cliConnectRouterOptions);
  registerCliConnectRoutes(router);
  return Object.freeze(router.handlers.map((handler) => handler.requestPath));
})();

export function createCliConnectHandler(
  options: CreateCliConnectHandlerOptions = {}
) {
  return connectNodeAdapter({
    ...cliConnectRouterOptions,
    ...options,
    routes: registerCliConnectRoutes,
  });
}

export function listCliConnectRequestPaths() {
  return cliConnectRequestPaths;
}

export function listCliConnectMountedRequestPaths(
  input: Pick<CreateCliConnectHandlerOptions, "requestPathPrefix"> = {}
) {
  const requestPathPrefix = input.requestPathPrefix ?? "";
  return listCliConnectRequestPaths().map(
    (requestPath) => requestPathPrefix + requestPath
  );
}

function shouldNormalizeCliValidationError(error: ConnectError) {
  return (
    error.code === Code.InvalidArgument &&
    (error.findDetails(BadRequestSchema).length > 0 ||
      error.findDetails(ViolationsSchema).length > 0) &&
    error.findDetails(CliErrorDetailSchema).length === 0
  );
}

function collectCliValidationIssues(
  error: ConnectError
): CliConnectValidationIssue[] {
  return [
    ...error.findDetails(BadRequestSchema).flatMap((detail) =>
      detail.fieldViolations.map((violation) => ({
        code: violation.reason,
        field: violation.field,
        message: violation.description,
      }))
    ),
    ...error.findDetails(ViolationsSchema).flatMap((detail) =>
      detail.violations.map((violation) => ({
        code: violation.ruleId,
        field:
          violation.field?.elements
            .map((element) => element.fieldName)
            .filter((value) => value.length > 0)
            .join(".") ?? "",
        message: violation.message,
      }))
    ),
  ];
}

function getCliInvalidRequestDescriptor(methodName: string): {
  hint: string;
  stage: ProblemStage;
} {
  switch (methodName.toLowerCase()) {
    case "getsession":
    case "refreshsession":
    case "startdeviceauthorization":
    case "polldeviceauthorization":
      return {
        hint: "correct the auth request and retry",
        stage: ProblemStage.AUTH,
      };
    case "listorganizations":
    case "getorganization":
      return {
        hint: "correct the org request and retry",
        stage: ProblemStage.RESOLVE_ORG,
      };
    case "validatequery":
      return {
        hint: "correct the query input and retry",
        stage: ProblemStage.READ_QUERY_INPUT,
      };
    case "executequery":
      return {
        hint: "correct the query request and retry",
        stage: ProblemStage.EXECUTE_QUERY,
      };
    case "listsources":
    case "getsourceconnectguide":
    case "connectsource":
    case "getsource":
    case "testsource":
    case "describesourceapi":
    case "executesourceapi":
      return {
        hint: "correct the source request and retry",
        stage: ProblemStage.RESOLVE_SOURCE,
      };
    default:
      return {
        hint: "correct the request and retry",
        stage: ProblemStage.READ_QUERY_INPUT,
      };
  }
}
