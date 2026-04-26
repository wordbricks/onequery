import type { MessageInitShape } from "@bufbuild/protobuf";
import type {
  PreparedSourceConnection,
  SourceApiActorContext,
} from "@onequery/server/source-api";

import type { AuthorizedCliOrgContext } from "../../../authorization";
import type {
  DescribeSourceApiResponseSchema,
  ExecuteSourceApiRequest,
  ExecuteSourceApiResponseSchema,
  PreviewSourceApiRequest,
  PreviewSourceApiResponseSchema,
  ResumeSourceApiRequest,
  ResumeSourceApiResponseSchema,
  SourceApiExecutionResultSchema,
  SourceApiDraft as CliSourceApiDraft,
  SourceApiPreviewSchema,
} from "../../gen/onequery/cli/v1/source_api_pb";
import type { CliHonoContext } from "../types";

export type DescribeSourceApiResponseInit = MessageInitShape<
  typeof DescribeSourceApiResponseSchema
>;
export type ExecuteSourceApiResponseInit = MessageInitShape<
  typeof ExecuteSourceApiResponseSchema
>;
export type PreviewSourceApiResponseInit = MessageInitShape<
  typeof PreviewSourceApiResponseSchema
>;
export type ResumeSourceApiResponseInit = MessageInitShape<
  typeof ResumeSourceApiResponseSchema
>;
export type CliSourceApiPreviewInit = MessageInitShape<
  typeof SourceApiPreviewSchema
>;
export type CliSourceApiExecutionResultInit = MessageInitShape<
  typeof SourceApiExecutionResultSchema
>;

export type SourceApiFailurePhase =
  | "authorize"
  | "describe"
  | "prepare"
  | "execute";

export type CliExecuteSourceApiRequest = ExecuteSourceApiRequest;
export type CliPreviewSourceApiRequest = PreviewSourceApiRequest;
export type CliResumeSourceApiRequest = ResumeSourceApiRequest;

export type SourceApiTarget = {
  orgSlug: string;
  sourceKey: string;
};

export type SourceApiStartCommand = {
  target: SourceApiTarget;
  draft: CliSourceApiDraft;
};

export type SourceApiResumeCommand = {
  target: SourceApiTarget;
  continuationToken: string;
};

export type SourceApiAccessState = {
  actor: SourceApiActorContext;
  authorizedOrg: AuthorizedCliOrgContext;
  c: CliHonoContext;
  source: PreparedSourceConnection;
};
