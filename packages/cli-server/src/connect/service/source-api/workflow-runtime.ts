import {
  and,
  asc,
  eq,
  ne,
  workflowEffectDispatches,
} from "@onequery/db/server";
import type { Database } from "@onequery/db/server";
import type {
  PreparedSourceApi,
  SourceApiDescriptor,
  SourceApiDraft,
} from "@onequery/server/source-api";
import { Result, isPanic } from "better-result";

import {
  loadSourceApiActionCommandViaJournal,
  storeSourceApiActionCommand,
} from "../../../audit";
import type {
  SourceApiActionCommand,
  SourceApiActionCommandPayload,
  SourceApiActionEffect,
  SourceApiActionEvent,
  SourceApiActionSourceDescriptor,
  WorkflowActorSnapshot,
} from "../../../audit";
import { decodeSourceApiActionEffectPayload } from "../../../audit/source-api-action-family/protobuf-codec";
import { isCliFailure } from "../../../domain/failures";
import { toCliErrorMessage } from "../../../observability";
import { createCliServiceFailure } from "../result";
import type { CliServiceResult } from "../result";
import type { CliHonoContext } from "../types";
import {
  createWorkflowAuditCorruptionFailure,
  createWorkflowAuditFailure,
} from "../workflow-audit-failure";
import { dispatchStoredWorkflowEffect } from "../workflow-effect-dispatch";
import type { SourceApiServiceDependencies } from "./dependencies";
import { prepareSourceApiDraftResult } from "./runtime";
import type {
  DispatchedSourceApiActionEffect,
  LoadedPreparedSourceResult,
  LoadedSourceApiActionEffect,
  StoredAcceptedSourceApiActionDecision,
  StoredAcceptedSourceApiActionResultCommand,
} from "./workflow-types";

export const SOURCE_API_ACTION_DETAIL_MAX_LENGTH = 16_384;

const SOURCE_API_ACTION_DETAIL_TRUNCATED_SUFFIX = " [truncated]";

export async function dispatchStoredSourceApiActionEffect<
  EffectType extends SourceApiActionEffect["type"],
  TResult,
>(input: {
  actorSnapshot: WorkflowActorSnapshot;
  currentDecision: StoredAcceptedSourceApiActionDecision;
  db: Database;
  expectedEffectType: EffectType;
  organizationId: string;
  replay: (input: {
    effect: Extract<SourceApiActionEffect, { type: EffectType }>;
    stored: StoredAcceptedSourceApiActionResultCommand;
  }) => Promise<TResult> | TResult;
  requestId: string;
  run: (
    effect: Extract<SourceApiActionEffect, { type: EffectType }>
  ) => Promise<{
    commandPayload: SourceApiActionCommandPayload;
    result: TResult;
  }>;
}): Promise<DispatchedSourceApiActionEffect<EffectType, TResult>> {
  const fresh = findFreshSourceApiActionEffect(input);
  if (fresh !== null) {
    return dispatchFreshSourceApiActionEffect({
      ...input,
      effect: fresh,
    });
  }

  const replayed = findJournalSourceApiActionEffect(input);
  if (replayed !== null) {
    const replay = await replayJournalSourceApiActionEffect({
      ...input,
      effect: replayed,
    });
    if (replay !== null) {
      return replay;
    }
  }

  return dispatchStoredWorkflowEffect<
    SourceApiActionEffect,
    EffectType,
    SourceApiActionCommandPayload,
    SourceApiActionEvent,
    StoredAcceptedSourceApiActionDecision,
    StoredAcceptedSourceApiActionResultCommand,
    TResult
  >({
    ...input,
    createCorruptionProblem: createSourceApiAuditCorruptionFailure,
    createProblem: createSourceApiAuditFailure,
    family: "source_api_action",
    loadEffect: loadRequiredSourceApiActionEffect,
    loadStoredResultCommand: loadStoredAcceptedSourceApiActionResultCommand,
    storeResultCommand: storeAcceptedSourceApiActionCommand,
  });
}

