import type { ConnectRouter, ServiceImpl } from "@connectrpc/connect";
import {
  CliAuthService,
  CliOrganizationService,
  CliQueryService,
  CliSourceApiService,
  CliSourceService,
} from "@onequery/proto-cli/cli/v1/cli_pb";

import {
  handleGetSession,
  handlePollDeviceAuthorization,
  handleRefreshSession,
  handleStartDeviceAuthorization,
} from "./service/auth";
import {
  handleGetOrganization,
  handleListOrganizations,
} from "./service/organization";
import { handleExecuteQuery, handleValidateQuery } from "./service/query";
import {
  handleConnectSource,
  handleDeleteSource,
  handleGetSource,
  handleGetSourceConnectGuide,
  handleListSourceProviders,
  handleListSources,
  handleTestSource,
  handleUpdateSource,
} from "./service/source";
import {
  handleDescribeSourceApi,
  handleExecuteSourceApi,
  handlePreviewSourceApi,
  handleResumeSourceApi,
} from "./service/source-api";

// Comment: keep the published Connect surface in one module so the Node
// adapter, Hono bridge, and tests all derive from the same registration logic.
const cliAuthConnectImplementation: ServiceImpl<typeof CliAuthService> = {
  getSession: handleGetSession,
  refreshSession: handleRefreshSession,
  startDeviceAuthorization: handleStartDeviceAuthorization,
  pollDeviceAuthorization: handlePollDeviceAuthorization,
};

const cliOrganizationConnectImplementation: ServiceImpl<
  typeof CliOrganizationService
> = {
  listOrganizations: handleListOrganizations,
  getOrganization: handleGetOrganization,
};

const cliSourceConnectImplementation: ServiceImpl<typeof CliSourceService> = {
  listSourceProviders: handleListSourceProviders,
  listSources: handleListSources,
  getSource: handleGetSource,
  testSource: handleTestSource,
  getSourceConnectGuide: handleGetSourceConnectGuide,
  connectSource: handleConnectSource,
  updateSource: handleUpdateSource,
  deleteSource: handleDeleteSource,
};

const cliSourceApiConnectImplementation: ServiceImpl<
  typeof CliSourceApiService
> = {
  describeSourceApi: handleDescribeSourceApi,
  previewSourceApi: handlePreviewSourceApi,
  executeSourceApi: handleExecuteSourceApi,
  resumeSourceApi: handleResumeSourceApi,
};

const cliQueryConnectImplementation: ServiceImpl<typeof CliQueryService> = {
  validateQuery: handleValidateQuery,
  executeQuery: handleExecuteQuery,
};

export function registerCliConnectRoutes(router: ConnectRouter) {
  router.service(CliAuthService, cliAuthConnectImplementation);
  router.service(CliOrganizationService, cliOrganizationConnectImplementation);
  router.service(CliSourceService, cliSourceConnectImplementation);
  router.service(CliSourceApiService, cliSourceApiConnectImplementation);
  router.service(CliQueryService, cliQueryConnectImplementation);
}
