import type { ConnectRouter, ServiceImpl } from "@connectrpc/connect";

import { CliService } from "./gen/onequery/cli/v1/cli_pb";
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
  handleGetSource,
  handleGetSourceConnectGuide,
  handleListSources,
  handleTestSource,
} from "./service/source";
import {
  handleDescribeSourceApi,
  handleExecuteSourceApi,
} from "./service/source-api";

// Comment: keep the published Connect surface in one module so the Node
// adapter, Hono bridge, and tests all derive from the same registration logic.
const cliConnectImplementation: ServiceImpl<typeof CliService> = {
  getSession: handleGetSession,
  refreshSession: handleRefreshSession,
  startDeviceAuthorization: handleStartDeviceAuthorization,
  pollDeviceAuthorization: handlePollDeviceAuthorization,
  listOrganizations: handleListOrganizations,
  getOrganization: handleGetOrganization,
  listSources: handleListSources,
  getSource: handleGetSource,
  testSource: handleTestSource,
  getSourceConnectGuide: handleGetSourceConnectGuide,
  connectSource: handleConnectSource,
  describeSourceApi: handleDescribeSourceApi,
  executeSourceApi: handleExecuteSourceApi,
  validateQuery: handleValidateQuery,
  executeQuery: handleExecuteQuery,
};

export function registerCliConnectRoutes(router: ConnectRouter) {
  router.service(CliService, cliConnectImplementation);
}