async function replayJournalSourceApiActionEffect<
  EffectType extends SourceApiActionEffect["type"],
  TResult,
>(input: {
  db: Database;
  effect: LoadedSourceApiActionEffect<EffectType>;
  replay: (input: {
    effect: Extract<SourceApiActionEffect, { type: EffectType }>;
    stored: StoredAcceptedSourceApiActionResultCommand;
  }) => Promise<TResult> | TResult;
}): Promise<DispatchedSourceApiActionEffect<EffectType, TResult> | null> {
  const resultCommandInvocationId = `${input.effect.effectKey}:result`;
  const stored = await loadStoredAcceptedSourceApiActionResultCommand({
    commandInvocationId: resultCommandInvocationId,
    db: input.db,
  });
  if (stored === null) {
    return null;
  }

  if (!stored.completedEffectIds.includes(input.effect.id)) {
    throw createSourceApiAuditCorruptionFailure(
      `source_api_action stored result command for effect ${input.effect.id} is missing its journal completion`
    );
  }

  await completeSourceApiActionEffectProjectionIfPresent({
    db: input.db,
    effectId: input.effect.id,
  });

  return {
    decision: stored.decision,
    effect: input.effect.effect,
    result: await input.replay({
      effect: input.effect.effect,
      stored,
    }),
  };
}

async function dispatchFreshSourceApiActionEffect<
  EffectType extends SourceApiActionEffect["type"],
  TResult,
