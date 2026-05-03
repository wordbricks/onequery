import { sourceApiActions, ulid } from "@onequery/db/server";
import type { Database } from "@onequery/db/server";
import type { Result as ResultType } from "better-result";
import { Result } from "better-result";

import type { WorkflowCommittedEvent, WorkflowDecision } from "../kernel";
import type {
  SourceApiActionCommand,
  SourceApiActionCommandPayload,
  SourceApiActionEffect,
  SourceApiActionEvent,
  SourceApiActionRejectCode,
  SourceApiActionState,
} from "../source-api-action-family";
import {
  decideSourceApiAction,
  reduceSourceApiAction,
} from "../source-api-action-family";
import {
  decodeSourceApiActionCommandPayload,
  decodeSourceApiActionEffectPayload,
  decodeSourceApiActionEventPayload,
  encodeSourceApiActionCommandPayload,
  encodeSourceApiActionEffectPayload,
  encodeSourceApiActionEventPayload,
  getSourceApiActionCommandPayloadType,
} from "../source-api-action-family/protobuf-codec";
import {
  WorkflowStorageContentionError,
  WorkflowStorageWriteError,
} from "./errors";
import type { WorkflowStorageError } from "./errors";
import {
  appendWorkflowJournalBatch,
  foldWorkflowJournalEntries,
  WorkflowJournalCorruptStreamError,
  WorkflowJournalExpectedPositionConflictError,
} from "./journal";
import type {
  WorkflowJournalAppendResult,
  WorkflowJournalCommandEntry,
  WorkflowJournalEffectFailedEntry,
  WorkflowJournalEffectStartedEntry,
  WorkflowJournalEffectToken,
  WorkflowJournalEntry,
  WorkflowJournalEventEntry,
  WorkflowJournalStore,
} from "./journal";
import { createDbWorkflowJournalStore } from "./journal-db";
import type {
  WorkflowJournalPayloadCodec,
  WorkflowJournalPayloadCodecContext,
} from "./journal-db";
import { toWorkflowProjectionJson } from "./serialization";
import { MAX_STORAGE_COMMIT_ATTEMPTS } from "./types";
import type { DatabaseTransaction, StoredWorkflowDecision } from "./types";

type SourceApiActionJournalStore = WorkflowJournalStore<
  SourceApiActionCommandPayload,
  SourceApiActionEvent,
  SourceApiActionEffect
>;

type SourceApiActionJournalAppendResult = WorkflowJournalAppendResult<
  SourceApiActionState,
  SourceApiActionCommandPayload,
  SourceApiActionEvent,
  SourceApiActionEffect
>;

type SourceApiActionJournalStorageError =
  | WorkflowStorageError
  | WorkflowJournalCorruptStreamError
  | WorkflowJournalExpectedPositionConflictError;

type RejectedDecisionCheckpointPayload = {
  actionId: string | null;
  rejectCode: SourceApiActionRejectCode;
  rejectDetail: string | null;
};

type StoredSourceApiActionJournalCommand = {
  commandPayload: SourceApiActionCommandPayload;
  completedEffectIds: readonly string[];
  decision: StoredSourceApiActionJournalDecision;
};

type StoredSourceApiActionJournalDecision =
  | Extract<
      StoredWorkflowDecision<
        "source_api_action",
        SourceApiActionEvent,
        SourceApiActionRejectCode
      >,
      { kind: "rejected" }
    >
  | (Extract<
      StoredWorkflowDecision<
        "source_api_action",
        SourceApiActionEvent,
        SourceApiActionRejectCode
      >,
      { kind: "accepted" }
    > & {
      freshEffects?: readonly WorkflowJournalEffectToken<SourceApiActionEffect>[];
      journalEffects?: readonly WorkflowJournalEffectToken<SourceApiActionEffect>[];
    });

const REJECTED_DECISION_CHECKPOINT = "decision_rejected";
const SOURCE_API_ACTION_EFFECT_WORKER_ID = "source-api-action-runtime";

const sourceApiActionJournalPayloadCodec: WorkflowJournalPayloadCodec<
  SourceApiActionCommandPayload,
  SourceApiActionEvent,
  SourceApiActionEffect
