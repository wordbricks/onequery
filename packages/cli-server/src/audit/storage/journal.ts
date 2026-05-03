import { ulid } from "@onequery/db/server";
import { Result } from "better-result";
import type { Result as ResultType } from "better-result";

import type { WorkflowFamily } from "../kernel";

export const WORKFLOW_JOURNAL_ENTRY_KINDS = [
  "command",
  "event",
  "effect_scheduled",
  "effect_started",
  "effect_completed",
  "effect_failed",
  "checkpoint",
] as const;
export type WorkflowJournalEntryKind =
  (typeof WORKFLOW_JOURNAL_ENTRY_KINDS)[number];

type WorkflowJournalEntryBase<Kind extends WorkflowJournalEntryKind> = {
  commitId: string;
  entryId: string;
  family: WorkflowFamily;
  kind: Kind;
  occurredAt: Date;
  organizationId: string;
  streamId: string;
  streamPosition: number;
};

export type WorkflowJournalCommandEntry<
  CommandPayload extends { type: string },
> = WorkflowJournalEntryBase<"command"> & {
  commandInvocationId: string;
  commandPayload: CommandPayload;
  commandType: string;
};

export type WorkflowJournalEventEntry<Event extends { type: string }> =
  WorkflowJournalEntryBase<"event"> & {
    event: Event;
    eventId: string;
    eventType: string;
  };

export type WorkflowJournalEffectScheduledEntry<
  Effect extends { type: string },
> = WorkflowJournalEntryBase<"effect_scheduled"> & {
  effect: Effect;
  effectId: string;
  effectType: string;
};

export type WorkflowJournalEffectStartedEntry =
  WorkflowJournalEntryBase<"effect_started"> & {
    effectId: string;
    workerId: string | null;
  };

export type WorkflowJournalEffectCompletedEntry =
  WorkflowJournalEntryBase<"effect_completed"> & {
    effectId: string;
  };

export type WorkflowJournalEffectFailedEntry =
  WorkflowJournalEntryBase<"effect_failed"> & {
    effectId: string;
    errorCode: string;
    errorDetail: string | null;
  };

export type WorkflowJournalCheckpointEntry =
  WorkflowJournalEntryBase<"checkpoint"> & {
    checkpointName: string;
    checkpointPayload: unknown;
  };

export type WorkflowJournalEntry<
  CommandPayload extends { type: string },
  Event extends { type: string },
  Effect extends { type: string },
> =
  | WorkflowJournalCommandEntry<CommandPayload>
  | WorkflowJournalEventEntry<Event>
  | WorkflowJournalEffectScheduledEntry<Effect>
  | WorkflowJournalEffectStartedEntry
  | WorkflowJournalEffectCompletedEntry
  | WorkflowJournalEffectFailedEntry
  | WorkflowJournalCheckpointEntry;

export type WorkflowJournalEffectStatus =
  | "scheduled"
  | "started"
  | "completed"
  | "failed";

export type WorkflowJournalEffectState<Effect extends { type: string }> = {
  attemptCount: number;
  completedAt: Date | null;
  effect: Effect;
  effectId: string;
  effectType: string;
  failedAt: Date | null;
  lastErrorCode: string | null;
  lastErrorDetail: string | null;
  scheduledAt: Date;
  scheduledByEntryId: string;
  startedAt: Date | null;
  status: WorkflowJournalEffectStatus;
  streamId: string;
  streamPosition: number;
};

export type WorkflowJournalEffectToken<Effect extends { type: string }> = {
  effect: Effect;
  effectId: string;
  effectType: string;
  scheduledAt: Date;
  scheduledByEntryId: string;
  streamId: string;
  streamPosition: number;
};

export type WorkflowJournalCursor<
  State,
  CommandPayload extends { type: string },
  Event extends { type: string },
  Effect extends { type: string },
> = {
  checkpoint: WorkflowJournalCheckpointEntry | null;
  commands: readonly WorkflowJournalCommandEntry<CommandPayload>[];
  effects: readonly WorkflowJournalEffectState<Effect>[];
  events: readonly WorkflowJournalEventEntry<Event>[];
  pendingEffects: readonly WorkflowJournalEffectToken<Effect>[];
  state: State | null;
  streamId: string | null;
  streamPosition: number;
};

