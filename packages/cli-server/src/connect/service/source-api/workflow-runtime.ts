import type { Database } from "@onequery/db/server";
import type {
  PreparedSourceApi,
  SourceApiDescriptor,
  SourceApiDraft,
} from "@onequery/server/source-api";
import { Result, isPanic } from "better-result";

import {
  claimFailedSourceApiActionEffectViaJournal,
  loadSourceApiActionCommandViaJournal,
  recordSourceApiActionEffectFailureViaJournal,
  storeSourceApiActionCommand,
} from "../../../audit";
import type {
  SourceApiActionCommand,
  SourceApiActionCommandPayload,
  SourceApiActionEffect,
  SourceApiActionSourceDescriptor,
  WorkflowActorSnapshot,
  WorkflowJournalEffectToken,
} from "../../../audit";
import { isCliFailure } from "../../../domain/failures";
import { toCliErrorMessage } from "../../../observability";
import { createCliServiceFailure } from "../result";
import type { CliServiceResult } from "../result";
import type { CliHonoContext } from "../types";
import {
  createWorkflowAuditCorruptionFailure,
  createWorkflowAuditFailure,
} from "../workflow-audit-failure";
import type { SourceApiServiceDependencies } from "./dependencies";
import { loadSourceApiSourceForWorkflow } from "./resource-cache";
import type { SourceApiWorkflowResourceCache } from "./resource-cache";
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

    const claimed = await tryDispatchClaimedJournalSourceApiActionEffect({
      ...input,
      effect: replayed,
    });
    if (claimed !== null) {
      return claimed;
    }

    throw createSourceApiAuditFailure(
      `source_api_action effect ${replayed.id} is still pending in the journal`
    );
  }

  throw createSourceApiAuditCorruptionFailure(
    `source_api_action expected journal effect ${input.expectedEffectType} but the current journal cursor has no runnable token`
  );
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
  try {
    return await runJournalSourceApiActionEffect(input);
  } catch (error) {
    await recordSourceApiActionEffectFailure({
      currentDecision: input.currentDecision,
      db: input.db,
      effectId: input.effect.id,
      error,
      organizationId: input.organizationId,
    });
    throw error;
  }
}

async function tryDispatchClaimedJournalSourceApiActionEffect<
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
}): Promise<DispatchedSourceApiActionEffect<EffectType, TResult> | null> {
  const claimed = await claimFailedSourceApiActionEffectViaJournal({
    actionId: input.currentDecision.actionId,
    db: input.db,
    effectId: input.effect.id,
    organizationId: input.organizationId,
  });
  if (claimed.isErr()) {
    return null;
  }

  try {
    return await runJournalSourceApiActionEffect({
      actorSnapshot: input.actorSnapshot,
      currentDecision: input.currentDecision,
      db: input.db,
      effect: {
        ...input.effect,
        effect: claimed.value.effect as Extract<
          SourceApiActionEffect,
          { type: EffectType }
        >,
      },
      organizationId: input.organizationId,
      requestId: input.requestId,
      run: input.run,
    });
  } catch (error) {
    await recordSourceApiActionEffectFailure({
      currentDecision: input.currentDecision,
      db: input.db,
      effectId: input.effect.id,
      error,
      organizationId: input.organizationId,
    });
    throw error;
  }
}

async function runJournalSourceApiActionEffect<
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
  resourceCache: SourceApiWorkflowResourceCache;
  source: Pick<
    SourceApiActionSourceDescriptor,
    "provider" | "sourceId" | "sourceKey"
  >;
}): Promise<LoadedPreparedSourceResult> {
  const source = await loadSourceApiSourceForWorkflow({
    db: input.c.var.storage.db,
    dependencies: input.dependencies,
    organizationId: input.organizationId,
    resourceCache: input.resourceCache,
    sourceKey: input.source.sourceKey,
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
  resourceCache: SourceApiWorkflowResourceCache;
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
  resourceCache: SourceApiWorkflowResourceCache;
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
    resourceCache: input.resourceCache,
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
    effects: input.currentDecision.freshEffects,
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
    effects: input.currentDecision.journalEffects,
  });
}

function findSourceApiActionJournalEffect<
  EffectType extends SourceApiActionEffect["type"],
>(input: {
  currentDecision: StoredAcceptedSourceApiActionDecision;
  effects: readonly WorkflowJournalEffectToken<SourceApiActionEffect>[];
  expectedEffectType: EffectType;
}): LoadedSourceApiActionEffect<EffectType> | null {
  const effectIndex = input.effects.findIndex(
    (effect) => effect.effect.type === input.expectedEffectType
  );
  if (effectIndex === -1) {
    return null;
  }

  const effect = input.effects[effectIndex];
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

async function recordSourceApiActionEffectFailure(input: {
  currentDecision: StoredAcceptedSourceApiActionDecision;
  db: Database;
  effectId: string;
  error: unknown;
  organizationId: string;
}) {
  const recorded = await recordSourceApiActionEffectFailureViaJournal({
    actionId: input.currentDecision.actionId,
    db: input.db,
    effectId: input.effectId,
    errorCode: "dispatch_failed",
    errorDetail: toCliErrorMessage(input.error),
    organizationId: input.organizationId,
  });
  if (recorded.isErr()) {
    throw createSourceApiAuditFailure(
      `source_api_action effect ${input.effectId} failure could not be recorded in the journal`,
      recorded.error
    );
  }
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