> = {
  decodeCommandPayload: (bytes, context) =>
    decodeSourceApiActionCommandPayload(
      bytes,
      toSourceApiActionPayloadContext(context)
    ),
  decodeEffectPayload: (bytes, context) =>
    decodeSourceApiActionEffectPayload(
      bytes,
      toSourceApiActionPayloadContext(context)
    ),
  decodeEventPayload: (bytes, context) =>
    decodeSourceApiActionEventPayload(
      bytes,
      toSourceApiActionPayloadContext(context)
    ),
  encodeCommandPayload: (payload) =>
    encodeSourceApiActionCommandPayload(payload),
  encodeEffectPayload: (effect) => encodeSourceApiActionEffectPayload(effect),
  encodeEventPayload: (event) => encodeSourceApiActionEventPayload(event),
};

export async function storeSourceApiActionCommandViaJournal(input: {
  command: SourceApiActionCommand;
  completedEffectId?: string;
  db: Database;
}): Promise<
  ResultType<
    StoredSourceApiActionJournalDecision,
    SourceApiActionJournalStorageError
  >
> {
  const { command, db } = input;

  const existing = await loadSourceApiActionCommandViaJournal({
    commandInvocationId: command.commandInvocationId,
    db,
  });
  if (existing.isErr()) {
    return Result.err(existing.error);
  }
  if (existing.value !== null) {
    return Result.ok(existing.value.decision);
  }

  for (let attempt = 1; attempt <= MAX_STORAGE_COMMIT_ATTEMPTS; attempt += 1) {
    const actionId = command.actionId ?? ulid();
    const store = createSourceApiActionJournalStore({ db });
    const streamEntries = await store.loadStream({
      family: "source_api_action",
      streamId: actionId,
    });
    const cursor = foldWorkflowJournalEntries({
      entries: streamEntries,
      reduce: reduceSourceApiActionJournalEvent,
      streamId: actionId,
    });
    if (cursor.isErr()) {
      return Result.err(cursor.error);
    }

    const currentState = cursor.value.state;
    const decision = decideSourceApiAction(currentState, command);
    if (decision.isErr()) {
      return Result.err(decision.error);
    }

    const appendStore = createSourceApiActionJournalStore({
      db,
      onAppendEntries: ({ entries, tx }) =>
        projectFreshSourceApiActionJournalAppend({
          actionId,
          command,
          currentState,
          decision: decision.value,
          entries,
          tx,
        }),
    });
    const appended = await appendWorkflowJournalBatch({
      checkpoints:
        decision.value.kind === "rejected"
          ? [
              {
                checkpointName: REJECTED_DECISION_CHECKPOINT,
                checkpointPayload: {
                  actionId: command.actionId,
                  rejectCode: decision.value.rejectCode,
                  rejectDetail: decision.value.rejectDetail ?? null,
                } satisfies RejectedDecisionCheckpointPayload,
              },
            ]
          : [],
      commandInvocationId: command.commandInvocationId,
      commandPayload: command.commandPayload,
      commandType: getSourceApiActionCommandPayloadType(command.commandPayload),
      effectCompletions:
        decision.value.kind !== "accepted" ||
        input.completedEffectId === undefined
          ? []
          : [
              {
                effectId: input.completedEffectId,
              },
            ],
      effects: decision.value.kind === "accepted" ? decision.value.effects : [],
      events: decision.value.kind === "accepted" ? decision.value.events : [],
      expectedStreamPosition: cursor.value.streamPosition,
      family: "source_api_action",
      occurredAt: command.observedAt,
      organizationId: command.organizationId,
      reduce: reduceSourceApiActionJournalEvent,
      store: appendStore,
      streamId: actionId,
    });

    if (appended.isErr()) {
      if (
        appended.error instanceof WorkflowJournalExpectedPositionConflictError
      ) {
        continue;
      }

      return Result.err(appended.error);
    }

    return toStoredSourceApiActionJournalDecision(appended.value).map(
      (stored) => stored.decision
    );
  }

  return Result.err(
    new WorkflowStorageContentionError({
      ...(command.actionId === null ? {} : { actionId: command.actionId }),
      attempts: MAX_STORAGE_COMMIT_ATTEMPTS,
      family: "source_api_action",
    })
  );
}

export async function loadSourceApiActionCommandViaJournal(input: {
  commandInvocationId: string;
  db: Database;
}): Promise<
  ResultType<
    StoredSourceApiActionJournalCommand | null,
    SourceApiActionJournalStorageError
  >
> {
  const store = createSourceApiActionJournalStore({ db: input.db });
  const entries = await store.loadEntriesByCommandInvocation({
    commandInvocationId: input.commandInvocationId,
    family: "source_api_action",
  });

  if (entries === null) {
    return Result.ok(null);
  }

  const replayed = await replayStoredSourceApiActionJournalCommand({
    entries,
    idempotency: "replayed",
    store,
  });
  return replayed;
}

