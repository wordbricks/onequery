import type { MessageInitShape } from "@bufbuild/protobuf";
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
} from "@onequery/proto-cli/cli/v1/source_api_pb";
import type {
  PreparedSourceConnection,
  SourceApiActorContext,
} from "@onequery/server/source-api";

import type { WorkflowActorSnapshot } from "../../../audit";
import type { AuthorizedCliOrgContext } from "../../../authorization";
import type { CliHonoContext } from "../types";
import type { SourceApiWorkflowResourceCache } from "./resource-cache";

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
  actorSnapshot: WorkflowActorSnapshot;
  authorizedOrg: AuthorizedCliOrgContext;
  c: CliHonoContext;
  organizationId: string;
  orgSlug: string;
  requestId: string;
  resourceCache: SourceApiWorkflowResourceCache;
  source: PreparedSourceConnection;
};
