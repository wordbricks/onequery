import type { Database, DatabaseCredentials } from "@onequery/db/server";

import {
  claimFailedQueryActionEffectViaJournal,
  loadQueryActionCommandViaJournal,
  recordQueryActionEffectFailureViaJournal,
  storeQueryActionCommandViaJournal,
} from "../../../audit";
import type {
  QueryActionCommand,
  QueryActionEffect,
  QueryActionSourceDescriptor,
} from "../../../audit";
import type { CliQuerySourceRecord } from "../../../domain/workflows";
import { toCliErrorMessage } from "../../../observability";
import {
  createWorkflowAuditCorruptionFailure,
  createWorkflowAuditFailure,
} from "../workflow-audit-failure";
import type {
  CliQueryExecutionDispatch,
  DispatchedQueryActionEffect,
  LoadedQueryActionEffect,
  StoredAcceptedQueryActionDecision,
  StoredAcceptedQueryActionResultCommand,
} from "./workflow-types";

export async function dispatchStoredQueryActionEffect<
  EffectType extends QueryActionEffect["type"],
  TResult,
>(input: {
  actorSnapshot: QueryActionCommand["actorSnapshot"];
  currentDecision: StoredAcceptedQueryActionDecision;
  db: Database;
  expectedEffectType: EffectType;
  organizationId: string;
  replay: (input: {
    effect: Extract<QueryActionEffect, { type: EffectType }>;
    stored: StoredAcceptedQueryActionResultCommand;
  }) => Promise<TResult> | TResult;
  requestId: string;
  run: (effect: Extract<QueryActionEffect, { type: EffectType }>) => Promise<{
    commandPayload: QueryActionCommand["commandPayload"];
    result: TResult;
  }>;
}): Promise<DispatchedQueryActionEffect<EffectType, TResult>> {
  const fresh = findFreshQueryActionEffect(input);
  if (fresh !== null) {
    return dispatchFreshQueryActionEffect({
      ...input,
      effect: fresh,
    });
  }

  const replayed = findJournalQueryActionEffect(input);
  if (replayed !== null) {
    const replay = await replayJournalQueryActionEffect({
      ...input,
      effect: replayed,
    });
    if (replay !== null) {
      return replay;
    }

    const claimed = await tryDispatchClaimedJournalQueryActionEffect({
      ...input,
      effect: replayed,
    });
    if (claimed !== null) {
      return claimed;
    }

    throw createQueryAuditProblem(
      `query_action effect ${replayed.id} is still pending in the journal`
    );
  }

  throw createQueryAuditCorruptionProblem(
    `query_action expected journal effect ${input.expectedEffectType} but the current journal cursor has no runnable token`
  );
}

async function replayJournalQueryActionEffect<
  EffectType extends QueryActionEffect["type"],
  TResult,
>(input: {
  db: Database;
  effect: LoadedQueryActionEffect<EffectType>;
  replay: (input: {
    effect: Extract<QueryActionEffect, { type: EffectType }>;
    stored: StoredAcceptedQueryActionResultCommand;
  }) => Promise<TResult> | TResult;
}): Promise<DispatchedQueryActionEffect<EffectType, TResult> | null> {
  const resultCommandInvocationId = `${input.effect.effectKey}:result`;
  const stored = await loadStoredAcceptedQueryActionResultCommand({
    commandInvocationId: resultCommandInvocationId,
    db: input.db,
  });
  if (stored === null) {
    return null;
  }

  if (!stored.completedEffectIds.includes(input.effect.id)) {
    throw createQueryAuditCorruptionProblem(
      `query_action stored result command for effect ${input.effect.id} is missing its journal completion`
    );
  }

  return {
    decision: stored.decision,
    effect: input.effect.effect,
    result: await input.replay({
      effect: input.effect.effect,
      stored,
    }),
  };
}

async function tryDispatchClaimedJournalQueryActionEffect<
  EffectType extends QueryActionEffect["type"],
  TResult,
>(input: {
  actorSnapshot: QueryActionCommand["actorSnapshot"];
  currentDecision: StoredAcceptedQueryActionDecision;
  db: Database;
  effect: LoadedQueryActionEffect<EffectType>;
  organizationId: string;
  requestId: string;
  run: (effect: Extract<QueryActionEffect, { type: EffectType }>) => Promise<{
    commandPayload: QueryActionCommand["commandPayload"];
    result: TResult;
  }>;
}): Promise<DispatchedQueryActionEffect<EffectType, TResult> | null> {
  const claimed = await claimFailedQueryActionEffectViaJournal({
    actionId: input.currentDecision.actionId,
    db: input.db,
    effectId: input.effect.id,
    organizationId: input.organizationId,
  });
  if (claimed.isErr()) {
    return null;
  }

  try {
    return await runJournalQueryActionEffect({
      actorSnapshot: input.actorSnapshot,
      currentDecision: input.currentDecision,
      db: input.db,
      effect: {
        ...input.effect,
        effect: claimed.value.effect as Extract<
          QueryActionEffect,
          { type: EffectType }
        >,
      },
      organizationId: input.organizationId,
      requestId: input.requestId,
      run: input.run,
    });
  } catch (error) {
    await recordQueryActionEffectFailure({
      currentDecision: input.currentDecision,
      db: input.db,
      effectId: input.effect.id,
      error,
      organizationId: input.organizationId,
    });
    throw error;
  }
}