export async function claimFailedSourceApiActionEffectViaJournal(input: {
  actionId: string;
  db: Database;
  effectId: string;
  organizationId: string;
}): Promise<
  ResultType<
    WorkflowJournalEffectToken<SourceApiActionEffect>,
    SourceApiActionJournalStorageError
  >
> {
  for (let attempt = 1; attempt <= MAX_STORAGE_COMMIT_ATTEMPTS; attempt += 1) {
    const store = createSourceApiActionJournalStore({ db: input.db });
    const streamEntries = await store.loadStream({
      family: "source_api_action",
      streamId: input.actionId,
    });
    const cursor = foldWorkflowJournalEntries({
      entries: streamEntries,
      reduce: reduceSourceApiActionJournalEvent,
      streamId: input.actionId,
    });
    if (cursor.isErr()) {
      return Result.err(cursor.error);
    }

    const effectState = cursor.value.effects.find(
      (known) => known.effectId === input.effectId
    );
    const effect = cursor.value.pendingEffects.find(
      (pending) => pending.effectId === input.effectId
    );
    if (effectState === undefined || effectState.status !== "failed") {
      return Result.err(
        new WorkflowJournalCorruptStreamError({
          detail: `source_api_action effect ${input.effectId} is not failed in journal state`,
          family: "source_api_action",
          streamId: input.actionId,
        })
      );
    }
    if (effect === undefined) {
      return Result.err(
        new WorkflowJournalCorruptStreamError({
          detail: `source_api_action failed effect ${input.effectId} is not runnable from journal state`,
          family: "source_api_action",
          streamId: input.actionId,
        })
      );
    }

    const occurredAt = new Date();
    const entry: WorkflowJournalEffectStartedEntry = {
      commitId: ulid(),
      effectId: input.effectId,
      entryId: ulid(),
      family: "source_api_action",
      kind: "effect_started",
      occurredAt,
      organizationId: input.organizationId,
      streamId: input.actionId,
      streamPosition: cursor.value.streamPosition + 1,
      workerId: SOURCE_API_ACTION_EFFECT_WORKER_ID,
    };
    const appended = await store.appendEntries({
      entries: [entry],
      expectedStreamPosition: cursor.value.streamPosition,
    });

    if (appended.kind === "appended") {
      return Result.ok(effect);
    }
    if (appended.kind === "position_conflict") {
      continue;
    }

    return Result.err(
      new WorkflowJournalCorruptStreamError({
        detail:
          "source_api_action effect claim append unexpectedly conflicted on command idempotency",
        family: "source_api_action",
        streamId: input.actionId,
      })
    );
  }

  return Result.err(
    new WorkflowStorageContentionError({
      actionId: input.actionId,
      attempts: MAX_STORAGE_COMMIT_ATTEMPTS,
      family: "source_api_action",
    })
  );
}

export async function recordSourceApiActionEffectFailureViaJournal(input: {
  actionId: string;
  db: Database;
  effectId: string;
  errorCode: string;
  errorDetail?: string | null;
  organizationId: string;
}): Promise<ResultType<void, SourceApiActionJournalStorageError>> {
  for (let attempt = 1; attempt <= MAX_STORAGE_COMMIT_ATTEMPTS; attempt += 1) {
    const store = createSourceApiActionJournalStore({ db: input.db });
    const streamEntries = await store.loadStream({
      family: "source_api_action",
      streamId: input.actionId,
    });
    const cursor = foldWorkflowJournalEntries({
      entries: streamEntries,
      reduce: reduceSourceApiActionJournalEvent,
      streamId: input.actionId,
    });
    if (cursor.isErr()) {
      return Result.err(cursor.error);
    }

    const effect = cursor.value.effects.find(
      (known) => known.effectId === input.effectId
    );
    if (effect === undefined || effect.status === "completed") {
      return Result.err(
        new WorkflowJournalCorruptStreamError({
          detail: `source_api_action effect ${input.effectId} cannot be marked failed from journal state`,
          family: "source_api_action",
          streamId: input.actionId,
        })
      );
    }

    const occurredAt = new Date();
    const entry: WorkflowJournalEffectFailedEntry = {
      commitId: ulid(),
      effectId: input.effectId,
      entryId: ulid(),
      errorCode: input.errorCode,
      errorDetail: input.errorDetail ?? null,
      family: "source_api_action",
      kind: "effect_failed",
      occurredAt,
      organizationId: input.organizationId,
      streamId: input.actionId,
      streamPosition: cursor.value.streamPosition + 1,
    };
    const appended = await store.appendEntries({
      entries: [entry],
      expectedStreamPosition: cursor.value.streamPosition,
    });

    if (appended.kind === "appended") {
      return Result.ok(undefined);
    }
    if (appended.kind === "position_conflict") {
      continue;
    }

    return Result.err(
      new WorkflowJournalCorruptStreamError({
        detail:
          "source_api_action effect failure append unexpectedly conflicted on command idempotency",
        family: "source_api_action",
        streamId: input.actionId,
      })
    );
  }

  return Result.err(
    new WorkflowStorageContentionError({
      actionId: input.actionId,
      attempts: MAX_STORAGE_COMMIT_ATTEMPTS,
      family: "source_api_action",
    })
  );
}