export type WorkflowJournalAppendResult<
  State,
  CommandPayload extends { type: string },
  Event extends { type: string },
  Effect extends { type: string },
> = {
  commitId: string;
  cursor: WorkflowJournalCursor<State, CommandPayload, Event, Effect>;
  entries: readonly WorkflowJournalEntry<CommandPayload, Event, Effect>[];
  freshEffects: readonly WorkflowJournalEffectToken<Effect>[];
  idempotency: "fresh" | "replayed";
};

export type WorkflowJournalEffectStartIntent = {
  effectId: string;
  workerId?: string | null;
};

export type WorkflowJournalEffectCompletionIntent = {
  effectId: string;
};

export type WorkflowJournalEffectFailureIntent = {
  effectId: string;
  errorCode: string;
  errorDetail?: string | null;
};

export type WorkflowJournalCheckpointIntent = {
  checkpointName: string;
  checkpointPayload?: unknown;
};

export type WorkflowJournalStore<
  CommandPayload extends { type: string },
  Event extends { type: string },
  Effect extends { type: string },
> = {
  appendEntries: (input: {
    entries: readonly WorkflowJournalEntry<CommandPayload, Event, Effect>[];
    expectedStreamPosition: number;
  }) => Promise<
    WorkflowJournalStoreAppendResult<CommandPayload, Event, Effect>
  >;
  loadEntriesByCommandInvocation: (input: {
    commandInvocationId: string;
    family: WorkflowFamily;
  }) => Promise<
    readonly WorkflowJournalEntry<CommandPayload, Event, Effect>[] | null
  >;
  loadStream: (input: {
    family: WorkflowFamily;
    streamId: string;
  }) => Promise<readonly WorkflowJournalEntry<CommandPayload, Event, Effect>[]>;
};

export type WorkflowJournalStoreAppendResult<
  CommandPayload extends { type: string },
  Event extends { type: string },
  Effect extends { type: string },
> =
  | {
      kind: "appended";
    }
  | {
      currentStreamPosition: number;
      kind: "position_conflict";
    }
  | {
      entries: readonly WorkflowJournalEntry<CommandPayload, Event, Effect>[];
      kind: "command_conflict";
    };

export class WorkflowJournalExpectedPositionConflictError extends Error {
  currentStreamPosition: number;
  expectedStreamPosition: number;
  family: WorkflowFamily;
  streamId: string;

  constructor(input: {
    currentStreamPosition: number;
    expectedStreamPosition: number;
    family: WorkflowFamily;
    streamId: string;
  }) {
    super(
      `workflow journal stream ${input.family}:${input.streamId} is at position ${input.currentStreamPosition}, expected ${input.expectedStreamPosition}`
    );
    this.name = "WorkflowJournalExpectedPositionConflictError";
    this.currentStreamPosition = input.currentStreamPosition;
    this.expectedStreamPosition = input.expectedStreamPosition;
    this.family = input.family;
    this.streamId = input.streamId;
  }
}

export class WorkflowJournalCorruptStreamError extends Error {
  entryId?: string;
  family: WorkflowFamily | null;
  streamId: string | null;

  constructor(input: {
    detail: string;
    entryId?: string;
    family?: WorkflowFamily | null;
    streamId?: string | null;
  }) {
    super(input.detail);
    this.name = "WorkflowJournalCorruptStreamError";
    this.entryId = input.entryId;
    this.family = input.family ?? null;
    this.streamId = input.streamId ?? null;
  }
}

export async function appendWorkflowJournalBatch<
  State,
  CommandPayload extends { type: string },
  Event extends { type: string },
  Effect extends { type: string },
  ReduceError extends Error,
