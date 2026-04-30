import { useMachine } from "@xstate/react";
import { Result, TaggedError } from "better-result";
import type { Result as ResultType } from "better-result";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { assertEvent, assign, setup } from "xstate";

import type { SaveStatus } from "@/lib/use-auto-save";
import type { OrganizationSettings } from "@/queries/organization-queries";

import {
  formatBudgetInput,
  getBudgetSaveDisabled,
  parseBudgetInput,
} from "./budget-dashboard-formatters";

const SAVED_IDLE_DELAY_MS = 2000;
const ERROR_IDLE_DELAY_MS = 3000;
const DEFAULT_ERROR_MESSAGE = "Failed to save monthly budget";

const BUDGET_SETTINGS_EVENT = {
  CLEAR: "budgetSettings/clear",
  INPUT_CHANGED: "budgetSettings/inputChanged",
  SAVE: "budgetSettings/save",
  SAVE_FAILED: "budgetSettings/saveFailed",
  SAVE_SUCCEEDED: "budgetSettings/saveSucceeded",
  SETTINGS_SYNCED: "budgetSettings/settingsSynced",
} as const;

const BUDGET_SETTINGS_STATE = {
  EDITING: "editing",
  ERROR: "error",
  SAVED: "saved",
  SAVING: "saving",
} as const;

type PendingBudgetSaveRequest = {
  nextBudgetUsd: number | null;
  requestId: number;
};

type BudgetSettingsContext = {
  budgetInput: string;
  nextSaveRequestId: number;
  pendingSaveRequest: PendingBudgetSaveRequest | null;
  persistedBudgetUsd: number | null;
};

type BudgetSettingsEvent =
  | {
      type: typeof BUDGET_SETTINGS_EVENT.INPUT_CHANGED;
      value: string;
    }
  | { type: typeof BUDGET_SETTINGS_EVENT.SAVE }
  | {
      type: typeof BUDGET_SETTINGS_EVENT.SAVE_FAILED;
      requestId: number;
    }
  | {
      type: typeof BUDGET_SETTINGS_EVENT.SAVE_SUCCEEDED;
      monthlyBudgetUsd: number | null;
      requestId: number;
    }
  | { type: typeof BUDGET_SETTINGS_EVENT.CLEAR }
  | {
      type: typeof BUDGET_SETTINGS_EVENT.SETTINGS_SYNCED;
      monthlyBudgetUsd: number | null;
    };

type BudgetSettingsMachineInput = {
  initialBudgetUsd: number | null;
};

type BudgetSettingsMachineOptions = {
  errorIdleDelayMs?: number;
  savedIdleDelayMs?: number;
};

type BudgetSettingsTypes = {
  context: BudgetSettingsContext;
  events: BudgetSettingsEvent;
};

type UseBudgetSettingsControllerInput = {
  monthlyBudgetUsd: number | null;
  saveBudget: (nextBudgetUsd: number | null) => Promise<OrganizationSettings>;
  errorMessage?: string;
};

type BudgetSettingsController = {
  budgetInput: string;
  saveStatus: SaveStatus;
  isSavePending: boolean;
  isSaveDisabled: boolean;
  hasBudgetConfigured: boolean;
  isBudgetInputInvalid: boolean;
  setBudgetInput: (value: string) => void;
  save: () => void;
  clear: () => void;
};

class BudgetSaveError extends TaggedError("BudgetSaveError")<{
  cause: unknown;
  message: string;
}>() {}

type BudgetSaveResult = ResultType<OrganizationSettings, BudgetSaveError>;

function createInitialContext(
  initialBudgetUsd: number | null
): BudgetSettingsContext {
  return {
    budgetInput: formatBudgetInput(initialBudgetUsd),
    nextSaveRequestId: 1,
    pendingSaveRequest: null,
    persistedBudgetUsd: initialBudgetUsd,
  };
}

function getPendingBudgetUsd(context: BudgetSettingsContext): number | null {
  const parsedBudgetInput = parseBudgetInput(context.budgetInput);
  if (parsedBudgetInput === "invalid") {
    throw new Error("Budget input must be valid before saving");
  }

  return parsedBudgetInput;
}

function canSaveBudget(context: BudgetSettingsContext): boolean {
  return !getBudgetSaveDisabled({
    currentBudgetUsd: context.persistedBudgetUsd,
    isPending: false,
    parsedBudgetInput: parseBudgetInput(context.budgetInput),
  });
}

function canClearBudget(context: BudgetSettingsContext): boolean {
  return (
    context.persistedBudgetUsd !== null || context.budgetInput.trim().length > 0
  );
}

function toSaveStatus(stateValue: string): SaveStatus {
  if (stateValue === BUDGET_SETTINGS_STATE.SAVING) {
    return "saving";
  }
  if (stateValue === BUDGET_SETTINGS_STATE.SAVED) {
    return "saved";
  }
  if (stateValue === BUDGET_SETTINGS_STATE.ERROR) {
    return "error";
  }
  return "idle";
}

