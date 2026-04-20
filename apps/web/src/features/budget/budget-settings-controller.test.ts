import { describe, expect, it, vi } from "vitest";
import { createActor } from "xstate";
import { getPathsFromEvents, getShortestPaths } from "xstate/graph";

import { createBudgetSettingsMachine } from "./budget-settings-controller";

const SAVED_IDLE_DELAY_MS = 100;
const ERROR_IDLE_DELAY_MS = 100;
const INITIAL_BUDGET_USD = 10;
const UPDATED_BUDGET_INPUT = "25";
const RETRY_BUDGET_INPUT = "30";

function createTestMachine() {
  return createBudgetSettingsMachine(
    {
      initialBudgetUsd: INITIAL_BUDGET_USD,
    },
    {
      errorIdleDelayMs: ERROR_IDLE_DELAY_MS,
      savedIdleDelayMs: SAVED_IDLE_DELAY_MS,
    }
  );
}

function buildBudgetSettingsShortestPaths() {
  return getShortestPaths(createTestMachine(), {
    events: (state) => {
      if (state.matches("saving")) {
        const pendingSaveRequest = state.context.pendingSaveRequest;

        if (pendingSaveRequest === null) {
          return [];
        }

        return [
          {
            type: "budgetSettings/saveSucceeded" as const,
            monthlyBudgetUsd: pendingSaveRequest.nextBudgetUsd,
            requestId: pendingSaveRequest.requestId,
          },
          {
            type: "budgetSettings/saveFailed" as const,
            requestId: pendingSaveRequest.requestId,
          },
        ];
      }

      return [
        {
          type: "budgetSettings/inputChanged" as const,
          value: UPDATED_BUDGET_INPUT,
        },
        {
          type: "budgetSettings/clear" as const,
        },
        {
          type: "budgetSettings/save" as const,
        },
      ];
    },
    filterEvents: (state, event) => state.can(event),
    stopWhen: (state) =>
      state.matches("saved") ||
      state.matches("error") ||
      (state.matches("saving") &&
        state.context.pendingSaveRequest?.nextBudgetUsd === null),
  });
}

function describeGraphPath(path: {
  state: { value: unknown };
  steps: Array<{ event: { type: string } }>;
}) {
  return `${JSON.stringify(path.state.value)} via ${path.steps
    .map((step) => step.event.type)
    .join(" -> ")}`;
}

async function advanceTimersByTime(ms: number) {
  vi.advanceTimersByTime(ms);
  await Promise.resolve();
}

describe("createBudgetSettingsMachine", () => {
  it("stores the persisted budget after a successful save", () => {
    const [path] = getPathsFromEvents(createTestMachine(), [
      {
        type: "budgetSettings/inputChanged",
        value: UPDATED_BUDGET_INPUT,
      },
      {
        type: "budgetSettings/save",
      },
      {
        type: "budgetSettings/saveSucceeded",
        monthlyBudgetUsd: 25,
        requestId: 1,
      },
    ]);

    expect(path).toBeDefined();

    if (!path) {
      throw new Error("expected a graph path for the budget save success flow");
    }

    expect(path.state.matches("saved")).toBe(true);
    expect(path.state.context.persistedBudgetUsd).toBe(25);
    expect(path.state.context.budgetInput).toBe("25");
    expect(path.state.context.pendingSaveRequest).toBeNull();
  });

  it("keeps the draft input retryable after a failed save", () => {
    const [path] = getPathsFromEvents(createTestMachine(), [
      {
        type: "budgetSettings/inputChanged",
        value: UPDATED_BUDGET_INPUT,
      },
      {
        type: "budgetSettings/save",
      },
      {
        type: "budgetSettings/saveFailed",
        requestId: 1,
      },
    ]);

    expect(path).toBeDefined();

    if (!path) {
      throw new Error("expected a graph path for the budget save failure flow");
    }

    expect(path.state.matches("error")).toBe(true);
    expect(path.state.context.persistedBudgetUsd).toBe(INITIAL_BUDGET_USD);
    expect(path.state.context.budgetInput).toBe(UPDATED_BUDGET_INPUT);
    expect(path.state.context.pendingSaveRequest).toBeNull();
  });

  it("queues a null-budget save when the operator clears the field", () => {
    const [path] = getPathsFromEvents(createTestMachine(), [
      {
        type: "budgetSettings/clear",
      },
    ]);

    expect(path).toBeDefined();

    if (!path) {
      throw new Error("expected a graph path for the budget clear flow");
    }

    expect(path.state.matches("saving")).toBe(true);
    expect(path.state.context.budgetInput).toBe("");
    expect(path.state.context.pendingSaveRequest).toEqual({
      nextBudgetUsd: null,
      requestId: 1,
    });
  });

  it("returns to editing after the saved and error idle delays", async () => {
    vi.useFakeTimers();

    const actor = createActor(createTestMachine());

    actor.start();
    actor.send({
      type: "budgetSettings/inputChanged",
      value: UPDATED_BUDGET_INPUT,
    });
    actor.send({ type: "budgetSettings/save" });
    actor.send({
      type: "budgetSettings/saveSucceeded",
      monthlyBudgetUsd: 25,
      requestId: 1,
    });

    expect(actor.getSnapshot().matches("saved")).toBe(true);

    await advanceTimersByTime(SAVED_IDLE_DELAY_MS);

    expect(actor.getSnapshot().matches("editing")).toBe(true);

    actor.send({
      type: "budgetSettings/inputChanged",
      value: RETRY_BUDGET_INPUT,
    });
    actor.send({ type: "budgetSettings/save" });
    actor.send({
      type: "budgetSettings/saveFailed",
      requestId: 2,
    });

    expect(actor.getSnapshot().matches("error")).toBe(true);

    await advanceTimersByTime(ERROR_IDLE_DELAY_MS);

    expect(actor.getSnapshot().matches("editing")).toBe(true);

    vi.useRealTimers();
  });

  describe("graph coverage", () => {
    for (const path of buildBudgetSettingsShortestPaths()) {
      it(describeGraphPath(path), () => {
        if (path.state.matches("editing")) {
          expect(path.state.context.pendingSaveRequest).toBeNull();
          return;
        }

        if (path.state.matches("saving")) {
          expect(path.state.context.pendingSaveRequest).not.toBeNull();
          return;
        }

        if (path.state.matches("saved")) {
          expect(path.state.context.pendingSaveRequest).toBeNull();
          expect(path.state.context.persistedBudgetUsd).not.toBeUndefined();
          return;
        }

        expect(path.state.matches("error")).toBe(true);
        expect(path.state.context.pendingSaveRequest).toBeNull();
      });
    }
  });
});
