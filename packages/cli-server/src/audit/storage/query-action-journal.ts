import {
  and,
  asc,
  eq,
  inArray,
  pendingWorkflowEffects,
  queryActions,
  sql,
  ulid,
  workflowJournal,
} from "@onequery/db/server";
import type { Database, NewPendingWorkflowEffect } from "@onequery/db/server";
import type { Result as ResultType } from "better-result";
import { Result } from "better-result";

import type { WorkflowCommittedEvent, WorkflowDecision } from "../kernel";
import type {
  QueryActionCommand,
  QueryActionCommandPayload,
  QueryActionEffect,
  QueryActionEvent,
  QueryActionRejectCode,
  QueryActionState,
} from "../query-action-family";
import { decideQueryAction, reduceQueryAction } from "../query-action-family";
import {
  decodeQueryActionCommandPayload,
  decodeQueryActionEffectPayload,
  decodeQueryActionEventPayload,
  encodeQueryActionCommandPayload,
  encodeQueryActionEffectPayload,
  encodeQueryActionEventPayload,
  getQueryActionCommandPayloadType,
} from "../query-action-family/protobuf-codec";
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
  WorkflowJournalCheckpointIntent,
  WorkflowJournalEffectFailedEntry,
  WorkflowJournalEffectStartedEntry,
  WorkflowJournalEffectState,
  WorkflowJournalEffectToken,
  WorkflowJournalEntry,
  WorkflowJournalEventEntry,
  WorkflowJournalCursor,
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

type QueryActionJournalStore = WorkflowJournalStore<
  QueryActionCommandPayload,
  QueryActionEvent,
  QueryActionEffect
>;

type QueryActionJournalAppendResult = WorkflowJournalAppendResult<
  QueryActionState,
  QueryActionCommandPayload,
  QueryActionEvent,
  QueryActionEffect
>;

type QueryActionEffectType = QueryActionEffect["type"];
type QueryActionEffectOfType<Type extends QueryActionEffectType> = Extract<
  QueryActionEffect,
  { type: Type }
>;

type QueryActionJournalStorageError =
  | WorkflowStorageError
  | WorkflowJournalCorruptStreamError
  | WorkflowJournalExpectedPositionConflictError;

type StoredQueryActionJournalCommand = {
  commandPayload: QueryActionCommandPayload;
  completedEffectIds: readonly string[];
  decision: StoredQueryActionJournalDecision;
};

type QueryActionJournalCursor = WorkflowJournalCursor<
  QueryActionState,
  QueryActionCommandPayload,
  QueryActionEvent,
  QueryActionEffect
>;

type RejectedDecisionCheckpointPayload = {
  actionId: string | null;
  rejectCode: QueryActionRejectCode;
  rejectDetail: string | null;
};

type StoredQueryActionJournalDecision =
  | Extract<
      StoredWorkflowDecision<
        "query_action",
        QueryActionEvent,
        QueryActionRejectCode
      >,
      { kind: "rejected" }
    >
  | (Extract<
      StoredWorkflowDecision<
        "query_action",
        QueryActionEvent,
        QueryActionRejectCode
      >,
      { kind: "accepted" }
    > & {
      cursor: QueryActionJournalCursor;
      freshEffects: readonly WorkflowJournalEffectToken<QueryActionEffect>[];
      journalEffects: readonly WorkflowJournalEffectToken<QueryActionEffect>[];
    });

const REJECTED_DECISION_CHECKPOINT = "decision_rejected";
const QUERY_ACTION_EFFECT_WORKER_ID = "query-action-runtime";
const PENDING_QUERY_ACTION_EFFECT_TYPES = new Set<QueryActionEffectType>([
  "persist_usage",
]);

const queryActionJournalPayloadCodec: WorkflowJournalPayloadCodec<
  QueryActionCommandPayload,
  QueryActionEvent,
  QueryActionEffect
> = {
  decodeCommandPayload: (bytes, context) =>
    decodeQueryActionCommandPayload(
      bytes,
      toQueryActionPayloadContext(context)
    ),
  decodeEffectPayload: (bytes, context) =>
    decodeQueryActionEffectPayload(bytes, toQueryActionPayloadContext(context)),
  decodeEventPayload: (bytes, context) =>
    decodeQueryActionEventPayload(bytes, toQueryActionPayloadContext(context)),
  encodeCommandPayload: (payload) => encodeQueryActionCommandPayload(payload),
  encodeEffectPayload: (effect) => encodeQueryActionEffectPayload(effect),
  encodeEventPayload: (event) => encodeQueryActionEventPayload(event),
};

