import { Code, ConnectError, createConnectRouter } from "@connectrpc/connect";
import type { ConnectRouterOptions, Interceptor } from "@connectrpc/connect";
import { compressionGzip, connectNodeAdapter } from "@connectrpc/connect-node";
import type { ConnectNodeAdapterOptions } from "@connectrpc/connect-node";
import { createValidateInterceptor } from "@connectrpc/validate";
import { ViolationsSchema } from "@onequery/proto-cli/buf/validate/validate_pb";
import {
  CliAuthService,
  CliOrganizationService,
  CliQueryService,
  CliSourceApiService,
  CliSourceService,
} from "@onequery/proto-cli/cli/v1/cli_pb";
import {
  BadRequestSchema,
  ErrorInfoSchema,
} from "@onequery/proto-cli/google/rpc/error_details_pb";

import type { CliValidationIssue } from "../domain/failures";
import type { CliProblemKey } from "../domain/problems";
import { CLI_REQUEST_ID_HEADER } from "../request-context";
import { cliConnectRequestContextKey } from "./context";
import {
  CLI_ERROR_INFO_DOMAIN,
  createCliConnectError,
  withCliRequestId,
} from "./error";
import { registerCliConnectRoutes } from "./rpc";

const cliRequestIdInterceptor: Interceptor = (next) => async (request) => {
  const requestContext = request.contextValues.get(cliConnectRequestContextKey);
  const requestId = requestContext?.requestId ?? "unknown";

  try {
    const response = await next(request);
    response.header.set(CLI_REQUEST_ID_HEADER, requestId);
    return response;
  } catch (reason) {
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
      throw createCliConnectError({
        cause: error.cause,
        detail:
          error.rawMessage.length > 0
            ? error.rawMessage
            : `invalid ${request.method.name} request`,
        errors: collectCliValidationIssues(error),
        key: descriptor.key,
      });
    }
  };

const cliConnectRouterOptions = {
  acceptCompression: [compressionGzip],
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
  "acceptCompression" | "connect" | "grpc" | "grpcWeb" | "interceptors"
>;

type CreateCliConnectHandlerOptions = Omit<
  ConnectNodeAdapterOptions,
  "acceptCompression" | "routes"
>;

const cliConnectRequestPaths = (() => {
  const router = createConnectRouter(cliConnectRouterOptions);
  registerCliConnectRoutes(router);
  return Object.freeze(router.handlers.map((handler) => handler.requestPath));
})();

const cliConnectRpcMethodNames = Object.freeze(
  cliConnectRequestPaths.map((requestPath) => {
    const methodName = requestPath.split("/").at(-1);
    if (!methodName) {
      throw new Error(`invalid CLI Connect request path: ${requestPath}`);
    }

    return methodName;
  })
);

const CLI_VALIDATION_PROBLEM_KEYS_BY_METHOD_NAME = new Map<
  string,
  CliProblemKey
>([
  [CliAuthService.method.getSession.name, "AUTH_REQUEST_INVALID"],
  [CliAuthService.method.refreshSession.name, "AUTH_REQUEST_INVALID"],
  [CliAuthService.method.startDeviceAuthorization.name, "AUTH_REQUEST_INVALID"],
  [CliAuthService.method.pollDeviceAuthorization.name, "AUTH_REQUEST_INVALID"],
  [CliOrganizationService.method.listOrganizations.name, "ORG_REQUEST_INVALID"],
  [CliOrganizationService.method.getOrganization.name, "ORG_REQUEST_INVALID"],
  [CliSourceService.method.listSources.name, "SOURCE_REQUEST_INVALID"],
  [CliSourceService.method.listSourceProviders.name, "SOURCE_REQUEST_INVALID"],
  [
    CliSourceService.method.getSourceConnectGuide.name,
    "SOURCE_REQUEST_INVALID",
  ],
  [CliSourceService.method.connectSource.name, "SOURCE_REQUEST_INVALID"],
  [CliSourceService.method.getSource.name, "SOURCE_REQUEST_INVALID"],
  [CliSourceService.method.testSource.name, "SOURCE_REQUEST_INVALID"],
  [CliSourceService.method.updateSource.name, "SOURCE_REQUEST_INVALID"],
  [CliSourceService.method.deleteSource.name, "SOURCE_REQUEST_INVALID"],
  [
    CliSourceApiService.method.describeSourceApi.name,
    "SOURCE_API_REQUEST_INVALID",
  ],
  [
    CliSourceApiService.method.previewSourceApi.name,
    "SOURCE_API_REQUEST_INVALID",
  ],
  [
    CliSourceApiService.method.executeSourceApi.name,
    "SOURCE_API_REQUEST_INVALID",
  ],
  [
    CliSourceApiService.method.resumeSourceApi.name,
    "SOURCE_API_REQUEST_INVALID",
  ],
  [CliQueryService.method.validateQuery.name, "READ_QUERY_INPUT_INVALID"],
  [CliQueryService.method.executeQuery.name, "EXECUTE_QUERY_REQUEST_INVALID"],
]);

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

export function listCliConnectRpcMethodNames() {
  return cliConnectRpcMethodNames;
}

export function listCliValidationMappedMethodNames() {
  return [...CLI_VALIDATION_PROBLEM_KEYS_BY_METHOD_NAME.keys()].sort();
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
    !hasOneQueryCliErrorInfo(error)
  );
}

function hasOneQueryCliErrorInfo(error: ConnectError) {
  return error
    .findDetails(ErrorInfoSchema)
    .some((detail) => detail.domain === CLI_ERROR_INFO_DOMAIN);
}

function collectCliValidationIssues(error: ConnectError): CliValidationIssue[] {
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
  key: CliProblemKey;
} {
  const key = CLI_VALIDATION_PROBLEM_KEYS_BY_METHOD_NAME.get(methodName);
  if (!key) {
    throw new Error(
      `missing CLI validation problem mapping for RPC method ${methodName}`
    );
  }

  return { key };
}
