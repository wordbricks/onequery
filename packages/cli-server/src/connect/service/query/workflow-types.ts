import type {
  DataSourceStatus,
  Database,
  DatabaseCredentials,
  ProviderType,
} from "@onequery/db/server";

import type {
  QueryActionEffect,
  QueryActionEvent,
  StoredWorkflowDecision,
  WorkflowActorSnapshot,
} from "../../../audit";
import type {
  AccessibleCliOrg,
  CliQuerySourceRecord,
  CliQuerySuccessResult,
} from "../../../domain/workflows";
import type {
  createCliQueryExecutionDispatch,
  createCliQueryValidationDispatch,
} from "./dispatch";

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
  sourceName: string;
  sql: string;
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
>;

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

export type QueryableSourceLoadedResult = {
  kind: "queryable_source_loaded";
};

export type QuerySourceLookupResult =
  | QueryableSourceLoadedResult
  | {
      kind: "source_not_found";
      orgSlug: string;
      requestId: string;
      sourceName: string;
    }
  | {
      kind: "source_not_queryable";
      provider: ProviderType;
      requestId: string;
      sourceName: string;
      status: DataSourceStatus;
    };

export type QueryCredentialsLoadResult =
  | {
      kind: "loaded";
    }
  | {
      detail: string;
      kind: "credentials_invalid";
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
  commandPayload: { type: string } & Record<string, unknown>;
  decision: StoredAcceptedQueryActionDecision;
};

export type QueryWorkflowResourceCache = {
  loadedCredentials: DatabaseCredentials | null;
  loadedSource: CliQuerySourceRecord | null;
};