>(input: {
  checkpoints?: readonly WorkflowJournalCheckpointIntent[];
  commandInvocationId: string;
  commandPayload: CommandPayload;
  commandType?: string;
  createId?: () => string;
  effectCompletions?: readonly WorkflowJournalEffectCompletionIntent[];
  effectFailures?: readonly WorkflowJournalEffectFailureIntent[];
  effectStarts?: readonly WorkflowJournalEffectStartIntent[];
  effects?: readonly Effect[];
  events?: readonly Event[];
  expectedStreamPosition: number;
  family: WorkflowFamily;
  occurredAt: Date;
  organizationId: string;
  reduce: (
    state: State | null,
    event: WorkflowJournalEventEntry<Event>
  ) => ResultType<State, ReduceError>;
  store: WorkflowJournalStore<CommandPayload, Event, Effect>;
  streamId: string;
}): Promise<
  ResultType<
    WorkflowJournalAppendResult<State, CommandPayload, Event, Effect>,
    | ReduceError
    | WorkflowJournalCorruptStreamError
    | WorkflowJournalExpectedPositionConflictError
  >
> {
  const createId = input.createId ?? ulid;
  const existingEntries = await input.store.loadEntriesByCommandInvocation({
    commandInvocationId: input.commandInvocationId,
    family: input.family,
  });

  if (existingEntries !== null) {
    return replayWorkflowJournalBatch({
      batchEntries: existingEntries,
      reduce: input.reduce,
      store: input.store,
    });
  }

  const streamEntries = await input.store.loadStream({
    family: input.family,
    streamId: input.streamId,
  });
  const currentStreamPosition = getLastStreamPosition(streamEntries);
  if (currentStreamPosition !== input.expectedStreamPosition) {
    return Result.err(
      new WorkflowJournalExpectedPositionConflictError({
        currentStreamPosition,
        expectedStreamPosition: input.expectedStreamPosition,
        family: input.family,
        streamId: input.streamId,
      })
    );
  }

  const entries = buildJournalBatchEntries({
    checkpoints: input.checkpoints ?? [],
    commandInvocationId: input.commandInvocationId,
    commandPayload: input.commandPayload,
    commandType: input.commandType ?? input.commandPayload.type,
    commitId: createId(),
    createId,
    effectCompletions: input.effectCompletions ?? [],
    effectFailures: input.effectFailures ?? [],
    effectStarts: input.effectStarts ?? [],
    effects: input.effects ?? [],
    events: input.events ?? [],
    family: input.family,
    occurredAt: input.occurredAt,
    organizationId: input.organizationId,
    startingStreamPosition: currentStreamPosition,
    streamId: input.streamId,
  });
  const commandEntry = entries[0];
  if (commandEntry === undefined) {
    return Result.err(
      new WorkflowJournalCorruptStreamError({
        detail: "workflow journal append built an empty command batch",
        family: input.family,
        streamId: input.streamId,
      })
    );
  }

  const appended = await input.store.appendEntries({
    entries,
    expectedStreamPosition: input.expectedStreamPosition,
  });

  switch (appended.kind) {
    case "appended": {
      const cursor = foldWorkflowJournalEntries({
        entries: [...streamEntries, ...entries],
        reduce: input.reduce,
        streamId: input.streamId,
      });
      if (cursor.isErr()) {
        return Result.err(cursor.error);
      }

      return Result.ok({
        commitId: commandEntry.commitId,
        cursor: cursor.value,
        entries,
        freshEffects: collectFreshEffects({
          cursor: cursor.value,
          entries,
        }),
        idempotency: "fresh",
      });
    }
    case "command_conflict":
      return replayWorkflowJournalBatch({
        batchEntries: appended.entries,
        reduce: input.reduce,
        store: input.store,
      });
    case "position_conflict":
      return Result.err(
        new WorkflowJournalExpectedPositionConflictError({
          currentStreamPosition: appended.currentStreamPosition,
          expectedStreamPosition: input.expectedStreamPosition,
          family: input.family,
          streamId: input.streamId,
        })
      );
  }
}

export function foldWorkflowJournalEntries<
  State,
  CommandPayload extends { type: string },
  Event extends { type: string },
  Effect extends { type: string },
  ReduceError extends Error,
>(input: {
  entries: readonly WorkflowJournalEntry<CommandPayload, Event, Effect>[];
  initialState?: State | null;
  initialStreamPosition?: number;
  reduce: (
    state: State | null,
    event: WorkflowJournalEventEntry<Event>
  ) => ResultType<State, ReduceError>;
  streamId?: string;
}): ResultType<
  WorkflowJournalCursor<State, CommandPayload, Event, Effect>,
  ReduceError | WorkflowJournalCorruptStreamError