function createSourceApiActionJournalStore(input: {
  db: Database;
  onAppendEntries?: (input: {
    entries: readonly WorkflowJournalEntry<
      SourceApiActionCommandPayload,
      SourceApiActionEvent,
      SourceApiActionEffect
    >[];
    expectedStreamPosition: number;
    tx: DatabaseTransaction;
  }) => Promise<void>;
}): SourceApiActionJournalStore {
  return createDbWorkflowJournalStore({
    codec: sourceApiActionJournalPayloadCodec,
    db: input.db,
    onAppendEntries: input.onAppendEntries,
  });
}

async function replayStoredSourceApiActionJournalCommand(input: {
  entries: readonly WorkflowJournalEntry<
    SourceApiActionCommandPayload,
    SourceApiActionEvent,
    SourceApiActionEffect
  >[];
  idempotency: "fresh" | "replayed";
  store: SourceApiActionJournalStore;
}) {
  const commandEntry = findCommandEntry(input.entries);
  if (commandEntry === undefined) {
    return Result.err(
      new WorkflowJournalCorruptStreamError({
        detail:
          "source_api_action journal command replay found a commit without a command entry",
      })
    );
  }

  const lastBatchPosition = getLastStreamPosition(input.entries);
  const streamEntries = (
    await input.store.loadStream({
      family: "source_api_action",
      streamId: commandEntry.streamId,
    })
  ).filter((entry) => entry.streamPosition <= lastBatchPosition);
  const cursor = foldWorkflowJournalEntries({
    entries: streamEntries,
    reduce: reduceSourceApiActionJournalEvent,
    streamId: commandEntry.streamId,
  });
  if (cursor.isErr()) {
    return Result.err(cursor.error);
  }

  return toStoredSourceApiActionJournalDecision({
    commitId: commandEntry.commitId,
    cursor: cursor.value,
    entries: input.entries,
    freshEffects: [],
    idempotency: input.idempotency,
  });
}

async function projectFreshSourceApiActionJournalAppend(input: {
  actionId: string;
  command: SourceApiActionCommand;
  currentState: SourceApiActionState | null;
  decision: WorkflowDecision<
    SourceApiActionEvent,
    SourceApiActionEffect,
    SourceApiActionRejectCode
  >;
  entries: readonly WorkflowJournalEntry<
    SourceApiActionCommandPayload,
    SourceApiActionEvent,
    SourceApiActionEffect
  >[];
  tx: DatabaseTransaction;
}) {
  if (input.decision.kind === "rejected") {
    return;
  }

  const committedEvents = toCommittedEvents({
    currentState: input.currentState,
    entries: input.entries,
  });
  if (committedEvents.length === 0) {
    throw new WorkflowStorageWriteError({
      actionId: input.actionId,
      family: "source_api_action",
      operation: "project_journal_events",
    });
  }

  const nextState = reduceCommittedEvents({
    currentState: input.currentState,
    events: committedEvents,
  });
  if (nextState.isErr()) {
    throw nextState.error;
  }

  const actionColumns = toSourceApiActionColumns(nextState.value);
  await input.tx
    .insert(sourceApiActions)
    .values({
      id: input.actionId,
      organizationId: input.command.organizationId,
      ...actionColumns,
    })
    .onConflictDoUpdate({
      set: actionColumns,
      target: sourceApiActions.id,
    });
}

function toStoredSourceApiActionJournalDecision(
  input: SourceApiActionJournalAppendResult
): ResultType<
  StoredSourceApiActionJournalCommand,
  SourceApiActionJournalStorageError
