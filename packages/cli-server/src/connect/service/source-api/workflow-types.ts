import type { Database } from "@onequery/db/server";
import type {
  PreparedSourceConnection,
  SourceApiActorContext,
  SourceApiContinuationTokenPayload,
  SourceApiDescriptor,
  SourceApiDraft,
  SourceApiExecutionResult,
  SourceApiPreview,
} from "@onequery/server/source-api";

import type {
  SourceApiActionCommandPayload,
  SourceApiActionEffect,
  SourceApiActionEvent,
  SourceApiActionRequestDescriptor,
  StoredWorkflowDecision,
  WorkflowActorSnapshot,
  WorkflowJournalEffectToken,
} from "../../../audit";
import type { CliHonoContext } from "../types";
import type { SourceApiServiceDependencies } from "./dependencies";

export type SourceApiWorkflowContext = {
  actor: SourceApiActorContext;
  actorSnapshot: WorkflowActorSnapshot;
  c: CliHonoContext;
  organizationId: string;
  orgSlug: string;
  requestId: string;
};

export type DescribeSourceApiWorkflowInput = SourceApiWorkflowContext & {
  dependencies: SourceApiServiceDependencies;
  sourceKey: string;
};

export type StartSourceApiExecuteWorkflowInput = SourceApiWorkflowContext & {
  dependencies: SourceApiServiceDependencies;
  draft: SourceApiDraft;
  invokeMode: "execute" | "preview_only";
  sourceKey: string;
};

export type ResumeSourceApiExecuteWorkflowInput = SourceApiWorkflowContext & {
  continuation: SourceApiContinuationTokenPayload;
  dependencies: SourceApiServiceDependencies;
  source: PreparedSourceConnection;
};

export type SourceApiExecuteSuccess = {
  continuationToken?: string;
  preview: SourceApiPreview;
  result?: SourceApiExecutionResult;
};

export type StoredAcceptedSourceApiActionDecision = Extract<
  StoredWorkflowDecision<"source_api_action", SourceApiActionEvent, string>,
  { kind: "accepted" }
> & {
  freshEffects: readonly WorkflowJournalEffectToken<SourceApiActionEffect>[];
  journalEffects: readonly WorkflowJournalEffectToken<SourceApiActionEffect>[];
};

export type StoredAcceptedSourceApiActionResultCommand = {
  commandPayload: SourceApiActionCommandPayload;
  completedEffectIds: readonly string[];
  decision: StoredAcceptedSourceApiActionDecision;
};

export type DispatchedSourceApiActionEffect<
  EffectType extends SourceApiActionEffect["type"],
  TResult,
> = {
  decision: StoredAcceptedSourceApiActionDecision;
  effect: Extract<SourceApiActionEffect, { type: EffectType }>;
  result: TResult;
};

export type LoadedSourceApiActionEffect<
  EffectType extends SourceApiActionEffect["type"] =
    SourceApiActionEffect["type"],
> = {
  attemptCount: number;
  effect: Extract<SourceApiActionEffect, { type: EffectType }>;
  effectKey: string;
  id: string;
  originEventId: string;
  status: "completed" | "leased" | "pending";
};

export type SourceApiSourceLookupResult =
  | {
      kind: "found";
    }
  | {
      kind: "not_found";
    };

export type DescriptorResolutionResult =
  | {
      descriptor: SourceApiDescriptor;
      kind: "resolved";
    }
  | {
      kind: "failed";
      problem: ReturnType<typeof import("../result").createCliServiceFailure>;
    };

export type RequestPreparationResult =
  | {
      kind: "prepared";
    }
  | {
      kind: "failed";
      problem: ReturnType<typeof import("../result").createCliServiceFailure>;
    };

export type PageFetchResult =
  | {
      kind: "succeeded";
      result: SourceApiExecutionResult;
    }
  | {
      kind: "failed";
      problem: ReturnType<typeof import("../result").createCliServiceFailure>;
    };

export type SourceApiPageFetchAttemptResult =
  | {
      kind: "succeeded";
      result: SourceApiExecutionResult;
    }
  | {
      commandPayload: Extract<
        SourceApiActionCommandPayload,
        { type: "record_page_fetch"; kind: "terminal_failure" }
      >;
      kind: "failed";
      problem: ReturnType<typeof import("../result").createCliServiceFailure>;
    };

export type LoadedPreparedSourceResult =
  | {
      kind: "loaded";
      source: PreparedSourceConnection;
    }
  | {
      detail: string;
      kind: "not_found";
    }
  | {
      detail: string;
      kind: "unavailable";
    };

export type PreparedSourceApiWorkflow = {
  decision: StoredAcceptedSourceApiActionDecision;
  descriptor: SourceApiDescriptor;
};

export type PreparedSourceApiWorkflowInput = SourceApiWorkflowContext & {
  commandInvocationId: string;
  dependencies: SourceApiServiceDependencies;
  requestDescriptor: (
    descriptor: SourceApiDescriptor
  ) => SourceApiActionRequestDescriptor | null;
  sourceKey: string;
  startCommandPayload: Extract<
    SourceApiActionCommandPayload,
    { type: "start_describe" | "start_invoke" }
  >;
};

export type SourceApiWorkflowDispatchContext = {
  actorSnapshot: WorkflowActorSnapshot;
  db: Database;
  organizationId: string;
  requestId: string;
};