> {
  const sortedEntries = sortJournalEntries(input.entries);
  const commands: WorkflowJournalCommandEntry<CommandPayload>[] = [];
  const events: WorkflowJournalEventEntry<Event>[] = [];
  const effectsById = new Map<
    string,
    MutableWorkflowJournalEffectState<Effect>
  >();
  const effectOrder: string[] = [];
  let checkpoint: WorkflowJournalCheckpointEntry | null = null;
  let currentState: State | null = input.initialState ?? null;
  let streamId = input.streamId ?? sortedEntries[0]?.streamId ?? null;
  let streamPosition = input.initialStreamPosition ?? 0;

  for (const entry of sortedEntries) {
    if (streamId === null) {
      streamId = entry.streamId;
    }

    if (entry.streamId !== streamId) {
      return Result.err(
        new WorkflowJournalCorruptStreamError({
          detail: `workflow journal fold received mixed stream ids ${streamId} and ${entry.streamId}`,
          entryId: entry.entryId,
          family: entry.family,
          streamId: entry.streamId,
        })
      );
    }

    if (entry.streamPosition !== streamPosition + 1) {
      return Result.err(
        new WorkflowJournalCorruptStreamError({
          detail: `workflow journal stream ${entry.family}:${entry.streamId} has entry ${entry.entryId} at position ${entry.streamPosition}, expected ${streamPosition + 1}`,
          entryId: entry.entryId,
          family: entry.family,
          streamId: entry.streamId,
        })
      );
    }

    streamPosition = entry.streamPosition;

    switch (entry.kind) {
      case "command":
        commands.push(entry);
        break;
      case "event": {
        const reduced = input.reduce(currentState, entry);
        if (reduced.isErr()) {
          return Result.err(reduced.error);
        }
        currentState = reduced.value;
        events.push(entry);
        break;
      }
      case "effect_scheduled":
        if (effectsById.has(entry.effectId)) {
          return Result.err(
            corruptEffectEntry(entry, `duplicate effect ${entry.effectId}`)
          );
        }

        effectsById.set(entry.effectId, {
          attemptCount: 0,
          completedAt: null,
          effect: entry.effect,
          effectId: entry.effectId,
          effectType: entry.effectType,
          failedAt: null,
          lastErrorCode: null,
          lastErrorDetail: null,
          scheduledAt: entry.occurredAt,
          scheduledByEntryId: entry.entryId,
          startedAt: null,
          status: "scheduled",
          streamId: entry.streamId,
          streamPosition: entry.streamPosition,
        });
        effectOrder.push(entry.effectId);
        break;
      case "effect_started": {
        const effect = requireKnownEffect(entry, effectsById);
        if (effect.isErr()) {
          return Result.err(effect.error);
        }
        if (effect.value.status === "completed") {
          return Result.err(
            corruptEffectEntry(
              entry,
              `completed effect ${entry.effectId} cannot be started`
            )
          );
        }
        if (effect.value.status === "started") {
          return Result.err(
            corruptEffectEntry(
              entry,
              `started effect ${entry.effectId} cannot be started again`
            )
          );
        }

        effect.value.attemptCount += 1;
        effect.value.failedAt = null;
        effect.value.lastErrorCode = null;
        effect.value.lastErrorDetail = null;
        effect.value.startedAt = entry.occurredAt;
        effect.value.status = "started";
        break;
      }
      case "effect_completed": {
        const effect = requireKnownEffect(entry, effectsById);
        if (effect.isErr()) {
          return Result.err(effect.error);
        }
        if (effect.value.status === "completed") {
          return Result.err(
            corruptEffectEntry(
              entry,
              `effect ${entry.effectId} was completed more than once`
            )
          );
        }

        effect.value.completedAt = entry.occurredAt;
        effect.value.failedAt = null;
        effect.value.lastErrorCode = null;
        effect.value.lastErrorDetail = null;
        effect.value.status = "completed";
        break;
      }
      case "effect_failed": {
        const effect = requireKnownEffect(entry, effectsById);
        if (effect.isErr()) {
          return Result.err(effect.error);
        }
        if (effect.value.status === "completed") {
          return Result.err(
            corruptEffectEntry(
              entry,
              `completed effect ${entry.effectId} cannot fail`
            )
          );
        }

        effect.value.failedAt = entry.occurredAt;
        effect.value.lastErrorCode = entry.errorCode;
        effect.value.lastErrorDetail = entry.errorDetail;
        effect.value.status = "failed";
        break;
      }
      case "checkpoint":
        checkpoint = entry;
        break;
    }
  }

  const effects = effectOrder.map((effectId) =>
    freezeEffectState(requireEffectState(effectId, effectsById))
  );

  return Result.ok({
    checkpoint,
    commands,
    effects,
    events,
    pendingEffects: effects.flatMap((effect) =>
      isRunnableEffectStatus(effect.status) ? [toEffectToken(effect)] : []
    ),
    state: currentState,
    streamId,
    streamPosition,
  });
}