async function dispatchFreshQueryActionEffect<
  EffectType extends QueryActionEffect["type"],
  TResult,
>(input: {
  actorSnapshot: QueryActionCommand["actorSnapshot"];
  currentDecision: StoredAcceptedQueryActionDecision;
  db: Database;
  effect: LoadedQueryActionEffect<EffectType>;
  organizationId: string;
  requestId: string;
  run: (effect: Extract<QueryActionEffect, { type: EffectType }>) => Promise<{
    commandPayload: QueryActionCommand["commandPayload"];
    result: TResult;
  }>;
}): Promise<DispatchedQueryActionEffect<EffectType, TResult>> {
  try {
    return await runJournalQueryActionEffect(input);
  } catch (error) {
    await recordQueryActionEffectFailure({
      currentDecision: input.currentDecision,
      db: input.db,
      effectId: input.effect.id,
      error,
      organizationId: input.organizationId,
    });
    throw error;
  }
}

async function runJournalQueryActionEffect<
  EffectType extends QueryActionEffect["type"],
  TResult,
>(input: {
  actorSnapshot: QueryActionCommand["actorSnapshot"];
  currentDecision: StoredAcceptedQueryActionDecision;
  db: Database;
  effect: LoadedQueryActionEffect<EffectType>;
  organizationId: string;
  requestId: string;
  run: (effect: Extract<QueryActionEffect, { type: EffectType }>) => Promise<{
    commandPayload: QueryActionCommand["commandPayload"];
    result: TResult;
  }>;
}): Promise<DispatchedQueryActionEffect<EffectType, TResult>> {
  const resultCommandInvocationId = `${input.effect.effectKey}:result`;
  const outcome = await input.run(input.effect.effect);
  const decision = await storeAcceptedQueryActionCommand({
    actionId: input.currentDecision.actionId,
    actorSnapshot: input.actorSnapshot,
    causedByEventId: input.effect.originEventId,
    commandInvocationId: resultCommandInvocationId,
    commandPayload: outcome.commandPayload,
    completedEffectId: input.effect.id,
    currentCursor: input.currentDecision.cursor,
    db: input.db,
    organizationId: input.organizationId,
    requestId: input.requestId,
    surface: "system",
  });

  return {
    decision,
    effect: input.effect.effect,
    result: outcome.result,
  };
}

export async function storeAcceptedQueryActionCommand(
  input: Omit<QueryActionCommand, "family" | "observedAt"> & {
    completedEffectId?: string;
    currentCursor?: StoredAcceptedQueryActionDecision["cursor"];
    db: Database;
  }
): Promise<StoredAcceptedQueryActionDecision> {
  const stored = await storeQueryActionCommandViaJournal({
    command: {
      ...input,
      family: "query_action",
      observedAt: new Date(),
    },
    completedEffectId: input.completedEffectId,
    currentCursor: input.currentCursor,
    db: input.db,
  });

  if (stored.isErr()) {
    throw createQueryAuditProblem(
      `query_action ${input.commandPayload.type} could not be stored`,
      stored.error
    );
  }

  if (stored.value.kind !== "accepted") {
    throw createQueryAuditProblem(
      `query_action ${input.commandPayload.type} was rejected with ${stored.value.rejectCode}`
    );
  }

  return stored.value;
}

export async function loadRequiredCliQuerySourceRecord(input: {
  cachedSource: CliQuerySourceRecord | null;
  dispatch: Pick<CliQueryExecutionDispatch, "loadSource">;
  sourceDescriptor: QueryActionSourceDescriptor;
}): Promise<CliQuerySourceRecord> {
  if (input.cachedSource !== null) {
    return input.cachedSource;
  }

  const loaded = await input.dispatch.loadSource({
    kind: "load_source",
    organizationId: input.sourceDescriptor.organizationId,
    sourceKey: input.sourceDescriptor.sourceKey,
  });

  if (loaded.kind !== "found") {
    throw createQueryAuditProblem(
      `query_action replay could not reload source "${input.sourceDescriptor.sourceKey}" for a downstream effect`
    );
  }

  if (
    loaded.source.id !== input.sourceDescriptor.sourceId ||
    loaded.source.organizationId !== input.sourceDescriptor.organizationId ||
    loaded.source.provider !== input.sourceDescriptor.provider ||
    loaded.source.sourceKey !== input.sourceDescriptor.sourceKey
  ) {
    throw createQueryAuditProblem(
      `query_action replay reloaded source "${input.sourceDescriptor.sourceKey}" with a mismatched identity`
    );
  }

  return loaded.source;
}

