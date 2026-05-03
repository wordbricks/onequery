import {
  inArray,
  sourceApiActionEvents,
  sourceApiActions,
  ulid,
  workflowCommands,
  workflowEffectDispatches,
} from "@onequery/db/server";
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
  const commandEntry = requireCommandEntry(input.entries);

  await input.tx.insert(workflowCommands).values({
    actionId:
      input.decision.kind === "accepted"
        ? input.actionId
        : input.command.actionId,
    actorSnapshotJson: {
      authMode: input.command.actorSnapshot.authMode,
      email: input.command.actorSnapshot.email,
      membershipRoles: [...input.command.actorSnapshot.membershipRoles],
      userId: input.command.actorSnapshot.userId,
    },
    causedByEventId: input.command.causedByEventId,
    commandInvocationId: input.command.commandInvocationId,
    commandPayloadBytes: encodeSourceApiActionCommandPayload(
      input.command.commandPayload
    ),
    commandType: getSourceApiActionCommandPayloadType(
      input.command.commandPayload
    ),
    createdAt: input.command.observedAt,
    decisionKind: input.decision.kind,
    family: "source_api_action",
    id: commandEntry.entryId,
    organizationId: input.command.organizationId,
    rejectCode:
      input.decision.kind === "rejected" ? input.decision.rejectCode : null,
    rejectDetail:
      input.decision.kind === "rejected"
        ? (input.decision.rejectDetail ?? null)
        : null,
    requestId: input.command.requestId,
    surface: input.command.surface,
  });

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

  await input.tx.insert(sourceApiActionEvents).values(
    committedEvents.map((event) => ({
      actionId: input.actionId,
      commandId: commandEntry.entryId,
      eventType: event.type,
      id: event.id,
      occurredAt: event.occurredAt,
      payloadBytes: encodeSourceApiActionEventPayload(event),
      sequence: event.sequence,
    }))
  );

  const lastEvent = committedEvents.at(-1);
  if (!lastEvent) {
    throw new WorkflowStorageWriteError({
      actionId: input.actionId,
      family: "source_api_action",
      operation: "project_journal_effect_dispatches",
    });
  }

  const scheduledEffects = input.entries.filter(
    (
      entry
    ): entry is Extract<
      WorkflowJournalEntry<
        SourceApiActionCommandPayload,
        SourceApiActionEvent,
        SourceApiActionEffect
      >,
      { kind: "effect_scheduled" }
    > => entry.kind === "effect_scheduled"
  );
  if (scheduledEffects.length > 0) {
    await input.tx.insert(workflowEffectDispatches).values(
      scheduledEffects.map((entry, index) => ({
        actionId: input.actionId,
        attemptCount: 0,
        availableAt: entry.occurredAt,
        createdAt: entry.occurredAt,
        effectKey: `source_api_action:${lastEvent.id}:${index + 1}`,
        effectType: entry.effectType,
        family: "source_api_action" as const,
        id: entry.effectId,
        originEventId: lastEvent.id,
        payloadBytes: encodeSourceApiActionEffectPayload(entry.effect),
        status: "pending" as const,
      }))
    );
  }

  const completedEffects = input.entries.filter(
    (
      entry
    ): entry is Extract<
      WorkflowJournalEntry<
        SourceApiActionCommandPayload,
        SourceApiActionEvent,
        SourceApiActionEffect
      >,
      { kind: "effect_completed" }
    > => entry.kind === "effect_completed"
  );
  const firstCompletedEffect = completedEffects[0];
  if (firstCompletedEffect !== undefined) {
    await input.tx
      .update(workflowEffectDispatches)
      .set({
        completedAt: firstCompletedEffect.occurredAt,
        lastErrorCode: null,
        lastErrorDetail: null,
        leasedUntil: null,
        status: "completed",
      })
      .where(
        inArray(
          workflowEffectDispatches.id,
          completedEffects.map((effect) => effect.effectId)
        )
      );
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

function requireCommandEntry(
  entries: readonly WorkflowJournalEntry<
    SourceApiActionCommandPayload,
    SourceApiActionEvent,
    SourceApiActionEffect
  >[]
) {
  const commandEntry = findCommandEntry(entries);
  if (commandEntry === undefined) {
    throw new WorkflowStorageWriteError({
      family: "source_api_action",
      operation: "project_journal_command",
    });
  }

  return commandEntry;
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