function createEmptyQueryActionJournalCursor(
  streamId: string
): QueryActionJournalCursor {
  return {
    checkpoint: null,
    commands: [],
    effects: [],
    events: [],
    pendingEffects: [],
    state: null,
    streamId,
    streamPosition: 0,
  };
}

export async function storeQueryActionCommandViaJournal(input: {
  command: QueryActionCommand;
  completedEffectId?: string;
  currentCursor?: QueryActionJournalCursor;
  db: Database;
}): Promise<
  ResultType<StoredQueryActionJournalDecision, QueryActionJournalStorageError>
> {
  const { command, db } = input;
  let carriedCursor = input.currentCursor;

  for (let attempt = 1; attempt <= MAX_STORAGE_COMMIT_ATTEMPTS; attempt += 1) {
    const actionId = command.actionId ?? carriedCursor?.streamId ?? ulid();
    const store = createQueryActionJournalStore({ db });
    const isFreshGeneratedStream =
      command.actionId === null && carriedCursor === undefined;
    const trustedCurrentCursor =
      carriedCursor?.streamId === actionId ? carriedCursor : undefined;
    const cursor =
      trustedCurrentCursor !== undefined
        ? Result.ok(trustedCurrentCursor)
        : isFreshGeneratedStream
          ? Result.ok(createEmptyQueryActionJournalCursor(actionId))
          : foldWorkflowJournalEntries({
              entries: await store.loadStream({
                family: "query_action",
                streamId: actionId,
              }),
              reduce: reduceQueryActionJournalEvent,
              streamId: actionId,
            });
    if (cursor.isErr()) {
      return Result.err(cursor.error);
    }

    const currentState = cursor.value.state;
    const decision = decideQueryAction(currentState, command);
    if (decision.isErr()) {
      return Result.err(decision.error);
    }

    const appendStore = createQueryActionJournalStore({
      db,
      pendingEffectIds: collectPendingProjectionEffectIds(cursor.value),
      onAppendEntries: ({ entries, tx }) =>
        projectFreshQueryActionJournalAppend({
          actionId,
          command,
          currentState,
          decision: decision.value,
          entries,
          tx,
        }),
    });
    const appended = await appendWorkflowJournalBatch({
      checkpoints: buildQueryActionJournalCheckpoints({
        command,
        decision: decision.value,
      }),
      commandInvocationId: command.commandInvocationId,
      commandMetadata: {
        actorSnapshot: command.actorSnapshot,
        causedByEventId: command.causedByEventId,
        requestId: command.requestId,
        surface: command.surface,
      },
      commandPayload: command.commandPayload,
      commandType: getQueryActionCommandPayloadType(command.commandPayload),
      currentCursor: cursor.value,
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
      family: "query_action",
      occurredAt: command.observedAt,
      organizationId: command.organizationId,
      reduce: reduceQueryActionJournalEvent,
      store: appendStore,
      streamId: actionId,
      // Comment: carried cursors are produced by a prior accepted decision in
      // this stream; DB unique constraints still replay idempotency and position
      // races if the optimistic append loses.
      skipStorePreflightChecks:
        isFreshGeneratedStream || trustedCurrentCursor !== undefined,
    });

    if (appended.isErr()) {
      if (
        appended.error instanceof WorkflowJournalExpectedPositionConflictError
      ) {
        carriedCursor = undefined;
        continue;
      }

      return Result.err(appended.error);
    }

    return toStoredQueryActionJournalCommand(appended.value).map(
      (stored) => stored.decision
    );
  }

  return Result.err(
    new WorkflowStorageContentionError({
      ...(command.actionId === null ? {} : { actionId: command.actionId }),
      attempts: MAX_STORAGE_COMMIT_ATTEMPTS,
      family: "query_action",
    })
  );
}