async function saveBudgetRequest(input: {
  errorMessage: string;
  nextBudgetUsd: number | null;
  saveBudget: (nextBudgetUsd: number | null) => Promise<OrganizationSettings>;
}): Promise<BudgetSaveResult> {
  return Result.tryPromise({
    try: () => input.saveBudget(input.nextBudgetUsd),
    catch: (cause: unknown) =>
      new BudgetSaveError({
        cause,
        message: input.errorMessage,
      }),
  });
}

export function createBudgetSettingsMachine(
  input: BudgetSettingsMachineInput,
  options: BudgetSettingsMachineOptions = {}
) {
  const savedIdleDelayMs = options.savedIdleDelayMs ?? SAVED_IDLE_DELAY_MS;
  const errorIdleDelayMs = options.errorIdleDelayMs ?? ERROR_IDLE_DELAY_MS;

  return setup({
    actions: {
      clearPendingSaveRequest: assign({
        pendingSaveRequest: () => null,
      }),
      updateBudgetInput: assign({
        budgetInput: (_, params: { value: string }) => params.value,
      }),
      clearBudgetInput: assign({
        budgetInput: () => "",
      }),
      syncBudgetFromSettings: assign({
        persistedBudgetUsd: (_, params: { monthlyBudgetUsd: number | null }) =>
          params.monthlyBudgetUsd,
        budgetInput: (_, params: { monthlyBudgetUsd: number | null }) =>
          formatBudgetInput(params.monthlyBudgetUsd),
      }),
      startSaveRequest: assign(({ context }) => ({
        nextSaveRequestId: context.nextSaveRequestId + 1,
        pendingSaveRequest: {
          nextBudgetUsd: getPendingBudgetUsd(context),
          requestId: context.nextSaveRequestId,
        },
      })),
      storePersistedBudget: assign(({ context, event }) => {
        assertEvent(event, BUDGET_SETTINGS_EVENT.SAVE_SUCCEEDED);

        if (context.pendingSaveRequest?.requestId !== event.requestId) {
          return {};
        }

        return {
          budgetInput: formatBudgetInput(event.monthlyBudgetUsd),
          persistedBudgetUsd: event.monthlyBudgetUsd,
        };
      }),
    },
    guards: {
      canSave: ({ context }) => canSaveBudget(context),
      canClear: ({ context }) => canClearBudget(context),
      matchesPendingSaveRequest: ({ context, event }) => {
        if (
          event.type !== BUDGET_SETTINGS_EVENT.SAVE_FAILED &&
          event.type !== BUDGET_SETTINGS_EVENT.SAVE_SUCCEEDED
        ) {
          return false;
        }

        return context.pendingSaveRequest?.requestId === event.requestId;
      },
    },
    types: {} as BudgetSettingsTypes,
  }).createMachine({
    context: createInitialContext(input.initialBudgetUsd),
    id: "budgetSettings",
    initial: BUDGET_SETTINGS_STATE.EDITING,
    on: {
      [BUDGET_SETTINGS_EVENT.SETTINGS_SYNCED]: {
        actions: {
          type: "syncBudgetFromSettings",
          params: ({ event }) => ({
            monthlyBudgetUsd: event.monthlyBudgetUsd,
          }),
        },
      },
    },
    states: {
      [BUDGET_SETTINGS_STATE.EDITING]: {
        on: {
          [BUDGET_SETTINGS_EVENT.INPUT_CHANGED]: {
            actions: {
              type: "updateBudgetInput",
              params: ({ event }) => ({
                value: event.value,
              }),
            },
          },
          [BUDGET_SETTINGS_EVENT.SAVE]: {
            guard: "canSave",
            actions: "startSaveRequest",
            target: BUDGET_SETTINGS_STATE.SAVING,
          },
          [BUDGET_SETTINGS_EVENT.CLEAR]: {
            guard: "canClear",
            actions: ["clearBudgetInput", "startSaveRequest"],
            target: BUDGET_SETTINGS_STATE.SAVING,
          },
        },
      },
      [BUDGET_SETTINGS_STATE.SAVING]: {
        on: {
          [BUDGET_SETTINGS_EVENT.INPUT_CHANGED]: {
            actions: {
              type: "updateBudgetInput",
              params: ({ event }) => ({
                value: event.value,
              }),
            },
          },
          [BUDGET_SETTINGS_EVENT.SAVE_SUCCEEDED]: {
            actions: ["storePersistedBudget", "clearPendingSaveRequest"],
            guard: "matchesPendingSaveRequest",
            target: BUDGET_SETTINGS_STATE.SAVED,
          },
          [BUDGET_SETTINGS_EVENT.SAVE_FAILED]: {
            actions: "clearPendingSaveRequest",
            guard: "matchesPendingSaveRequest",
            target: BUDGET_SETTINGS_STATE.ERROR,
          },
        },
      },
      [BUDGET_SETTINGS_STATE.SAVED]: {
        after: {
          [savedIdleDelayMs]: BUDGET_SETTINGS_STATE.EDITING,
        },
        on: {
          [BUDGET_SETTINGS_EVENT.INPUT_CHANGED]: {
            target: BUDGET_SETTINGS_STATE.EDITING,
            actions: {
              type: "updateBudgetInput",
              params: ({ event }) => ({
                value: event.value,
              }),
            },
          },
          [BUDGET_SETTINGS_EVENT.SAVE]: {
            guard: "canSave",
            actions: "startSaveRequest",
            target: BUDGET_SETTINGS_STATE.SAVING,
          },
          [BUDGET_SETTINGS_EVENT.CLEAR]: {
            guard: "canClear",
            actions: ["clearBudgetInput", "startSaveRequest"],
            target: BUDGET_SETTINGS_STATE.SAVING,
          },
        },
      },
      [BUDGET_SETTINGS_STATE.ERROR]: {
        after: {
          [errorIdleDelayMs]: BUDGET_SETTINGS_STATE.EDITING,
        },
        on: {
          [BUDGET_SETTINGS_EVENT.INPUT_CHANGED]: {
            target: BUDGET_SETTINGS_STATE.EDITING,
            actions: {
              type: "updateBudgetInput",
              params: ({ event }) => ({
                value: event.value,
              }),
            },
          },
          [BUDGET_SETTINGS_EVENT.SAVE]: {
            guard: "canSave",
            actions: "startSaveRequest",
            target: BUDGET_SETTINGS_STATE.SAVING,
          },
          [BUDGET_SETTINGS_EVENT.CLEAR]: {
            guard: "canClear",
            actions: ["clearBudgetInput", "startSaveRequest"],
            target: BUDGET_SETTINGS_STATE.SAVING,
          },
        },
      },
    },
  });
}