export function createInMemoryWorkflowJournalStore<
  CommandPayload extends { type: string },
  Event extends { type: string },
  Effect extends { type: string },
>(): WorkflowJournalStore<CommandPayload, Event, Effect> & {
  loadAllEntries: () => readonly WorkflowJournalEntry<
    CommandPayload,
    Event,
    Effect
  >[];
} {
  let entries: WorkflowJournalEntry<CommandPayload, Event, Effect>[] = [];

  return {
    appendEntries: async (input) => {
      const commandEntry = input.entries.find(isWorkflowJournalCommandEntry);
      if (commandEntry !== undefined) {
        const existingCommand = entries.find(
          (entry): entry is WorkflowJournalCommandEntry<CommandPayload> =>
            entry.kind === "command" &&
            entry.family === commandEntry.family &&
            entry.commandInvocationId === commandEntry.commandInvocationId
        );
        if (existingCommand !== undefined) {
          return {
            entries: loadCommitEntries(entries, existingCommand.commitId),
            kind: "command_conflict",
          };
        }
      }

      const firstEntry = input.entries[0];
      if (firstEntry === undefined) {
        return {
          kind: "appended",
        };
      }

      const currentStreamPosition = getLastStreamPosition(
        entries.filter(
          (entry) =>
            entry.family === firstEntry.family &&
            entry.streamId === firstEntry.streamId
        )
      );
      if (currentStreamPosition !== input.expectedStreamPosition) {
        return {
          currentStreamPosition,
          kind: "position_conflict",
        };
      }

      entries = [...entries, ...input.entries];
      return {
        kind: "appended",
      };
    },
    loadAllEntries: () => sortJournalEntries(entries),
    loadEntriesByCommandInvocation: async (input) => {
      const commandEntry = entries.find(
        (entry): entry is WorkflowJournalCommandEntry<CommandPayload> =>
          entry.kind === "command" &&
          entry.family === input.family &&
          entry.commandInvocationId === input.commandInvocationId
      );

      return commandEntry === undefined
        ? null
        : loadCommitEntries(entries, commandEntry.commitId);
    },
    loadStream: async (input) =>
      sortJournalEntries(
        entries.filter(
          (entry) =>
            entry.family === input.family && entry.streamId === input.streamId
        )
      ),
  };
}

function buildJournalBatchEntries<
  CommandPayload extends { type: string },
  Event extends { type: string },
  Effect extends { type: string },