function buildQueryActionJournalCheckpoints(input: {
  command: QueryActionCommand;
  decision: WorkflowDecision<
    QueryActionEvent,
    QueryActionEffect,
    QueryActionRejectCode
  >;
}): WorkflowJournalCheckpointIntent[] {
  if (input.decision.kind === "rejected") {
    return [
      {
        checkpointName: REJECTED_DECISION_CHECKPOINT,
        checkpointPayload: {
          actionId: input.command.actionId,
          rejectCode: input.decision.rejectCode,
          rejectDetail: input.decision.rejectDetail ?? null,
        } satisfies RejectedDecisionCheckpointPayload,
      },
    ];
  }

  switch (input.command.commandPayload.type) {
    case "start_execute":
    case "start_validate":
      return [
        {
          checkpointName: "preparing",
          checkpointPayload: {
            commandType: input.command.commandPayload.type,
          },
        },
      ];
    case "record_execute_preparation":
      return [
        {
          checkpointName:
            input.command.commandPayload.kind === "succeeded"
              ? "executing"
              : "terminal_failure",
          checkpointPayload: {
            commandType: input.command.commandPayload.type,
            outcome: input.command.commandPayload.kind,
          },
        },
      ];
    case "record_query_execution":
      return [
        {
          checkpointName:
            input.command.commandPayload.kind === "succeeded"
              ? "query_succeeded"
              : "terminal_failure",
          checkpointPayload: {
            commandType: input.command.commandPayload.type,
            outcome: input.command.commandPayload.kind,
          },
        },
      ];
    case "record_usage_persistence":
      return [
        {
          checkpointName:
            input.command.commandPayload.kind === "succeeded"
              ? "usage_persisted"
              : "usage_persist_failed",
          checkpointPayload: {
            commandType: input.command.commandPayload.type,
            outcome: input.command.commandPayload.kind,
          },
        },
      ];
    case "record_validate_preparation":
      return [
        {
          checkpointName:
            input.command.commandPayload.kind === "accepted"
              ? "query_validated"
              : "terminal_failure",
          checkpointPayload: {
            commandType: input.command.commandPayload.type,
            outcome: input.command.commandPayload.kind,
          },
        },
      ];
  }
}

export async function loadQueryActionCommandViaJournal(input: {
  commandInvocationId: string;
  db: Database;
}): Promise<
  ResultType<
    StoredQueryActionJournalCommand | null,
    QueryActionJournalStorageError
  >
> {
  const store = createQueryActionJournalStore({ db: input.db });
  const entries = await store.loadEntriesByCommandInvocation({
    commandInvocationId: input.commandInvocationId,
    family: "query_action",
  });

  if (entries === null) {
    return Result.ok(null);
  }

  return replayStoredQueryActionJournalCommand({
    entries,
    idempotency: "replayed",
    store,
  });
}

export async function loadPendingQueryActionEffectsViaJournal<
  const EffectType extends QueryActionEffectType,
>(input: {
  db: Database;
  effectType: EffectType;
  limit?: number;
  organizationId?: string;
}): Promise<
  ResultType<
    WorkflowJournalEffectToken<QueryActionEffectOfType<EffectType>>[],
    QueryActionJournalStorageError
  >
> {
  const conditions = [
    eq(pendingWorkflowEffects.family, "query_action"),
    eq(pendingWorkflowEffects.effectType, input.effectType),
    inArray(pendingWorkflowEffects.status, ["pending", "leased", "failed"]),
  ];
  if (input.organizationId !== undefined) {
    conditions.push(
      eq(pendingWorkflowEffects.organizationId, input.organizationId)
    );
  }

  const rows = await input.db
    .select()
    .from(pendingWorkflowEffects)
    .where(and(...conditions))
    .orderBy(asc(pendingWorkflowEffects.scheduledAt))
    .limit(input.limit ?? 100);

  const effectTokens: WorkflowJournalEffectToken<
    QueryActionEffectOfType<EffectType>
  >[] = [];

  for (const row of rows) {
    const effect = decodeQueryActionEffectPayload(row.payloadBytes, {
      actionId: row.streamId,
      payloadType: row.effectType,
    });
    if (effect.isErr()) {
      return Result.err(effect.error);
    }

    effectTokens.push({
      effect: effect.value as QueryActionEffectOfType<EffectType>,
      effectId: row.effectId,
      effectType: row.effectType,
      organizationId: row.organizationId,
      scheduledAt: row.scheduledAt,
      scheduledByEntryId: row.scheduledByEntryId,
      streamId: row.streamId,
      streamPosition: row.streamPosition,
    });
  }

  return Result.ok(effectTokens);
}

export async function loadQueryActionDecisionForEffectViaJournal(input: {
  actionId: string;
  db: Database;
  effectId: string;
}): Promise<
  ResultType<
    StoredQueryActionJournalDecision | null,
    QueryActionJournalStorageError
  >
