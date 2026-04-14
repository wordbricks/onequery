import type { MessageInitShape } from "@bufbuild/protobuf";
import type {
  PreparedSourceConnection,
  SourceApiActorContext,
} from "@onequery/server/source-api";

import type { AuthorizedCliOrgContext } from "../../../authorization";
import type {
  CliSourceApiExecuteMode,
  DescribeSourceApiResponseSchema,
  ExecuteSourceApiRequest,
  ExecuteSourceApiResponseSchema,
  SourceApiDraft as CliSourceApiDraft,
} from "../../gen/onequery/cli/v1/source_api_pb";
import type { CliHonoContext } from "../types";

export type DescribeSourceApiResponseInit = MessageInitShape<
  typeof DescribeSourceApiResponseSchema
>;
export type ExecuteSourceApiResponseInit = MessageInitShape<
  typeof ExecuteSourceApiResponseSchema
>;
export type CliSourceApiPreviewInit = NonNullable<
  ExecuteSourceApiResponseInit["preview"]
>;
export type CliSourceApiExecutionResultInit = NonNullable<
  ExecuteSourceApiResponseInit["result"]
>;

export type SourceApiConnectFailurePhase =
  | "authorize"
  | "describe"
  | "prepare"
  | "execute";

export type CliExecuteSourceApiInput = ExecuteSourceApiRequest["input"];

export type SourceApiTarget = {
  orgSlug: string;
  sourceKey: string;
};

export type SourceApiExecuteCommand =
  | {
      kind: "start";
      target: SourceApiTarget;
      draft: CliSourceApiDraft;
      mode: CliSourceApiExecuteMode;
    }
  | {
      kind: "resume";
      target: SourceApiTarget;
      continuationToken: string;
    };

export type SourceApiAccessState = {
  actor: SourceApiActorContext;
  authorizedOrg: AuthorizedCliOrgContext;
  c: CliHonoContext;
  source: PreparedSourceConnection;
};
