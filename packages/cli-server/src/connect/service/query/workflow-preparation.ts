import type { Database } from "@onequery/db/server";
import { createStableValueFingerprint } from "@onequery/server/lib/stable-fingerprint";

import type {
  QueryActionCommand,
  QueryActionSourceDescriptor,
} from "../../../audit";
import type { AccessibleCliOrg } from "../../../domain/workflows";
import { toCliQueryPreparationFailureResult } from "./workflow-outcome";
import type { CliQueryWorkflowPreparationFailureResult } from "./workflow-result";
import { storeAcceptedQueryActionCommand } from "./workflow-runtime";
import {
  createEmptyQueryWorkflowResourceCache,
  runQueryExecutePreparationStep,
  runQueryValidatePreparationStep,
} from "./workflow-steps";
import type {
  CliQueryExecutionDispatch,
  CliQueryValidationDispatch,
  QueryWorkflowResourceCache,
  StoredAcceptedQueryActionDecision,
} from "./workflow-types";

type QueryWorkflowPreparationMode = Extract<
  QueryActionCommand["commandPayload"],
  { type: "start_execute" | "start_validate" }
>["type"];

export type PreparedCliQueryWorkflow = {
  resourceCache: QueryWorkflowResourceCache;
  normalizedSql: string;
  preparationDecision: StoredAcceptedQueryActionDecision;
  source: QueryActionSourceDescriptor;
  truncated: boolean;
};

type QueryWorkflowPreparationReady = {
  kind: "ready";
  prepared: PreparedCliQueryWorkflow;
};

type QueryWorkflowPreparationFinished = {
  kind: "finished";
  result: CliQueryWorkflowPreparationFailureResult;
};

export type QueryWorkflowPreparationResult =
  | QueryWorkflowPreparationReady
  | QueryWorkflowPreparationFinished;

type RunPreparedCliQueryWorkflowInput = {
  actorSnapshot: QueryActionCommand["actorSnapshot"];
  db: Database;
  org: AccessibleCliOrg;
  requestId: string;
  sourceName: string;
  sql: string;
  timeoutMs: number;
} & (
  | {
      dispatch: CliQueryValidationDispatch;
      mode: "start_validate";
    }
  | {
      dispatch: CliQueryExecutionDispatch;
      mode: "start_execute";
    }
);

export async function runPreparedCliQueryWorkflow(
  input: RunPreparedCliQueryWorkflowInput
): Promise<QueryWorkflowPreparationResult> {
  let resourceCache = createEmptyQueryWorkflowResourceCache();

  const startDecision = await storeAcceptedQueryActionCommand({
    actionId: null,
    actorSnapshot: input.actorSnapshot,
    causedByEventId: null,
    commandInvocationId: buildStartQueryCommandInvocationId({
      mode: input.mode,
      organizationId: input.org.id,
      requestId: input.requestId,
      sourceName: input.sourceName,
      sql: input.sql,
      timeoutMs: input.timeoutMs,
    }),
    commandPayload: {
      queryText: input.sql,
      sourceKey: input.sourceName,
      type: input.mode,
    },
    db: input.db,
    organizationId: input.org.id,
    requestId: input.requestId,
    surface: "cli",
  });

  const preparation =
    input.mode === "start_validate"
      ? await runQueryValidatePreparationStep({
          actorSnapshot: input.actorSnapshot,
          currentDecision: startDecision,
          db: input.db,
          dispatch: input.dispatch,
          resourceCache,
          org: input.org,
          requestId: input.requestId,
          sourceName: input.sourceName,
        })
      : await runQueryExecutePreparationStep({
          actorSnapshot: input.actorSnapshot,
          currentDecision: startDecision,
          db: input.db,
          dispatch: input.dispatch,
          resourceCache,
          org: input.org,
          requestId: input.requestId,
          sourceName: input.sourceName,
        });
  resourceCache = preparation.resourceCache;

  if (preparation.step.result.kind !== "query_ready") {
    return {
      kind: "finished",
      result: toCliQueryPreparationFailureResult({
        requestId: input.requestId,
        result: preparation.step.result,
      }),
    };
  }

  return {
    kind: "ready",
    prepared: {
      resourceCache,
      normalizedSql: preparation.step.result.normalizedSql,
      preparationDecision: preparation.step.decision,
      source: preparation.step.result.source,
      truncated: preparation.step.result.truncated,
    },
  };
}

function buildStartQueryCommandInvocationId(input: {
  mode: QueryWorkflowPreparationMode;
  organizationId: string;
  requestId: string;
  sourceName: string;
  sql: string;
  timeoutMs: number;
}) {
  const fingerprint = createStableValueFingerprint({
    mode: input.mode,
    organizationId: input.organizationId,
    sourceName: input.sourceName,
    sql: input.sql,
    timeoutMs: input.timeoutMs,
  });

  return `query_action:${input.requestId}:${input.mode}:${fingerprint}`;
}