> {
  const store = createQueryActionJournalStore({ db: input.db });
  const streamEntries = await store.loadStream({
    family: "query_action",
    streamId: input.actionId,
  });
  const effectEntry = streamEntries.find(
    (entry) =>
      entry.kind === "effect_scheduled" && entry.effectId === input.effectId
  );

  if (effectEntry === undefined) {
    return Result.ok(null);
  }

  const commitEntries = streamEntries.filter(
    (entry) => entry.commitId === effectEntry.commitId
  );
  const stored = await replayStoredQueryActionJournalCommand({
    entries: commitEntries,
    idempotency: "replayed",
    store,
  });
  if (stored.isErr()) {
    return Result.err(stored.error);
  }

  return Result.ok(stored.value.decision);
}

export async function rebuildPendingQueryActionEffectsViaJournal(input: {
  db: Database;
  organizationId?: string;
}): Promise<ResultType<void, QueryActionJournalStorageError>> {
  const streamConditions = [eq(workflowJournal.family, "query_action")];
  const deleteConditions = [eq(pendingWorkflowEffects.family, "query_action")];
  if (input.organizationId !== undefined) {
    streamConditions.push(
      eq(workflowJournal.organizationId, input.organizationId)
    );
    deleteConditions.push(
      eq(pendingWorkflowEffects.organizationId, input.organizationId)
    );
  }

  const streamRows = await input.db
    .select({ streamId: workflowJournal.streamId })
    .from(workflowJournal)
    .where(and(...streamConditions))
    .groupBy(workflowJournal.streamId)
    .orderBy(asc(workflowJournal.streamId));

  const store = createQueryActionJournalStore({ db: input.db });
  const projectionRows: Array<
    Omit<NewPendingWorkflowEffect, "organizationId"> & {
      organizationId?: string;
    }
  > = [];

  for (const row of streamRows) {
    const streamEntries = await store.loadStream({
      family: "query_action",
      streamId: row.streamId,
    });
    const cursor = foldWorkflowJournalEntries({
      entries: streamEntries,
      reduce: reduceQueryActionJournalEvent,
      streamId: row.streamId,
    });
    if (cursor.isErr()) {
      return Result.err(cursor.error);
    }

    const organizationIdByEffectId = new Map(
      streamEntries.flatMap((entry) =>
        entry.kind === "effect_scheduled"
          ? [[entry.effectId, entry.organizationId] as const]
          : []
      )
    );

    projectionRows.push(
      ...cursor.value.effects
        .filter(
          (effect) =>
            isPendingQueryActionEffectType(effect.effectType) &&
            (effect.status === "scheduled" ||
              effect.status === "started" ||
              effect.status === "failed")
        )
        .map((effect) => ({
          attemptCount: effect.attemptCount,
          effectId: effect.effectId,
          effectType: effect.effectType,
          family: "query_action" as const,
          lastErrorCode: effect.lastErrorCode,
          lastErrorDetail: effect.lastErrorDetail,
          lastStartedAt: effect.startedAt,
          organizationId: organizationIdByEffectId.get(effect.effectId),
          payloadBytes: encodeQueryActionEffectPayload(effect.effect),
          scheduledAt: effect.scheduledAt,
          scheduledByEntryId: effect.scheduledByEntryId,
          status:
            effect.status === "scheduled"
              ? ("pending" as const)
              : effect.status === "started"
                ? ("leased" as const)
                : ("failed" as const),
          streamId: effect.streamId,
          streamPosition: effect.streamPosition,
        }))
    );
  }

  await input.db.transaction(async (tx) => {
    await tx.delete(pendingWorkflowEffects).where(and(...deleteConditions));
    if (projectionRows.length > 0) {
      await tx.insert(pendingWorkflowEffects).values(
        projectionRows.map((row) => ({
          ...row,
          organizationId: requireProjectionOrganizationId(row.organizationId),
        }))
      );
    }
  });

  return Result.ok(undefined);
}

export async function claimFailedQueryActionEffectViaJournal(input: {
  actionId: string;
  db: Database;
  effectId: string;
  organizationId: string;
}): Promise<
  ResultType<
    WorkflowJournalEffectToken<QueryActionEffect>,
    QueryActionJournalStorageError
  >