>(input: {
  checkpoints: readonly WorkflowJournalCheckpointIntent[];
  commandInvocationId: string;
  commandPayload: CommandPayload;
  commandType: string;
  commitId: string;
  createId: () => string;
  effectCompletions: readonly WorkflowJournalEffectCompletionIntent[];
  effectFailures: readonly WorkflowJournalEffectFailureIntent[];
  effectStarts: readonly WorkflowJournalEffectStartIntent[];
  effects: readonly Effect[];
  events: readonly Event[];
  family: WorkflowFamily;
  occurredAt: Date;
  organizationId: string;
  startingStreamPosition: number;
  streamId: string;
}) {
  const entries: WorkflowJournalEntry<CommandPayload, Event, Effect>[] = [];
  let streamPosition = input.startingStreamPosition;
  const base = <Kind extends WorkflowJournalEntryKind>(
    kind: Kind
  ): WorkflowJournalEntryBase<Kind> => ({
    commitId: input.commitId,
    entryId: input.createId(),
    family: input.family,
    kind,
    occurredAt: input.occurredAt,
    organizationId: input.organizationId,
    streamId: input.streamId,
    streamPosition: (streamPosition += 1),
  });

  entries.push({
    ...base("command"),
    commandInvocationId: input.commandInvocationId,
    commandPayload: input.commandPayload,
    commandType: input.commandType,
  });

  for (const event of input.events) {
    entries.push({
      ...base("event"),
      event,
      eventId: input.createId(),
      eventType: event.type,
    });
  }

  for (const effect of input.effects) {
    entries.push({
      ...base("effect_scheduled"),
      effect,
      effectId: input.createId(),
      effectType: effect.type,
    });
  }

  for (const effectStart of input.effectStarts) {
    entries.push({
      ...base("effect_started"),
      effectId: effectStart.effectId,
      workerId: effectStart.workerId ?? null,
    });
  }

  for (const effectCompletion of input.effectCompletions) {
    entries.push({
      ...base("effect_completed"),
      effectId: effectCompletion.effectId,
    });
  }

  for (const effectFailure of input.effectFailures) {
    entries.push({
      ...base("effect_failed"),
      effectId: effectFailure.effectId,
      errorCode: effectFailure.errorCode,
      errorDetail: effectFailure.errorDetail ?? null,
    });
  }

  for (const checkpoint of input.checkpoints) {
    entries.push({
      ...base("checkpoint"),
      checkpointName: checkpoint.checkpointName,
      checkpointPayload: checkpoint.checkpointPayload ?? null,
    });
  }

  return entries;
}

async function replayWorkflowJournalBatch<
  State,
  CommandPayload extends { type: string },
  Event extends { type: string },
  Effect extends { type: string },
  ReduceError extends Error,
>(input: {
  batchEntries: readonly WorkflowJournalEntry<CommandPayload, Event, Effect>[];
  reduce: (
    state: State | null,
    event: WorkflowJournalEventEntry<Event>
  ) => ResultType<State, ReduceError>;
  store: WorkflowJournalStore<CommandPayload, Event, Effect>;
}): Promise<
  ResultType<
    WorkflowJournalAppendResult<State, CommandPayload, Event, Effect>,
    ReduceError | WorkflowJournalCorruptStreamError
  >
> {
  const commandEntry = input.batchEntries.find(isWorkflowJournalCommandEntry);
  if (commandEntry === undefined) {
    return Result.err(
      new WorkflowJournalCorruptStreamError({
        detail:
          "workflow journal command replay found a commit without a command entry",
      })
    );
  }

  const lastBatchPosition = getLastStreamPosition(input.batchEntries);
  const streamEntries = await input.store.loadStream({
    family: commandEntry.family,
    streamId: commandEntry.streamId,
  });
  const replayEntries = streamEntries.filter(
    (entry) => entry.streamPosition <= lastBatchPosition
  );
  const cursor = foldWorkflowJournalEntries({
    entries: replayEntries,
    reduce: input.reduce,
    streamId: commandEntry.streamId,
  });
  if (cursor.isErr()) {
    return Result.err(cursor.error);
  }

  return Result.ok({
    commitId: commandEntry.commitId,
    cursor: cursor.value,
    entries: sortJournalEntries(input.batchEntries),
    freshEffects: [],
    idempotency: "replayed",
  });
}

function collectFreshEffects<
  State,
  CommandPayload extends { type: string },
  Event extends { type: string },
  Effect extends { type: string },
