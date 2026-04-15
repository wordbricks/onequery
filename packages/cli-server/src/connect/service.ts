import type { ServiceImpl } from "@connectrpc/connect";

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

export function createCliService(): Partial<ServiceImpl<typeof CliService>> {
  return {
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
}
