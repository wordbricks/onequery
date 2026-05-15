import type {
  DataSourceStatus,
  Database,
  ProviderType,
} from "@onequery/db/server";

import type {
  QueryActionCommandPayload,
  QueryActionEffect,
  QueryActionEvent,
  QueryActionState,
  QueryActionSourceDescriptor,
  StoredWorkflowDecision,
  WorkflowActorSnapshot,
  WorkflowSurface,
  WorkflowJournalCursor,
  WorkflowJournalEffectToken,
} from "../../../audit";
import type {
  AccessibleCliOrg,
  CliQuerySuccessResult,
} from "../../../domain/workflows";
import type {
  createCliQueryExecutionDispatch,
  createCliQueryValidationDispatch,
} from "./dispatch";
import type { QueryWorkflowResourceCache } from "./resource-cache";

export type CliQueryExecutionDispatch = ReturnType<
  typeof createCliQueryExecutionDispatch
>;

export type CliQueryValidationDispatch = ReturnType<
  typeof createCliQueryValidationDispatch
>;

export type QueryWorkflowRuntimeBaseInput = {
  actorSnapshot: WorkflowActorSnapshot;
  db: Database;
  org: AccessibleCliOrg;
  requestId: string;
  resourceCache?: QueryWorkflowResourceCache;
  scheduleUsagePersistenceFollowUp?: (work: Promise<void>) => void;
  sourceName: string;
  sql: string;
  surface?: WorkflowSurface;
  timeoutMs: number;
};

export type CliQueryExecutionWorkflowInput = QueryWorkflowRuntimeBaseInput & {
  dispatch: CliQueryExecutionDispatch;
};

export type CliQueryValidationWorkflowInput = QueryWorkflowRuntimeBaseInput & {
  dispatch: CliQueryValidationDispatch;
};

export type StoredAcceptedQueryActionDecision = Extract<
  StoredWorkflowDecision<"query_action", QueryActionEvent, string>,
  { kind: "accepted" }
> & {
  cursor: WorkflowJournalCursor<
    QueryActionState,
    QueryActionCommandPayload,
    QueryActionEvent,
    QueryActionEffect
  >;
  freshEffects: readonly WorkflowJournalEffectToken<QueryActionEffect>[];
  journalEffects: readonly WorkflowJournalEffectToken<QueryActionEffect>[];
};

export type LoadedQueryActionEffect<
  EffectType extends QueryActionEffect["type"] = QueryActionEffect["type"],
> = {
  attemptCount: number;
  effect: Extract<QueryActionEffect, { type: EffectType }>;
  effectKey: string;
  id: string;
  originEventId: string;
  status: "completed" | "leased" | "pending";
};

export type DispatchedQueryActionEffect<
  EffectType extends QueryActionEffect["type"],
  TResult,
> = {
  decision: StoredAcceptedQueryActionDecision;
  effect: Extract<QueryActionEffect, { type: EffectType }>;
  result: TResult;
};

export type SourceQueryInterfaceLoadedResult = {
  kind: "source_query_interface_loaded";
};

export type QuerySourceLookupResult =
  | SourceQueryInterfaceLoadedResult
  | {
      kind: "source_not_found";
      orgSlug: string;
      requestId: string;
      sourceName: string;
    }
  | {
      kind: "source_query_interface_missing";
      provider: ProviderType;
      requestId: string;
      sourceName: string;
      status: DataSourceStatus;
    };

export type QueryPreparationEffectResult =
  | {
      kind: "query_ready";
      normalizedSql: string;
      source: QueryActionSourceDescriptor;
      truncated: boolean;
    }
  | Exclude<QuerySourceLookupResult, SourceQueryInterfaceLoadedResult>
  | {
      detail: string;
      kind: "query_rejected";
    }
  | {
      detail: string;
      hint: string;
      kind: "query_preparation_failed";
    };

export type QueryExecutionEffectResult =
  | {
      kind: "succeeded";
      response: CliQuerySuccessResult;
    }
  | {
      detail: string;
      kind: "query_unavailable";
    }
  | {
      detail: string;
      kind: "query_timed_out";
    }
  | {
      detail: string;
      kind: "query_execution_failed";
    };

export type StoredAcceptedQueryActionResultCommand = {
  commandPayload: QueryActionCommandPayload;
  completedEffectIds: readonly string[];
  decision: StoredAcceptedQueryActionDecision;
};