> {
  for (let attempt = 1; attempt <= MAX_STORAGE_COMMIT_ATTEMPTS; attempt += 1) {
    const store = createQueryActionJournalStore({ db: input.db });
    const streamEntries = await store.loadStream({
      family: "query_action",
      streamId: input.actionId,
    });
    const cursor = foldWorkflowJournalEntries({
      entries: streamEntries,
      reduce: reduceQueryActionJournalEvent,
      streamId: input.actionId,
    });
    if (cursor.isErr()) {
      return Result.err(cursor.error);
    }

    const effectState = cursor.value.effects.find(
      (known) => known.effectId === input.effectId
    );
    if (
      effectState === undefined ||
      (effectState.status !== "scheduled" &&
        effectState.status !== "started" &&
        effectState.status !== "failed")
    ) {
      return Result.err(
        new WorkflowJournalCorruptStreamError({
          detail: `query_action effect ${input.effectId} is not claimable in journal state`,
          family: "query_action",
          streamId: input.actionId,
        })
      );
    }
    const effect =
      cursor.value.pendingEffects.find(
        (pending) => pending.effectId === input.effectId
      ) ?? toQueryActionJournalEffectToken(effectState);
    if (effect === undefined) {
      return Result.err(
        new WorkflowJournalCorruptStreamError({
          detail: `query_action claimable effect ${input.effectId} is not runnable from journal state`,
          family: "query_action",
          streamId: input.actionId,
        })
      );
    }

    const occurredAt = new Date();
    const commitId = ulid();
    const leaseRecoveryEntry: WorkflowJournalEffectFailedEntry | null =
      effectState.status === "started"
        ? {
            commitId,
            effectId: input.effectId,
            entryId: ulid(),
            errorCode: "effect_lease_recovered",
            errorDetail: "query_action effect lease was recovered before retry",
            family: "query_action",
            kind: "effect_failed",
            occurredAt,
            organizationId: input.organizationId,
            streamId: input.actionId,
            streamPosition: cursor.value.streamPosition + 1,
          }
        : null;
    const entry: WorkflowJournalEffectStartedEntry = {
      commitId,
      effectId: input.effectId,
      entryId: ulid(),
      family: "query_action",
      kind: "effect_started",
      occurredAt,
      organizationId: input.organizationId,
      streamId: input.actionId,
      streamPosition:
        cursor.value.streamPosition + (leaseRecoveryEntry === null ? 1 : 2),
      workerId: QUERY_ACTION_EFFECT_WORKER_ID,
    };
    const appendStore = createQueryActionJournalStore({
      db: input.db,
      pendingEffectIds: collectPendingProjectionEffectIds(cursor.value),
    });
    const appended = await appendStore.appendEntries({
      entries:
        leaseRecoveryEntry === null ? [entry] : [leaseRecoveryEntry, entry],
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
          "query_action effect claim append unexpectedly conflicted on command idempotency",
        family: "query_action",
        streamId: input.actionId,
      })
    );
  }

  return Result.err(
    new WorkflowStorageContentionError({
      actionId: input.actionId,
      attempts: MAX_STORAGE_COMMIT_ATTEMPTS,
      family: "query_action",
    })
  );
}

export async function recordQueryActionEffectFailureViaJournal(input: {
  actionId: string;
  db: Database;
  effectId: string;
  errorCode: string;
  errorDetail?: string | null;
  organizationId: string;
}): Promise<ResultType<void, QueryActionJournalStorageError>> {
  for (let attempt = 1; attempt <= MAX_STORAGE_COMMIT_ATTEMPTS; attempt += 1) {
    const store = createQueryActionJournalStore({ db: input.db });
    const streamEntries = await store.loadStream({
      family: "query_action",
      streamId: input.actionId,
    });
    const cursor = foldWorkflowJournalEntries({
      entries: streamEntries,
      reduce: reduceQueryActionJournalEvent,
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
          detail: `query_action effect ${input.effectId} cannot be marked failed from journal state`,
          family: "query_action",
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
      family: "query_action",
      kind: "effect_failed",
      occurredAt,
      organizationId: input.organizationId,
      streamId: input.actionId,
      streamPosition: cursor.value.streamPosition + 1,
    };
    const appendStore = createQueryActionJournalStore({
      db: input.db,
      pendingEffectIds: collectPendingProjectionEffectIds(cursor.value),
    });
    const appended = await appendStore.appendEntries({
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
          "query_action effect failure append unexpectedly conflicted on command idempotency",
        family: "query_action",
        streamId: input.actionId,
      })
    );
  }

  return Result.err(
    new WorkflowStorageContentionError({
      actionId: input.actionId,
      attempts: MAX_STORAGE_COMMIT_ATTEMPTS,
      family: "query_action",
    })
  );
}

