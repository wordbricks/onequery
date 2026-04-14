import { prepareDataSourceCredentials } from "@onequery/server/services/data-source-credentials/prepare-data-source-credentials";
import {
  createSourceApiPreview,
  decodeSourceApiContinuationToken,
  describeSourceApi,
  encodeSourceApiContinuationToken,
  executePreparedSourceApi,
  prepareSourceApiDraft,
} from "@onequery/server/source-api";

import {
  buildCliRequestLogDetails,
  getCliLogLevelForStatus,
  logCliEvent,
  toCliErrorMessage,
} from "../../../observability";
import { runCliLoadSourceEffect } from "../../../source/effects";
import { requireCliConnectRequestContext } from "../../context";

export type SourceApiServiceDependencies = {
  buildCliRequestLogDetails: typeof buildCliRequestLogDetails;
  createSourceApiPreview: typeof createSourceApiPreview;
  decodeSourceApiContinuationToken: typeof decodeSourceApiContinuationToken;
  describeSourceApi: typeof describeSourceApi;
  encodeSourceApiContinuationToken: typeof encodeSourceApiContinuationToken;
  executePreparedSourceApi: typeof executePreparedSourceApi;
  getCliLogLevelForStatus: typeof getCliLogLevelForStatus;
  logCliEvent: typeof logCliEvent;
  prepareDataSourceCredentials: typeof prepareDataSourceCredentials;
  prepareSourceApiDraft: typeof prepareSourceApiDraft;
  requireCliConnectRequestContext: typeof requireCliConnectRequestContext;
  runCliLoadSourceEffect: typeof runCliLoadSourceEffect;
  toCliErrorMessage: typeof toCliErrorMessage;
};

export const defaultSourceApiServiceDependencies = {
  buildCliRequestLogDetails,
  createSourceApiPreview,
  decodeSourceApiContinuationToken,
  describeSourceApi,
  encodeSourceApiContinuationToken,
  executePreparedSourceApi,
  getCliLogLevelForStatus,
  logCliEvent,
  prepareDataSourceCredentials,
  prepareSourceApiDraft,
  requireCliConnectRequestContext,
  runCliLoadSourceEffect,
  toCliErrorMessage,
} satisfies SourceApiServiceDependencies;

export function resolveSourceApiServiceDependencies(
  overrides: Partial<SourceApiServiceDependencies> = {}
): SourceApiServiceDependencies {
  return {
    ...defaultSourceApiServiceDependencies,
    ...overrides,
  } satisfies SourceApiServiceDependencies;
}
