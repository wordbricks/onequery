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
  runQuerySourceLookupStep,
  runQueryValidationStep,
} from "./workflow-steps";
import type {
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
  source: QueryActionSourceDescriptor;
  truncated: boolean;
  validationDecision: StoredAcceptedQueryActionDecision;
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

export async function runPreparedCliQueryWorkflow(input: {
  actorSnapshot: QueryActionCommand["actorSnapshot"];
  db: Database;
  dispatch: CliQueryValidationDispatch;
  mode: QueryWorkflowPreparationMode;
  org: AccessibleCliOrg;
  requestId: string;
  sourceName: string;
  sql: string;
  timeoutMs: number;
}): Promise<QueryWorkflowPreparationResult> {
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

  const sourceLookup = await runQuerySourceLookupStep({
    actorSnapshot: input.actorSnapshot,
    currentDecision: startDecision,
    db: input.db,
    dispatch: input.dispatch,
    resourceCache,
    org: input.org,
    requestId: input.requestId,
    sourceName: input.sourceName,
  });
  resourceCache = sourceLookup.resourceCache;

  if (sourceLookup.step.result.kind !== "source_query_interface_loaded") {
    return {
      kind: "finished",
      result: sourceLookup.step.result,
    };
  }

  const validation = await runQueryValidationStep({
    actorSnapshot: input.actorSnapshot,
    currentDecision: sourceLookup.step.decision,
    db: input.db,
    dispatch: input.dispatch,
    organizationId: input.org.id,
    requestId: input.requestId,
  });

  if (validation.result.kind !== "query_ready") {
    return {
      kind: "finished",
      result: toCliQueryPreparationFailureResult({
        requestId: input.requestId,
        result: validation.result,
      }),
    };
  }

  return {
    kind: "ready",
    prepared: {
      resourceCache,
      normalizedSql: validation.result.normalizedSql,
      source: validation.effect.source,
      truncated: validation.result.truncated,
      validationDecision: validation.decision,
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