function createQueryActionJournalStore(input: {
  db: Database;
  onAppendEntries?: (input: {
    entries: readonly WorkflowJournalEntry<
      QueryActionCommandPayload,
      QueryActionEvent,
      QueryActionEffect
    >[];
    expectedStreamPosition: number;
    tx: DatabaseTransaction;
  }) => Promise<void>;
  pendingEffectIds?: ReadonlySet<string>;
}): QueryActionJournalStore {
  return createDbWorkflowJournalStore({
    codec: queryActionJournalPayloadCodec,
    db: input.db,
    onAppendEntries: async (appendInput) => {
      await projectPendingQueryActionEffects({
        entries: appendInput.entries,
        pendingEffectIds: input.pendingEffectIds ?? new Set(),
        tx: appendInput.tx,
      });
      await input.onAppendEntries?.(appendInput);
    },
  });
}

async function replayStoredQueryActionJournalCommand(input: {
  entries: readonly WorkflowJournalEntry<
    QueryActionCommandPayload,
    QueryActionEvent,
    QueryActionEffect
  >[];
  idempotency: "fresh" | "replayed";
  store: QueryActionJournalStore;
}): Promise<
  ResultType<StoredQueryActionJournalCommand, QueryActionJournalStorageError>
> {
  const commandEntry = findCommandEntry(input.entries);
  if (commandEntry === undefined) {
    return Result.err(
      new WorkflowJournalCorruptStreamError({
        detail:
          "query_action journal command replay found a commit without a command entry",
      })
    );
  }

  const lastBatchPosition = getLastStreamPosition(input.entries);
  const streamEntries = (
    await input.store.loadStream({
      family: "query_action",
      streamId: commandEntry.streamId,
    })
  ).filter((entry) => entry.streamPosition <= lastBatchPosition);
  const cursor = foldWorkflowJournalEntries({
    entries: streamEntries,
    reduce: reduceQueryActionJournalEvent,
    streamId: commandEntry.streamId,
  });
  if (cursor.isErr()) {
    return Result.err(cursor.error);
  }

  return toStoredQueryActionJournalCommand({
    commitId: commandEntry.commitId,
    cursor: cursor.value,
    entries: input.entries,
    freshEffects: [],
    idempotency: input.idempotency,
  });
}