>(input: {
  cursor: WorkflowJournalCursor<State, CommandPayload, Event, Effect>;
  entries: readonly WorkflowJournalEntry<CommandPayload, Event, Effect>[];
}): WorkflowJournalEffectToken<Effect>[] {
  const pendingEffectIds = new Set(
    input.cursor.pendingEffects.map((effect) => effect.effectId)
  );

  return input.entries.flatMap((entry) =>
    entry.kind === "effect_scheduled" && pendingEffectIds.has(entry.effectId)
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

function getLastStreamPosition<
  CommandPayload extends { type: string },
  Event extends { type: string },
  Effect extends { type: string },
>(entries: readonly WorkflowJournalEntry<CommandPayload, Event, Effect>[]) {
  return entries.reduce(
    (position, entry) => Math.max(position, entry.streamPosition),
    0
  );
}

function sortJournalEntries<
  CommandPayload extends { type: string },
  Event extends { type: string },
  Effect extends { type: string },
>(entries: readonly WorkflowJournalEntry<CommandPayload, Event, Effect>[]) {
  return [...entries].sort(
    (left, right) =>
      left.streamPosition - right.streamPosition ||
      left.entryId.localeCompare(right.entryId)
  );
}

function loadCommitEntries<
  CommandPayload extends { type: string },
  Event extends { type: string },
  Effect extends { type: string },
>(
  entries: readonly WorkflowJournalEntry<CommandPayload, Event, Effect>[],
  commitId: string
) {
  return sortJournalEntries(
    entries.filter((entry) => entry.commitId === commitId)
  );
}

function isWorkflowJournalCommandEntry<
  CommandPayload extends { type: string },
  Event extends { type: string },
  Effect extends { type: string },
>(
  entry: WorkflowJournalEntry<CommandPayload, Event, Effect>
): entry is WorkflowJournalCommandEntry<CommandPayload> {
  return entry.kind === "command";
}

type MutableWorkflowJournalEffectState<Effect extends { type: string }> = {
  -readonly [Key in keyof WorkflowJournalEffectState<Effect>]: WorkflowJournalEffectState<Effect>[Key];
};

function requireKnownEffect<Effect extends { type: string }>(
  entry:
    | WorkflowJournalEffectStartedEntry
    | WorkflowJournalEffectCompletedEntry
    | WorkflowJournalEffectFailedEntry,
  effectsById: ReadonlyMap<string, MutableWorkflowJournalEffectState<Effect>>
): ResultType<
  MutableWorkflowJournalEffectState<Effect>,
  WorkflowJournalCorruptStreamError
> {
  const effect = effectsById.get(entry.effectId);
  if (effect === undefined) {
    return Result.err(
      corruptEffectEntry(entry, `unknown effect ${entry.effectId}`)
    );
  }

  return Result.ok(effect);
}

function requireEffectState<Effect extends { type: string }>(
  effectId: string,
  effectsById: ReadonlyMap<string, MutableWorkflowJournalEffectState<Effect>>
) {
  const effect = effectsById.get(effectId);
  if (effect === undefined) {
    throw new Error(`workflow journal effect ${effectId} disappeared`);
  }

  return effect;
}

function freezeEffectState<Effect extends { type: string }>(
  effect: WorkflowJournalEffectState<Effect>
): WorkflowJournalEffectState<Effect> {
  return {
    ...effect,
  };
}

function isRunnableEffectStatus(status: WorkflowJournalEffectStatus) {
  return status === "scheduled" || status === "failed";
}

function toEffectToken<Effect extends { type: string }>(
  effect: WorkflowJournalEffectState<Effect>
): WorkflowJournalEffectToken<Effect> {
  return {
    effect: effect.effect,
    effectId: effect.effectId,
    effectType: effect.effectType,
    scheduledAt: effect.scheduledAt,
    scheduledByEntryId: effect.scheduledByEntryId,
    streamId: effect.streamId,
    streamPosition: effect.streamPosition,
  };
}

function corruptEffectEntry(
  entry:
    | WorkflowJournalEffectScheduledEntry<{ type: string }>
    | WorkflowJournalEffectStartedEntry
    | WorkflowJournalEffectCompletedEntry
    | WorkflowJournalEffectFailedEntry,
  detail: string
) {
  return new WorkflowJournalCorruptStreamError({
    detail,
    entryId: entry.entryId,
    family: entry.family,
    streamId: entry.streamId,
  });
}