export async function loadRequiredCliQueryCredentials(input: {
  cachedCredentials: DatabaseCredentials | null;
  dispatch: Pick<CliQueryExecutionDispatch, "loadCredentials">;
  source: CliQuerySourceRecord;
}): Promise<DatabaseCredentials> {
  if (input.cachedCredentials !== null) {
    return input.cachedCredentials;
  }

  const loaded = await input.dispatch.loadCredentials({
    kind: "load_credentials",
    source: input.source,
  });

  if (loaded.kind !== "credentials_loaded") {
    throw createQueryAuditProblem(
      `query_action replay could not reload credentials for source "${input.source.sourceKey}"`
    );
  }

  return loaded.credentials;
}

export function requireLastCommittedEvent(
  decision: StoredAcceptedQueryActionDecision
) {
  const event = decision.events.at(-1);
  if (!event) {
    throw createQueryAuditCorruptionProblem(
      `query_action ${decision.commandId} committed without events`
    );
  }

  return event;
}

export function createQueryAuditProblem(detail: string, cause?: unknown) {
  return createWorkflowAuditFailure({
    cause,
    detail,
    keys: {
      corrupt: "QUERY_WORKFLOW_CORRUPT",
      internal: "QUERY_WORKFLOW_INTERNAL",
    },
  });
}

export function createQueryAuditCorruptionProblem(
  detail: string,
  cause?: unknown
) {
  return createWorkflowAuditCorruptionFailure({
    cause,
    detail,
    key: "QUERY_WORKFLOW_CORRUPT",
  });
}

function findFreshQueryActionEffect<
  EffectType extends QueryActionEffect["type"],
>(input: {
  currentDecision: StoredAcceptedQueryActionDecision;
  expectedEffectType: EffectType;
}): LoadedQueryActionEffect<EffectType> | null {
  return findQueryActionJournalEffect({
    currentDecision: input.currentDecision,
    effects: input.currentDecision.freshEffects ?? [],
    expectedEffectType: input.expectedEffectType,
  });
}

function findJournalQueryActionEffect<
  EffectType extends QueryActionEffect["type"],
>(input: {
  currentDecision: StoredAcceptedQueryActionDecision;
  expectedEffectType: EffectType;
}): LoadedQueryActionEffect<EffectType> | null {
  return findQueryActionJournalEffect({
    currentDecision: input.currentDecision,
    expectedEffectType: input.expectedEffectType,
    effects: input.currentDecision.journalEffects ?? [],
  });
}

function findQueryActionJournalEffect<
  EffectType extends QueryActionEffect["type"],
>(input: {
  currentDecision: StoredAcceptedQueryActionDecision;
  effects: StoredAcceptedQueryActionDecision["journalEffects"];
  expectedEffectType: EffectType;
}): LoadedQueryActionEffect<EffectType> | null {
  const effects = input.effects ?? [];
  const effectIndex = effects.findIndex(
    (effect) => effect.effect.type === input.expectedEffectType
  );
  if (effectIndex === -1) {
    return null;
  }

  const effect = effects[effectIndex];
  if (effect === undefined) {
    return null;
  }
  const originEvent = requireLastCommittedEvent(input.currentDecision);

  return {
    attemptCount: 0,
    effect: effect.effect as Extract<QueryActionEffect, { type: EffectType }>,
    effectKey: `query_action:${originEvent.id}:${effectIndex + 1}`,
    id: effect.effectId,
    originEventId: originEvent.id,
    status: "pending",
  };
}

async function recordQueryActionEffectFailure(input: {
  currentDecision: StoredAcceptedQueryActionDecision;
  db: Database;
  effectId: string;
  error: unknown;
  organizationId: string;
}) {
  const recorded = await recordQueryActionEffectFailureViaJournal({
    actionId: input.currentDecision.actionId,
    db: input.db,
    effectId: input.effectId,
    errorCode: "dispatch_failed",
    errorDetail: toCliErrorMessage(input.error),
    organizationId: input.organizationId,
  });
  if (recorded.isErr()) {
    throw createQueryAuditProblem(
      `query_action effect ${input.effectId} failure could not be recorded in the journal`,
      recorded.error
    );
  }
}

async function loadStoredAcceptedQueryActionResultCommand(input: {
  commandInvocationId: string;
  db: Database;
}): Promise<StoredAcceptedQueryActionResultCommand | null> {
  const stored = await loadQueryActionCommandViaJournal({
    commandInvocationId: input.commandInvocationId,
    db: input.db,
  });
  if (stored.isErr()) {
    throw createQueryAuditCorruptionProblem(
      `query_action stored result command ${input.commandInvocationId} could not be replayed from the journal`,
      stored.error
    );
  }

  if (stored.value === null) {
    return null;
  }

  if (stored.value.decision.kind !== "accepted") {
    throw createQueryAuditCorruptionProblem(
      `query_action stored result command ${input.commandInvocationId} was unexpectedly rejected`
    );
  }

  return {
    commandPayload: stored.value.commandPayload,
    completedEffectIds: stored.value.completedEffectIds,
    decision: stored.value.decision,
  };
}