async function projectFreshQueryActionJournalAppend(input: {
  actionId: string;
  command: QueryActionCommand;
  currentState: QueryActionState | null;
  decision: WorkflowDecision<
    QueryActionEvent,
    QueryActionEffect,
    QueryActionRejectCode
  >;
  entries: readonly WorkflowJournalEntry<
    QueryActionCommandPayload,
    QueryActionEvent,
    QueryActionEffect
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
      family: "query_action",
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

  const actionColumns = toQueryActionActionColumns(nextState.value);
  await input.tx
    .insert(queryActions)
    .values({
      id: input.actionId,
      organizationId: input.command.organizationId,
      ...actionColumns,
    })
    .onConflictDoUpdate({
      set: actionColumns,
      target: queryActions.id,
    });
}

async function projectPendingQueryActionEffects(input: {
  entries: readonly WorkflowJournalEntry<
    QueryActionCommandPayload,
    QueryActionEvent,
    QueryActionEffect
  >[];
  pendingEffectIds: ReadonlySet<string>;
  tx: DatabaseTransaction;
}) {
  for (const entry of input.entries) {
    switch (entry.kind) {
      case "effect_scheduled":
        if (!isPendingQueryActionEffectType(entry.effectType)) {
          break;
        }

        await input.tx
          .insert(pendingWorkflowEffects)
          .values({
            effectId: entry.effectId,
            effectType: entry.effectType,
            family: "query_action",
            organizationId: entry.organizationId,
            payloadBytes: encodeQueryActionEffectPayload(entry.effect),
            scheduledAt: entry.occurredAt,
            scheduledByEntryId: entry.entryId,
            status: "pending",
            streamId: entry.streamId,
            streamPosition: entry.streamPosition,
          })
          .onConflictDoUpdate({
            set: {
              effectType: entry.effectType,
              organizationId: entry.organizationId,
              payloadBytes: encodeQueryActionEffectPayload(entry.effect),
              scheduledAt: entry.occurredAt,
              scheduledByEntryId: entry.entryId,
              status: "pending",
              streamId: entry.streamId,
              streamPosition: entry.streamPosition,
            },
            target: [
              pendingWorkflowEffects.family,
              pendingWorkflowEffects.effectId,
            ],
          });
        break;
      case "effect_started":
        if (!input.pendingEffectIds.has(entry.effectId)) {
          break;
        }

        await input.tx
          .update(pendingWorkflowEffects)
          .set({
            attemptCount: sql`${pendingWorkflowEffects.attemptCount} + 1`,
            lastStartedAt: entry.occurredAt,
            status: "leased",
          })
          .where(
            and(
              eq(pendingWorkflowEffects.family, "query_action"),
              eq(pendingWorkflowEffects.effectId, entry.effectId)
            )
          );
        break;
      case "effect_failed":
        if (!input.pendingEffectIds.has(entry.effectId)) {
          break;
        }

        await input.tx
          .update(pendingWorkflowEffects)
          .set({
            lastErrorCode: entry.errorCode,
            lastErrorDetail: entry.errorDetail,
            status: "failed",
          })
          .where(
            and(
              eq(pendingWorkflowEffects.family, "query_action"),
              eq(pendingWorkflowEffects.effectId, entry.effectId)
            )
          );
        break;
      case "effect_completed":
        if (!input.pendingEffectIds.has(entry.effectId)) {
          break;
        }

        await input.tx
          .delete(pendingWorkflowEffects)
          .where(
            and(
              eq(pendingWorkflowEffects.family, "query_action"),
              eq(pendingWorkflowEffects.effectId, entry.effectId)
            )
          );
        break;
      case "checkpoint":
      case "command":
      case "event":
        break;
    }
  }
}

function collectPendingProjectionEffectIds(cursor: QueryActionJournalCursor) {
  return new Set(
    cursor.effects
      .filter((effect) => isPendingQueryActionEffectType(effect.effectType))
      .map((effect) => effect.effectId)
  );
}

function isPendingQueryActionEffectType(
  effectType: string
): effectType is QueryActionEffectType {
  return PENDING_QUERY_ACTION_EFFECT_TYPES.has(
    effectType as QueryActionEffectType
  );
}

function requireProjectionOrganizationId(organizationId: string | undefined) {
  if (organizationId === undefined) {
    throw new WorkflowStorageWriteError({
      family: "query_action",
      operation: "rebuild_pending_effect_projection",
    });
  }

  return organizationId;
}

function toStoredQueryActionJournalCommand(
  input: QueryActionJournalAppendResult
): ResultType<StoredQueryActionJournalCommand, QueryActionJournalStorageError> {
  const commandEntry = findCommandEntry(input.entries);
  if (commandEntry === undefined) {
    return Result.err(
      new WorkflowJournalCorruptStreamError({
        detail:
          "query_action journal command replay found a commit without a command entry",
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
        family: "query_action",
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
        detail: `query_action journal event ${entry.eventId} is missing from folded cursor`,
        entryId: entry.entryId,
        family: "query_action",
        streamId: entry.streamId,
      });
    }

    return [
      {
        ...entry.event,
        id: entry.eventId,
        occurredAt: entry.occurredAt,
        sequence,
      } satisfies WorkflowCommittedEvent<QueryActionEvent>,
    ];
  });

  if (events.length === 0) {
    return Result.err(
      new WorkflowJournalCorruptStreamError({
        detail:
          "query_action journal accepted command replay found no event entries",
        entryId: commandEntry.entryId,
        family: "query_action",
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
      cursor: input.cursor,
      events,
      family: "query_action",
      freshEffects: input.freshEffects,
      idempotency: input.idempotency,
      journalEffects: collectScheduledEffectTokens(input.entries),
      kind: "accepted",
    },
  });
}

function collectScheduledEffectTokens(
  entries: readonly WorkflowJournalEntry<
    QueryActionCommandPayload,
    QueryActionEvent,
    QueryActionEffect
  >[]
): WorkflowJournalEffectToken<QueryActionEffect>[] {
  return entries.flatMap((entry) =>
    entry.kind === "effect_scheduled"
      ? [
          {
            effect: entry.effect,
            effectId: entry.effectId,
            effectType: entry.effectType,
            organizationId: entry.organizationId,
            scheduledAt: entry.occurredAt,
            scheduledByEntryId: entry.entryId,
            streamId: entry.streamId,
            streamPosition: entry.streamPosition,
          },
        ]
      : []
  );
}

function toQueryActionJournalEffectToken(
  effect: WorkflowJournalEffectState<QueryActionEffect>
): WorkflowJournalEffectToken<QueryActionEffect> {
  return {
    effect: effect.effect,
    effectId: effect.effectId,
    effectType: effect.effectType,
    organizationId: effect.organizationId,
    scheduledAt: effect.scheduledAt,
    scheduledByEntryId: effect.scheduledByEntryId,
    streamId: effect.streamId,
    streamPosition: effect.streamPosition,
  };
}

function collectCompletedEffectIds(
  entries: readonly WorkflowJournalEntry<
    QueryActionCommandPayload,
    QueryActionEvent,
    QueryActionEffect
  >[]
): string[] {
  return entries.flatMap((entry) =>
    entry.kind === "effect_completed" ? [entry.effectId] : []
  );
}

function reduceQueryActionJournalEvent(
  state: QueryActionState | null,
  entry: WorkflowJournalEventEntry<QueryActionEvent>
) {
  return reduceQueryAction(state, {
    ...entry.event,
    id: entry.eventId,
    occurredAt: entry.occurredAt,
    sequence: (state?.lastEventSequence ?? 0) + 1,
  });
}

function reduceCommittedEvents(input: {
  currentState: QueryActionState | null;
  events: readonly WorkflowCommittedEvent<QueryActionEvent>[];
}) {
  let state = input.currentState;

  for (const event of input.events) {
    const reduced = reduceQueryAction(state, event);
    if (reduced.isErr()) {
      return reduced;
    }
    state = reduced.value;
  }

  if (state === null) {
    return Result.err(
      new WorkflowStorageWriteError({
        family: "query_action",
        operation: "fold_journal_projection",
      })
    );
  }

  return Result.ok(state);
}

function toCommittedEvents(input: {
  currentState: QueryActionState | null;
  entries: readonly WorkflowJournalEntry<
    QueryActionCommandPayload,
    QueryActionEvent,
    QueryActionEffect
  >[];
}): WorkflowCommittedEvent<QueryActionEvent>[] {
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
      } satisfies WorkflowCommittedEvent<QueryActionEvent>,
    ];
  });
}

