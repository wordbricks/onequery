import { describe, expect, it, vi } from "vitest";
import { createActor, fromPromise, waitFor } from "xstate";

import type { OrganizationSettings } from "@/queries/organization-queries";

import {
  createBudgetSettingsMachine,
  readBudgetSaveStatus,
} from "./budget-settings-controller";
import type {
  SaveBudgetActorInput,
  SaveBudgetActorOutput,
} from "./budget-settings-controller";

const SAVED_IDLE_DELAY_MS = 100;
const ERROR_IDLE_DELAY_MS = 100;
const INITIAL_BUDGET_USD = 10;
const UPDATED_BUDGET_INPUT = "25";
const RETRY_BUDGET_INPUT = "30";

function createTestMachine(
  saveBudget: (nextBudgetUsd: number | null) => Promise<OrganizationSettings>
) {
  return createBudgetSettingsMachine({
    errorIdleDelayMs: ERROR_IDLE_DELAY_MS,
    savedIdleDelayMs: SAVED_IDLE_DELAY_MS,
  }).provide({
    actors: {
      saveBudget: fromPromise<SaveBudgetActorOutput, SaveBudgetActorInput>(
        async ({ input }: { input: SaveBudgetActorInput }) =>
          saveBudget(input.nextBudgetUsd)
      ),
    },
  });
}

function createTestActor(
  saveBudget: (nextBudgetUsd: number | null) => Promise<OrganizationSettings>
) {
  return createActor(createTestMachine(saveBudget), {
    input: {
      initialBudgetUsd: INITIAL_BUDGET_USD,
    },
  });
}

function createSaveBudgetMock(
  implementation: (
    nextBudgetUsd: number | null
  ) => Promise<OrganizationSettings>
) {
  return vi.fn(implementation);
}

async function advanceTimersByTime(ms: number) {
  vi.advanceTimersByTime(ms);
  await Promise.resolve();
}

describe("createBudgetSettingsMachine", () => {
  it("stores the persisted budget after a successful save", async () => {
    const saveBudget = createSaveBudgetMock(async (nextBudgetUsd) => ({
      monthlyBudgetUsd: nextBudgetUsd,
    }));
    const actor = createTestActor(saveBudget);

    actor.start();
    actor.send({
      type: "budgetSettings/inputChanged",
      value: UPDATED_BUDGET_INPUT,
    });
    actor.send({ type: "budgetSettings/save" });

    const savedState = await waitFor(
      actor,
      (snapshot) => snapshot.matches("saved"),
      { timeout: 1000 }
    );

    expect(saveBudget).toHaveBeenCalledWith(25);
    expect(savedState.context.persistedBudgetUsd).toBe(25);
    expect(savedState.context.budgetInput).toBe("25");
    expect(savedState.context.isDirtyAfterSaveStarted).toBe(false);
  });

  it("keeps the draft input retryable after a failed save", async () => {
    const saveBudget = createSaveBudgetMock(async () => {
      throw new Error("network failed");
    });
    const actor = createTestActor(saveBudget);

    actor.start();
    actor.send({
      type: "budgetSettings/inputChanged",
      value: UPDATED_BUDGET_INPUT,
    });
    actor.send({ type: "budgetSettings/save" });

    const errorState = await waitFor(
      actor,
      (snapshot) => snapshot.matches("error"),
      { timeout: 1000 }
    );

    expect(saveBudget).toHaveBeenCalledWith(25);
    expect(errorState.context.persistedBudgetUsd).toBe(INITIAL_BUDGET_USD);
    expect(errorState.context.budgetInput).toBe(UPDATED_BUDGET_INPUT);
    expect(errorState.context.isDirtyAfterSaveStarted).toBe(false);
  });

  it("starts a null-budget save when the operator clears the field", () => {
    const saveBudget = createSaveBudgetMock(
      () => new Promise<OrganizationSettings>(() => {})
    );
    const actor = createTestActor(saveBudget);

    actor.start();
    actor.send({ type: "budgetSettings/clear" });

    const savingState = actor.getSnapshot();

    expect(savingState.matches("saving")).toBe(true);
    expect(savingState.context.budgetInput).toBe("");
    expect(savingState.context.isDirtyAfterSaveStarted).toBe(false);
    expect(saveBudget).toHaveBeenCalledWith(null);
  });

  it("returns to editing after the saved and error idle delays", async () => {
    vi.useFakeTimers();

    const successfulSaveBudget = createSaveBudgetMock(
      async (nextBudgetUsd) => ({
        monthlyBudgetUsd: nextBudgetUsd,
      })
    );
    const failedSaveBudget = createSaveBudgetMock(async () => {
      throw new Error("network failed");
    });
    const actor = createTestActor(successfulSaveBudget);

    actor.start();
    actor.send({
      type: "budgetSettings/inputChanged",
      value: UPDATED_BUDGET_INPUT,
    });
    actor.send({ type: "budgetSettings/save" });

    await waitFor(actor, (snapshot) => snapshot.matches("saved"), {
      timeout: 1000,
    });

    await advanceTimersByTime(SAVED_IDLE_DELAY_MS);

    expect(actor.getSnapshot().matches("editing")).toBe(true);

    actor.send({
      type: "budgetSettings/inputChanged",
      value: RETRY_BUDGET_INPUT,
    });
    actor.stop();

    const retryActor = createTestActor(failedSaveBudget);

    retryActor.start();
    retryActor.send({
      type: "budgetSettings/inputChanged",
      value: RETRY_BUDGET_INPUT,
    });
    retryActor.send({ type: "budgetSettings/save" });

    await waitFor(retryActor, (snapshot) => snapshot.matches("error"), {
      timeout: 1000,
    });

    await advanceTimersByTime(ERROR_IDLE_DELAY_MS);

    expect(retryActor.getSnapshot().matches("editing")).toBe(true);

    vi.useRealTimers();
  });

  it("exposes state tags for UI save status", async () => {
    const saveBudget = createSaveBudgetMock(async (nextBudgetUsd) => ({
      monthlyBudgetUsd: nextBudgetUsd,
    }));
    const actor = createTestActor(saveBudget);

    actor.start();

    expect(actor.getSnapshot().hasTag("editable")).toBe(true);
    expect(readBudgetSaveStatus(actor.getSnapshot())).toBe("idle");

    actor.send({
      type: "budgetSettings/inputChanged",
      value: UPDATED_BUDGET_INPUT,
    });
    actor.send({ type: "budgetSettings/save" });

    expect(actor.getSnapshot().hasTag("saving")).toBe(true);
    expect(readBudgetSaveStatus(actor.getSnapshot())).toBe("saving");

    const savedState = await waitFor(
      actor,
      (snapshot) => snapshot.matches("saved"),
      { timeout: 1000 }
    );

    expect(savedState.hasTag("saved")).toBe(true);
    expect(savedState.hasTag("editable")).toBe(true);
    expect(readBudgetSaveStatus(savedState)).toBe("saved");
  });
});