export function useBudgetSettingsController(
  input: UseBudgetSettingsControllerInput
): BudgetSettingsController {
  const [machine] = useState(() =>
    createBudgetSettingsMachine({
      initialBudgetUsd: input.monthlyBudgetUsd,
    })
  );
  const [state, send] = useMachine(machine);
  const pendingSaveRequest = state.context.pendingSaveRequest;
  const isSaving = state.matches(BUDGET_SETTINGS_STATE.SAVING);

  useEffect(() => {
    // Comment: React Query owns the persisted setting. Re-sync the local draft
    // whenever that canonical value changes.
    send({
      monthlyBudgetUsd: input.monthlyBudgetUsd,
      type: BUDGET_SETTINGS_EVENT.SETTINGS_SYNCED,
    });
  }, [input.monthlyBudgetUsd, send]);

  useEffect(() => {
    if (!isSaving || pendingSaveRequest === null) {
      return;
    }

    let isCancelled = false;

    void saveBudgetRequest({
      errorMessage: input.errorMessage ?? DEFAULT_ERROR_MESSAGE,
      nextBudgetUsd: pendingSaveRequest.nextBudgetUsd,
      saveBudget: input.saveBudget,
    }).then((result) => {
      if (isCancelled) {
        return;
      }

      if (result.isErr()) {
        toast.error(result.error.message);
        send({
          requestId: pendingSaveRequest.requestId,
          type: BUDGET_SETTINGS_EVENT.SAVE_FAILED,
        });
        return;
      }

      send({
        monthlyBudgetUsd: result.value.monthlyBudgetUsd,
        requestId: pendingSaveRequest.requestId,
        type: BUDGET_SETTINGS_EVENT.SAVE_SUCCEEDED,
      });
    });

    return () => {
      isCancelled = true;
    };
  }, [
    input.errorMessage,
    input.saveBudget,
    isSaving,
    pendingSaveRequest,
    send,
  ]);

  const setBudgetInput = useCallback(
    (value: string) => {
      send({
        type: BUDGET_SETTINGS_EVENT.INPUT_CHANGED,
        value,
      });
    },
    [send]
  );

  const save = useCallback(() => {
    send({ type: BUDGET_SETTINGS_EVENT.SAVE });
  }, [send]);

  const clear = useCallback(() => {
    send({ type: BUDGET_SETTINGS_EVENT.CLEAR });
  }, [send]);

  const parsedBudgetInput = parseBudgetInput(state.context.budgetInput);
  const isSavePending = state.matches(BUDGET_SETTINGS_STATE.SAVING);

  return {
    budgetInput: state.context.budgetInput,
    clear,
    hasBudgetConfigured: state.context.persistedBudgetUsd !== null,
    isBudgetInputInvalid: parsedBudgetInput === "invalid",
    isSaveDisabled: getBudgetSaveDisabled({
      parsedBudgetInput,
      currentBudgetUsd: state.context.persistedBudgetUsd,
      isPending: isSavePending,
    }),
    isSavePending,
    save,
    saveStatus: toSaveStatus(String(state.value)),
    setBudgetInput,
  };
}