function findCommandEntry(
  entries: readonly WorkflowJournalEntry<
    QueryActionCommandPayload,
    QueryActionEvent,
    QueryActionEffect
  >[]
): WorkflowJournalCommandEntry<QueryActionCommandPayload> | undefined {
  return entries.find(
    (entry): entry is WorkflowJournalCommandEntry<QueryActionCommandPayload> =>
      entry.kind === "command"
  );
}

function findRejectedDecisionCheckpoint(
  entries: readonly WorkflowJournalEntry<
    QueryActionCommandPayload,
    QueryActionEvent,
    QueryActionEffect
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
        "query_action journal rejected command checkpoint has an invalid payload",
      entryId: checkpoint.entryId,
      family: "query_action",
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
        "query_action journal rejected command checkpoint has invalid reject fields",
      entryId: checkpoint.entryId,
      family: "query_action",
      streamId: checkpoint.streamId,
    });
  }

  return {
    actionId,
    rejectCode: rejectCode as QueryActionRejectCode,
    rejectDetail,
  };
}

function getLastStreamPosition(
  entries: readonly WorkflowJournalEntry<
    QueryActionCommandPayload,
    QueryActionEvent,
    QueryActionEffect
  >[]
) {
  return entries.reduce(
    (position, entry) => Math.max(position, entry.streamPosition),
    0
  );
}

function toQueryActionPayloadContext(
  context: WorkflowJournalPayloadCodecContext
) {
  return {
    actionId: context.streamId,
    commandId: context.entryId,
    payloadType: context.payloadType,
  };
}

function toQueryActionActionColumns(state: QueryActionState) {
  return {
    completedAt: state.completedAt,
    failureCode: state.failureCode,
    lastEventId: state.lastEventId,
    lastEventSequence: state.lastEventSequence,
    outcome: state.outcome,
    phase: state.phase,
    queryMode: state.queryMode,
    queryText: state.queryText,
    sourceDescriptorJson:
      state.sourceDescriptor === null
        ? null
        : toWorkflowProjectionJson(state.sourceDescriptor),
    startedAt: state.startedAt,
    usageRecordingStatus: state.usageRecordingStatus,
    validatedQuery: state.validatedQuery,
  };
}