>(input: {
  actorSnapshot: WorkflowActorSnapshot;
  currentDecision: StoredAcceptedSourceApiActionDecision;
  db: Database;
  effect: LoadedSourceApiActionEffect<EffectType>;
  organizationId: string;
  requestId: string;
  run: (
    effect: Extract<SourceApiActionEffect, { type: EffectType }>
  ) => Promise<{
    commandPayload: SourceApiActionCommandPayload;
    result: TResult;
  }>;
}): Promise<DispatchedSourceApiActionEffect<EffectType, TResult>> {
  const resultCommandInvocationId = `${input.effect.effectKey}:result`;
  const outcome = await input.run(input.effect.effect);
  const decision = await storeAcceptedSourceApiActionCommand({
    actionId: input.currentDecision.actionId,
    actorSnapshot: input.actorSnapshot,
    causedByEventId: input.effect.originEventId,
    commandInvocationId: resultCommandInvocationId,
    commandPayload: outcome.commandPayload,
    completedEffectId: input.effect.id,
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

export async function storeAcceptedSourceApiActionCommand(
  input: Omit<SourceApiActionCommand, "family" | "observedAt"> & {
    completedEffectId?: string;
    db: Database;
  }
): Promise<StoredAcceptedSourceApiActionDecision> {
  const commandPayload = normalizeSourceApiActionCommandPayloadForStorage(
    input.commandPayload
  );
  const stored = await storeSourceApiActionCommand({
    command: {
      ...input,
      commandPayload,
      family: "source_api_action",
      observedAt: new Date(),
    },
    completedEffectId: input.completedEffectId,
    db: input.db,
  });

  if (stored.isErr()) {
    throw createSourceApiAuditFailure(
      `source_api_action ${input.commandPayload.type} could not be stored`,
      stored.error
    );
  }

  if (stored.value.kind !== "accepted") {
    throw createSourceApiAuditFailure(
      `source_api_action ${input.commandPayload.type} was rejected with ${stored.value.rejectCode}`
    );
  }

  return stored.value;
}

export function normalizeSourceApiActionCommandPayloadForStorage(
  payload: SourceApiActionCommandPayload
): SourceApiActionCommandPayload {
  switch (payload.type) {
    case "record_descriptor_resolution":
    case "record_request_preparation":
      if (payload.kind !== "failed") {
        return payload;
      }
      return withStoredDetailCap(payload);
    case "record_page_fetch":
      if (payload.kind !== "terminal_failure") {
        return payload;
      }
      return withStoredDetailCap(payload);
    default:
      return payload;
  }
}

function withStoredDetailCap<TPayload extends { detail: string }>(
  payload: TPayload
): TPayload {
  const detail = truncateSourceApiActionDetail(payload.detail);
  if (detail === payload.detail) {
    return payload;
  }

  return {
    ...payload,
    detail,
  };
}

function truncateSourceApiActionDetail(detail: string): string {
  const characters = Array.from(detail);
  if (characters.length <= SOURCE_API_ACTION_DETAIL_MAX_LENGTH) {
    return detail;
  }

  return `${characters
    .slice(
      0,
      SOURCE_API_ACTION_DETAIL_MAX_LENGTH -
        SOURCE_API_ACTION_DETAIL_TRUNCATED_SUFFIX.length
    )
    .join("")}${SOURCE_API_ACTION_DETAIL_TRUNCATED_SUFFIX}`;
}

export async function loadPreparedSourceConnection(input: {
  c: CliHonoContext;
  dependencies: Pick<
    SourceApiServiceDependencies,
    "prepareDataSourceCredentials" | "runCliLoadSourceEffect"
  >;
  organizationId: string;
  source: Pick<
    SourceApiActionSourceDescriptor,
    "provider" | "sourceId" | "sourceKey"
  >;
}): Promise<LoadedPreparedSourceResult> {
  const source = await input.dependencies.runCliLoadSourceEffect({
    db: input.c.var.storage.db,
    effect: {
      kind: "load_source",
      organizationId: input.organizationId,
      sourceKey: input.source.sourceKey,
    },
  });

  if (source.kind === "not_found") {
    return {
      detail: `source "${input.source.sourceKey}" is no longer available`,
      kind: "not_found",
    };
  }

  if (
    source.source.id !== input.source.sourceId ||
    source.source.provider !== input.source.provider
  ) {
    return {
      detail: "Source API execution state no longer matches the current source",
      kind: "unavailable",
    };
  }

  const preparedCredentials =
    await input.dependencies.prepareDataSourceCredentials({
      dataSource: source.source,
      masterEncryptionKey: input.c.var.runtime.crypto.masterEncryptionKey,
    });

  if (preparedCredentials.isErr()) {
    return {
      detail: preparedCredentials.error.message,
      kind: "unavailable",
    };
  }

  return {
    kind: "loaded",
    source: {
      credentials: preparedCredentials.value.credentials,
      displayName: source.source.displayName,
      id: source.source.id,
      provider: source.source.provider,
      sourceKey: source.source.sourceKey,
    },
  };
}

export async function loadRequiredPreparedSourceConnection(input: {
  c: CliHonoContext;
  dependencies: Pick<
    SourceApiServiceDependencies,
    "prepareDataSourceCredentials" | "runCliLoadSourceEffect"
  >;
  organizationId: string;
  source: Pick<
    SourceApiActionSourceDescriptor,
    "provider" | "sourceId" | "sourceKey"
  >;
}) {
  const loaded = await loadPreparedSourceConnection(input);

  if (loaded.kind !== "loaded") {
    throw createSourceApiAuditFailure(
      `source_api_action replay could not reload source "${input.source.sourceKey}" for a downstream effect`
    );
  }

  return loaded.source;
}

export async function loadRequiredPreparedSourceApi(input: {
  actor: import("@onequery/server/source-api").SourceApiActorContext;
  c: CliHonoContext;
  dependencies: SourceApiServiceDependencies;
  descriptor: SourceApiDescriptor | null;
  draft: SourceApiDraft;
  prepared: PreparedSourceApi | null;
  source: Pick<
    SourceApiActionSourceDescriptor,
    "provider" | "sourceId" | "sourceKey"
  >;
}) {
  if (input.prepared !== null) {
    return input.prepared;
  }

  const descriptor = requireResolvedSourceApiDescriptor(input.descriptor);
  const source = await loadRequiredPreparedSourceConnection({
    c: input.c,
    dependencies: input.dependencies,
    organizationId: input.actor.organizationId,
    source: input.source,
  });
  const prepared = await prepareSourceApiDraftResult(
    {
      actor: input.actor,
      descriptor,
      draft: input.draft,
      source,
    },
    input.dependencies
  );

  if (prepared.isErr()) {
    throw createSourceApiAuditFailure(
      "source_api_action replay could not rebuild the prepared request",
      prepared.error
    );
  }

  return prepared.value;
}

export function requireLastCommittedEvent(
  decision: StoredAcceptedSourceApiActionDecision
) {
  const event = decision.events.at(-1);
  if (!event) {
    throw createSourceApiAuditCorruptionFailure(
      `source_api_action ${decision.commandId} committed without events`
    );
  }

  return event;
}

export function requireResolvedSourceApiDescriptor(
  descriptor: SourceApiDescriptor | null
) {
  if (descriptor === null) {
    throw createSourceApiAuditFailure(
      "source_api_action descriptor cache was missing during replay"
    );
  }

  return descriptor;
}

export function ensureCliServiceFailure(error: unknown) {
  if (isCliFailure(error)) {
    return error;
  }

  if (isPanic(error) && isCliFailure(error.cause)) {
    return error.cause;
  }

  return createCliServiceFailure({
    ...(error === undefined ? {} : { cause: error }),
    detail: toCliErrorMessage(error),
    key: "SOURCE_API_EXECUTION_FAILED",
  });
}

export async function captureSourceApiWorkflowResult<T>(
  operation: () => Promise<CliServiceResult<T>>
): Promise<CliServiceResult<T>> {
  const result = await Result.tryPromise({
    try: operation,
    catch: (error) => ensureCliServiceFailure(error),
  });

  return Result.flatten(result);
}

export function captureSourceApiWorkflowValue<T>(
  operation: () => Promise<T>
): Promise<CliServiceResult<T>> {
  return Result.tryPromise({
    try: operation,
    catch: (error) => ensureCliServiceFailure(error),
  });
}

export function createSourceApiAuditFailure(detail: string, cause?: unknown) {
  return createWorkflowAuditFailure({
    cause,
    detail,
    keys: {
      corrupt: "SOURCE_API_WORKFLOW_CORRUPT",
      internal: "SOURCE_API_WORKFLOW_INTERNAL",
    },
  });
}

export function createSourceApiAuditCorruptionFailure(
  detail: string,
  cause?: unknown
) {
  return createWorkflowAuditCorruptionFailure({
    cause,
    detail,
    key: "SOURCE_API_WORKFLOW_CORRUPT",
  });
}

function findFreshSourceApiActionEffect<
  EffectType extends SourceApiActionEffect["type"],
>(input: {
  currentDecision: StoredAcceptedSourceApiActionDecision;
  expectedEffectType: EffectType;
}): LoadedSourceApiActionEffect<EffectType> | null {
  return findSourceApiActionJournalEffect({
    currentDecision: input.currentDecision,
    effects: input.currentDecision.freshEffects ?? [],
    expectedEffectType: input.expectedEffectType,
  });
}

function findJournalSourceApiActionEffect<
  EffectType extends SourceApiActionEffect["type"],
>(input: {
  currentDecision: StoredAcceptedSourceApiActionDecision;
  expectedEffectType: EffectType;
}): LoadedSourceApiActionEffect<EffectType> | null {
  return findSourceApiActionJournalEffect({
    currentDecision: input.currentDecision,
    expectedEffectType: input.expectedEffectType,
    effects: input.currentDecision.journalEffects ?? [],
  });
}

function findSourceApiActionJournalEffect<
  EffectType extends SourceApiActionEffect["type"],
>(input: {
  currentDecision: StoredAcceptedSourceApiActionDecision;
  effects: StoredAcceptedSourceApiActionDecision["journalEffects"];
  expectedEffectType: EffectType;
}): LoadedSourceApiActionEffect<EffectType> | null {
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
    effect: effect.effect as Extract<
      SourceApiActionEffect,
      { type: EffectType }
    >,
    effectKey: `source_api_action:${originEvent.id}:${effectIndex + 1}`,
    id: effect.effectId,
    originEventId: originEvent.id,
    status: "pending",
  };
}

async function completeSourceApiActionEffectProjectionIfPresent(input: {
  db: Database;
  effectId: string;
}) {
  await input.db
    .update(workflowEffectDispatches)
    .set({
      completedAt: new Date(),
      lastErrorCode: null,
      lastErrorDetail: null,
      leasedUntil: null,
      status: "completed",
    })
    .where(
      and(
        eq(workflowEffectDispatches.id, input.effectId),
        ne(workflowEffectDispatches.status, "completed")
      )
    );
}

async function loadRequiredSourceApiActionEffect<
  EffectType extends SourceApiActionEffect["type"],
>(input: {
  actionId: string;
  db: Database;
  expectedEffectType: EffectType;
  originEventId: string;
}): Promise<LoadedSourceApiActionEffect<EffectType>> {
  const [row] = await input.db
    .select()
    .from(workflowEffectDispatches)
    .where(
      and(
        eq(workflowEffectDispatches.actionId, input.actionId),
        eq(workflowEffectDispatches.family, "source_api_action"),
        eq(workflowEffectDispatches.originEventId, input.originEventId)
      )
    )
    .orderBy(
      asc(workflowEffectDispatches.createdAt),
      asc(workflowEffectDispatches.id)
    )
    .limit(1);

  if (!row) {
    throw createSourceApiAuditCorruptionFailure(
      `source_api_action effect ${input.expectedEffectType} is missing for origin event ${input.originEventId}`
    );
  }

  const decodedEffect = decodeSourceApiActionEffectPayload(row.payloadBytes, {
    actionId: input.actionId,
    payloadType: row.effectType,
  });
  if (decodedEffect.isErr()) {
    throw createSourceApiAuditCorruptionFailure(
      `source_api_action effect ${row.effectType} payload is corrupt`,
      decodedEffect.error
    );
  }

  if (decodedEffect.value.type !== input.expectedEffectType) {
    throw createSourceApiAuditCorruptionFailure(
      `source_api_action expected effect ${input.expectedEffectType} but loaded ${decodedEffect.value.type}`
    );
  }

  return {
    attemptCount: row.attemptCount,
    effect: decodedEffect.value as Extract<
      SourceApiActionEffect,
      { type: EffectType }
    >,
    effectKey: row.effectKey,
    id: row.id,
    originEventId: row.originEventId,
    status: row.status,
  };
}

async function loadStoredAcceptedSourceApiActionResultCommand(input: {
  commandInvocationId: string;
  db: Database;
}): Promise<StoredAcceptedSourceApiActionResultCommand | null> {
  const stored = await loadSourceApiActionCommandViaJournal({
    commandInvocationId: input.commandInvocationId,
    db: input.db,
  });
  if (stored.isErr()) {
    throw createSourceApiAuditCorruptionFailure(
      `source_api_action stored result command ${input.commandInvocationId} could not be replayed from the journal`,
      stored.error
    );
  }

  if (stored.value === null) {
    return null;
  }

  if (stored.value.decision.kind !== "accepted") {
    throw createSourceApiAuditCorruptionFailure(
      `source_api_action stored result command ${input.commandInvocationId} was unexpectedly rejected`
    );
  }

  return {
    commandPayload: stored.value.commandPayload,
    completedEffectIds: stored.value.completedEffectIds,
    decision: stored.value.decision,
  };
}
