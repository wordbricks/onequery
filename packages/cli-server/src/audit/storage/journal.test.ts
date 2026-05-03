import { Result } from "better-result";
import type { Result as ResultType } from "better-result";
import { describe, expect, it } from "vitest";

import {
  WorkflowJournalExpectedPositionConflictError,
  appendWorkflowJournalBatch,
  createInMemoryWorkflowJournalStore,
  foldWorkflowJournalEntries,
} from "./journal";
import type {
  WorkflowJournalEntry,
  WorkflowJournalEventEntry,
  WorkflowJournalStore,
} from "./journal";

type TestCommand =
  | {
      name: string;
      type: "start";
    }
  | {
      name: string;
      type: "record";
    }
  | {
      type: "effect_result";
    };

type TestEvent =
  | {
      name: string;
      type: "started";
    }
  | {
      name: string;
      type: "prepared";
    };

type TestEffect =
  | {
      name: string;
      type: "prepare";
    }
  | {
      name: string;
      type: "persist";
    };

type TestState = {
  eventCount: number;
  lastEventId: string;
  name: string;
  phase: "started" | "prepared";
};

class TestReduceError extends Error {}

type TestStore = WorkflowJournalStore<TestCommand, TestEvent, TestEffect> & {
  loadAllEntries: () => readonly WorkflowJournalEntry<
    TestCommand,
    TestEvent,
    TestEffect
  >[];
};

const occurredAt = new Date("2026-04-20T07:12:00.000Z");

function reduceTestState(
  state: TestState | null,
  entry: WorkflowJournalEventEntry<TestEvent>
): ResultType<TestState, TestReduceError> {
  switch (entry.event.type) {
    case "started":
      return Result.ok({
        eventCount: 1,
        lastEventId: entry.eventId,
        name: entry.event.name,
        phase: "started",
      });
    case "prepared":
      if (state === null) {
        return Result.err(new TestReduceError("prepared without start"));
      }

      return Result.ok({
        ...state,
        eventCount: state.eventCount + 1,
        lastEventId: entry.eventId,
        name: entry.event.name,
        phase: "prepared",
      });
  }
}

function createTestStore(): TestStore {
  return createInMemoryWorkflowJournalStore<
    TestCommand,
    TestEvent,
    TestEffect
  >();
}

function appendTestBatch(
  store: TestStore,
  input: {
    checkpoints?: Parameters<
      typeof appendWorkflowJournalBatch
    >[0]["checkpoints"];
    commandInvocationId: string;
    commandPayload: TestCommand;
    effectCompletions?: Parameters<
      typeof appendWorkflowJournalBatch
    >[0]["effectCompletions"];
    effectFailures?: Parameters<
      typeof appendWorkflowJournalBatch
    >[0]["effectFailures"];
    effectStarts?: Parameters<
      typeof appendWorkflowJournalBatch
    >[0]["effectStarts"];
    effects?: readonly TestEffect[];
    events?: readonly TestEvent[];
    expectedStreamPosition: number;
  }
) {
  return appendWorkflowJournalBatch({
    checkpoints: input.checkpoints,
    commandInvocationId: input.commandInvocationId,
    commandPayload: input.commandPayload,
    effectCompletions: input.effectCompletions,
    effectFailures: input.effectFailures,
    effectStarts: input.effectStarts,
    effects: input.effects,
    events: input.events,
    expectedStreamPosition: input.expectedStreamPosition,
    family: "query_action",
    occurredAt,
    organizationId: "org_1",
    reduce: reduceTestState,
    store,
    streamId: "action_1",
  });
}

function unwrap<T, TError extends Error>(result: ResultType<T, TError>): T {
  expect(result.isOk()).toBe(true);
  if (result.isErr()) {
    throw result.error;
  }

  return result.value;
}

function unwrapError<T, TError extends Error>(
  result: ResultType<T, TError>
): TError {
  expect(result.isErr()).toBe(true);
  if (result.isOk()) {
    throw new Error("expected result error");
  }

  return result.error;
}

function expectSingle<T>(values: readonly T[]): T {
  expect(values).toHaveLength(1);
  const value = values[0];
  if (value === undefined) {
    throw new Error("expected one value");
  }

  return value;
}