> {
  const commandEntry = findCommandEntry(input.entries);
  if (commandEntry === undefined) {
    return Result.err(
      new WorkflowJournalCorruptStreamError({
        detail:
          "source_api_action journal replay found a commit without a command entry",
      })
    );
  }

  const rejected = findRejectedDecisionCheckpoint(input.entries);
  if (rejected !== null) {
    return Result.ok({
      commandPayload: commandEntry.commandPayload,
      completedEffectIds: collectCompletedEffectIds(input.entries),
      decision: {
        actionId: rejected.actionId,
        commandId: commandEntry.entryId,
        family: "source_api_action",
        idempotency: input.idempotency,
        kind: "rejected",
        rejectCode: rejected.rejectCode,
        ...(rejected.rejectDetail === null
          ? {}
          : { rejectDetail: rejected.rejectDetail }),
      },
    });
  }

  const sequenceByEventId = new Map(
    input.cursor.events.map((entry, index) => [entry.eventId, index + 1])
  );
  const events = input.entries.flatMap((entry) => {
    if (entry.kind !== "event") {
      return [];
    }

    const sequence = sequenceByEventId.get(entry.eventId);
    if (sequence === undefined) {
      throw new WorkflowJournalCorruptStreamError({
        detail: `source_api_action journal event ${entry.eventId} is missing from folded cursor`,
        entryId: entry.entryId,
        family: "source_api_action",
        streamId: entry.streamId,
      });
    }

    return [
      {
        ...entry.event,
        id: entry.eventId,
        occurredAt: entry.occurredAt,
        sequence,
      } satisfies WorkflowCommittedEvent<SourceApiActionEvent>,
    ];
  });

  if (events.length === 0) {
    return Result.err(
      new WorkflowJournalCorruptStreamError({
        detail:
          "source_api_action journal accepted command replay found no event entries",
        entryId: commandEntry.entryId,
        family: "source_api_action",
        streamId: commandEntry.streamId,
      })
    );
  }

  return Result.ok({
    commandPayload: commandEntry.commandPayload,
    completedEffectIds: collectCompletedEffectIds(input.entries),
    decision: {
      actionId: commandEntry.streamId,
      commandId: commandEntry.entryId,
      events,
      family: "source_api_action",
      freshEffects: input.freshEffects,
      idempotency: input.idempotency,
      journalEffects: collectScheduledEffectTokens(input.entries),
      kind: "accepted",
    },
  });
}

function collectScheduledEffectTokens(
  entries: readonly WorkflowJournalEntry<
    SourceApiActionCommandPayload,
    SourceApiActionEvent,
    SourceApiActionEffect
  >[]
): WorkflowJournalEffectToken<SourceApiActionEffect>[] {
  return entries.flatMap((entry) =>
    entry.kind === "effect_scheduled"
      ? [
          {
            effect: entry.effect,
            effectId: entry.effectId,
            effectType: entry.effectType,
            scheduledAt: entry.occurredAt,
            scheduledByEntryId: entry.entryId,
            streamId: entry.streamId,
            streamPosition: entry.streamPosition,
          },
        ]
      : []
  );
}

function collectCompletedEffectIds(
  entries: readonly WorkflowJournalEntry<
    SourceApiActionCommandPayload,
    SourceApiActionEvent,
    SourceApiActionEffect
  >[]
): string[] {
  return entries.flatMap((entry) =>
    entry.kind === "effect_completed" ? [entry.effectId] : []
  );
}

function reduceSourceApiActionJournalEvent(
  state: SourceApiActionState | null,
  entry: WorkflowJournalEventEntry<SourceApiActionEvent>
) {
  return reduceSourceApiAction(state, {
    ...entry.event,
    id: entry.eventId,
    occurredAt: entry.occurredAt,
    sequence: (state?.lastEventSequence ?? 0) + 1,
  });
}

function reduceCommittedEvents(input: {
  currentState: SourceApiActionState | null;
  events: readonly WorkflowCommittedEvent<SourceApiActionEvent>[];
}) {
  let state = input.currentState;

  for (const event of input.events) {
    const reduced = reduceSourceApiAction(state, event);
    if (reduced.isErr()) {
      return reduced;
    }
    state = reduced.value;
  }

  if (state === null) {
    return Result.err(
      new WorkflowStorageWriteError({
        family: "source_api_action",
        operation: "fold_journal_projection",
      })
    );
  }

  return Result.ok(state);
}

function toCommittedEvents(input: {
  currentState: SourceApiActionState | null;
  entries: readonly WorkflowJournalEntry<
    SourceApiActionCommandPayload,
    SourceApiActionEvent,
    SourceApiActionEffect
  >[];
}): WorkflowCommittedEvent<SourceApiActionEvent>[] {
  let sequence = input.currentState?.lastEventSequence ?? 0;

  return input.entries.flatMap((entry) => {
    if (entry.kind !== "event") {
      return [];
    }

    sequence += 1;
    return [
      {
        ...entry.event,
        id: entry.eventId,
        occurredAt: entry.occurredAt,
        sequence,
      } satisfies WorkflowCommittedEvent<SourceApiActionEvent>,
    ];
  });
}

function findCommandEntry(
  entries: readonly WorkflowJournalEntry<
    SourceApiActionCommandPayload,
    SourceApiActionEvent,
    SourceApiActionEffect
  >[]
): WorkflowJournalCommandEntry<SourceApiActionCommandPayload> | undefined {
  return entries.find(
    (
      entry
    ): entry is WorkflowJournalCommandEntry<SourceApiActionCommandPayload> =>
      entry.kind === "command"
  );
}

function findRejectedDecisionCheckpoint(
  entries: readonly WorkflowJournalEntry<
    SourceApiActionCommandPayload,
    SourceApiActionEvent,
    SourceApiActionEffect
  >[]
): RejectedDecisionCheckpointPayload | null {
  const checkpoint = entries.find(
    (entry) =>
      entry.kind === "checkpoint" &&
      entry.checkpointName === REJECTED_DECISION_CHECKPOINT
  );
  if (checkpoint === undefined || checkpoint.kind !== "checkpoint") {
    return null;
  }

  const payload = checkpoint.checkpointPayload;
  if (
    typeof payload !== "object" ||
    payload === null ||
    !("actionId" in payload) ||
    !("rejectCode" in payload)
  ) {
    throw new WorkflowJournalCorruptStreamError({
      detail:
        "source_api_action journal rejected command checkpoint has an invalid payload",
      entryId: checkpoint.entryId,
      family: "source_api_action",
      streamId: checkpoint.streamId,
    });
  }

  const actionId = payload.actionId;
  const rejectCode = payload.rejectCode;
  const rejectDetail = "rejectDetail" in payload ? payload.rejectDetail : null;
  if (
    (actionId !== null && typeof actionId !== "string") ||
    typeof rejectCode !== "string" ||
    (rejectDetail !== null && typeof rejectDetail !== "string")
  ) {
    throw new WorkflowJournalCorruptStreamError({
      detail:
        "source_api_action journal rejected command checkpoint has invalid reject fields",
      entryId: checkpoint.entryId,
      family: "source_api_action",
      streamId: checkpoint.streamId,
    });
  }

  return {
    actionId,
    rejectCode: rejectCode as SourceApiActionRejectCode,
    rejectDetail,
  };
}

function getLastStreamPosition(
  entries: readonly WorkflowJournalEntry<
    SourceApiActionCommandPayload,
    SourceApiActionEvent,
    SourceApiActionEffect
  >[]
) {
  return entries.reduce(
    (position, entry) => Math.max(position, entry.streamPosition),
    0
  );
}

function toSourceApiActionPayloadContext(
  context: WorkflowJournalPayloadCodecContext
) {
  return {
    actionId: context.streamId,
    commandId: context.entryId,
    payloadType: context.payloadType,
  };
}

function toSourceApiActionColumns(state: SourceApiActionState) {
  return {
    attemptNumber: state.attemptNumber,
    completedAt: state.completedAt,
    failureCode: state.failureCode,
    invokeMode: state.invokeMode,
    lastEventId: state.lastEventId,
    lastEventSequence: state.lastEventSequence,
    outcome: state.outcome,
    pageProgressJson:
      state.pageProgress === null
        ? null
        : toWorkflowProjectionJson(state.pageProgress),
    phase: state.phase,
    preparedRequestFingerprint: state.preparedRequestFingerprint,
    requestDescriptorJson:
      state.requestDescriptor === null
        ? null
        : toWorkflowProjectionJson(state.requestDescriptor),
    requestKind: state.requestKind,
    sourceDescriptorJson:
      state.sourceDescriptor === null
        ? null
        : toWorkflowProjectionJson(state.sourceDescriptor),
    startedAt: state.startedAt,
  };
}