describe("workflow journal core", () => {
  it("replays duplicate command appends without appending entries or returning fresh effects", async () => {
    const store = createTestStore();

    const first = unwrap(
      await appendTestBatch(store, {
        commandInvocationId: "cmd-start",
        commandPayload: {
          name: "query",
          type: "start",
        },
        effects: [
          {
            name: "query",
            type: "prepare",
          },
        ],
        events: [
          {
            name: "query",
            type: "started",
          },
        ],
        expectedStreamPosition: 0,
      })
    );
    const firstEntryIds = first.entries.map((entry) => entry.entryId);

    expect(first).toMatchObject({
      idempotency: "fresh",
    });
    expect(first.cursor.streamPosition).toBe(3);
    expect(first.freshEffects).toHaveLength(1);

    const replay = unwrap(
      await appendTestBatch(store, {
        commandInvocationId: "cmd-start",
        commandPayload: {
          name: "ignored",
          type: "start",
        },
        effects: [
          {
            name: "ignored",
            type: "persist",
          },
        ],
        events: [
          {
            name: "ignored",
            type: "started",
          },
        ],
        expectedStreamPosition: 99,
      })
    );

    expect(replay.idempotency).toBe("replayed");
    expect(replay.commitId).toBe(first.commitId);
    expect(replay.entries.map((entry) => entry.entryId)).toEqual(firstEntryIds);
    expect(replay.freshEffects).toEqual([]);
    expect(store.loadAllEntries()).toHaveLength(first.entries.length);
  });

  it("rejects appends when the expected stream position is stale", async () => {
    const store = createTestStore();

    const first = unwrap(
      await appendTestBatch(store, {
        commandInvocationId: "cmd-start",
        commandPayload: {
          name: "query",
          type: "start",
        },
        events: [
          {
            name: "query",
            type: "started",
          },
        ],
        expectedStreamPosition: 0,
      })
    );

    const conflict = unwrapError(
      await appendTestBatch(store, {
        commandInvocationId: "cmd-record",
        commandPayload: {
          name: "query",
          type: "record",
        },
        events: [
          {
            name: "query",
            type: "prepared",
          },
        ],
        expectedStreamPosition: 0,
      })
    );

    expect(conflict).toBeInstanceOf(
      WorkflowJournalExpectedPositionConflictError
    );
    expect(conflict).toMatchObject({
      currentStreamPosition: first.cursor.streamPosition,
      expectedStreamPosition: 0,
      streamId: "action_1",
    });
    expect(store.loadAllEntries()).toHaveLength(first.entries.length);
  });

  it("folds journal events and checkpoints into a replay cursor", async () => {
    const store = createTestStore();

    const started = unwrap(
      await appendTestBatch(store, {
        checkpoints: [
          {
            checkpointName: "started",
          },
        ],
        commandInvocationId: "cmd-start",
        commandPayload: {
          name: "query",
          type: "start",
        },
        events: [
          {
            name: "query",
            type: "started",
          },
        ],
        expectedStreamPosition: 0,
      })
    );
    unwrap(
      await appendTestBatch(store, {
        checkpoints: [
          {
            checkpointName: "prepared",
          },
        ],
        commandInvocationId: "cmd-prepared",
        commandPayload: {
          name: "prepared query",
          type: "record",
        },
        events: [
          {
            name: "prepared query",
            type: "prepared",
          },
        ],
        expectedStreamPosition: started.cursor.streamPosition,
      })
    );

    const folded = unwrap(
      foldWorkflowJournalEntries({
        entries: await store.loadStream({
          family: "query_action",
          streamId: "action_1",
        }),
        reduce: reduceTestState,
      })
    );

    expect(folded.state).toEqual({
      eventCount: 2,
      lastEventId: folded.events[1]?.eventId,
      name: "prepared query",
      phase: "prepared",
    });
    expect(folded.checkpoint?.checkpointName).toBe("prepared");
    expect(folded.commands.map((entry) => entry.commandInvocationId)).toEqual([
      "cmd-start",
      "cmd-prepared",
    ]);
  });

  it("tracks effect scheduling, direct completion, claim, failure, retry, and completion", async () => {
    const store = createTestStore();

    const scheduled = unwrap(
      await appendTestBatch(store, {
        commandInvocationId: "cmd-start",
        commandPayload: {
          name: "query",
          type: "start",
        },
        effects: [
          {
            name: "query",
            type: "prepare",
          },
        ],
        events: [
          {
            name: "query",
            type: "started",
          },
        ],
        expectedStreamPosition: 0,
      })
    );
    const directEffect = expectSingle(scheduled.freshEffects);

    const directCompleted = unwrap(
      await appendTestBatch(store, {
        commandInvocationId: "cmd-direct-complete",
        commandPayload: {
          type: "effect_result",
        },
        effectCompletions: [
          {
            effectId: directEffect.effectId,
          },
        ],
        expectedStreamPosition: scheduled.cursor.streamPosition,
      })
    );

    expect(directCompleted.cursor.pendingEffects).toEqual([]);
    expect(expectSingle(directCompleted.cursor.effects)).toMatchObject({
      effectId: directEffect.effectId,
      status: "completed",
    });

    const retryScheduled = unwrap(
      await appendTestBatch(store, {
        commandInvocationId: "cmd-schedule-persist",
        commandPayload: {
          name: "query",
          type: "record",
        },
        effects: [
          {
            name: "query",
            type: "persist",
          },
        ],
        events: [
          {
            name: "prepared query",
            type: "prepared",
          },
        ],
        expectedStreamPosition: directCompleted.cursor.streamPosition,
      })
    );
    const retryEffect = expectSingle(retryScheduled.freshEffects);

    const claimed = unwrap(
      await appendTestBatch(store, {
        commandInvocationId: "cmd-claim",
        commandPayload: {
          type: "effect_result",
        },
        effectStarts: [
          {
            effectId: retryEffect.effectId,
            workerId: "worker_1",
          },
        ],
        expectedStreamPosition: retryScheduled.cursor.streamPosition,
      })
    );

    expect(claimed.cursor.pendingEffects).toEqual([]);
    expect(
      claimed.cursor.effects.find(
        (effect) => effect.effectId === retryEffect.effectId
      )
    ).toMatchObject({
      attemptCount: 1,
      status: "started",
    });

    const failed = unwrap(
      await appendTestBatch(store, {
        commandInvocationId: "cmd-fail",
        commandPayload: {
          type: "effect_result",
        },
        effectFailures: [
          {
            effectId: retryEffect.effectId,
            errorCode: "temporary_failure",
            errorDetail: "retry later",
          },
        ],
        expectedStreamPosition: claimed.cursor.streamPosition,
      })
    );

    expect(
      failed.cursor.pendingEffects.map((effect) => effect.effectId)
    ).toEqual([retryEffect.effectId]);
    expect(
      failed.cursor.effects.find(
        (effect) => effect.effectId === retryEffect.effectId
      )
    ).toMatchObject({
      attemptCount: 1,
      lastErrorCode: "temporary_failure",
      status: "failed",
    });

    const retried = unwrap(
      await appendTestBatch(store, {
        commandInvocationId: "cmd-retry",
        commandPayload: {
          type: "effect_result",
        },
        effectStarts: [
          {
            effectId: retryEffect.effectId,
            workerId: "worker_2",
          },
        ],
        expectedStreamPosition: failed.cursor.streamPosition,
      })
    );
    const completed = unwrap(
      await appendTestBatch(store, {
        commandInvocationId: "cmd-complete",
        commandPayload: {
          type: "effect_result",
        },
        effectCompletions: [
          {
            effectId: retryEffect.effectId,
          },
        ],
        expectedStreamPosition: retried.cursor.streamPosition,
      })
    );

    expect(completed.cursor.pendingEffects).toEqual([]);
    expect(
      completed.cursor.effects.find(
        (effect) => effect.effectId === retryEffect.effectId
      )
    ).toMatchObject({
      attemptCount: 2,
      lastErrorCode: null,
      status: "completed",
    });
  });
});
