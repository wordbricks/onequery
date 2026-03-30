import { useMachine } from "@xstate/react";
import { useCallback, useEffect, useMemo } from "react";
import { toast } from "sonner";
import { assign, fromPromise, setup } from "xstate";

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
  SETTINGS_SYNCED: "budgetSettings/settingsSynced",
} as const;

const BUDGET_SETTINGS_STATE = {
  EDITING: "editing",
  ERROR: "error",
  SAVED: "saved",
  SAVING: "saving",
} as const;

type BudgetSettingsContext = {
  budgetInput: string;
  persistedBudgetUsd: number | null;
};

type BudgetSettingsEvent =
  | {
      type: typeof BUDGET_SETTINGS_EVENT.INPUT_CHANGED;
      value: string;
    }
  | { type: typeof BUDGET_SETTINGS_EVENT.SAVE }
  | { type: typeof BUDGET_SETTINGS_EVENT.CLEAR }
  | {
      type: typeof BUDGET_SETTINGS_EVENT.SETTINGS_SYNCED;
      monthlyBudgetUsd: number | null;
    };

type BudgetSettingsMachineInput = {
  initialBudgetUsd: number | null;
  saveBudget: (nextBudgetUsd: number | null) => Promise<OrganizationSettings>;
  errorMessage?: string;
};

type BudgetSettingsActorInput = {
  nextBudgetUsd: number | null;
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

function createInitialContext(
  initialBudgetUsd: number | null
): BudgetSettingsContext {
  return {
    budgetInput: formatBudgetInput(initialBudgetUsd),
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

function createBudgetSettingsMachine(input: BudgetSettingsMachineInput) {
  return setup({
    actions: {
      updateBudgetInput: assign({
        budgetInput: (_, params: { value: string }) => params.value,
      }),
      clearBudgetInput: assign({
        budgetInput: () => "",
      }),
      storePersistedBudget: assign({
        persistedBudgetUsd: (_, params: { monthlyBudgetUsd: number | null }) =>
          params.monthlyBudgetUsd,
        budgetInput: (_, params: { monthlyBudgetUsd: number | null }) =>
          formatBudgetInput(params.monthlyBudgetUsd),
      }),
      syncBudgetFromSettings: assign({
        persistedBudgetUsd: (_, params: { monthlyBudgetUsd: number | null }) =>
          params.monthlyBudgetUsd,
        budgetInput: (_, params: { monthlyBudgetUsd: number | null }) =>
          formatBudgetInput(params.monthlyBudgetUsd),
      }),
      notifySaveError: () => {
        toast.error(input.errorMessage ?? DEFAULT_ERROR_MESSAGE);
      },
    },
    actors: {
      saveBudget: fromPromise<OrganizationSettings, BudgetSettingsActorInput>(
        async ({ input: actorInput }) =>
          input.saveBudget(actorInput.nextBudgetUsd)
      ),
    },
    guards: {
      canSave: ({ context }) => canSaveBudget(context),
      canClear: ({ context }) => canClearBudget(context),
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
            target: BUDGET_SETTINGS_STATE.SAVING,
          },
          [BUDGET_SETTINGS_EVENT.CLEAR]: {
            guard: "canClear",
            target: BUDGET_SETTINGS_STATE.SAVING,
            actions: "clearBudgetInput",
          },
        },
      },
      [BUDGET_SETTINGS_STATE.SAVING]: {
        invoke: {
          src: "saveBudget",
          input: ({ context }) => ({
            nextBudgetUsd: getPendingBudgetUsd(context),
          }),
          onDone: {
            target: BUDGET_SETTINGS_STATE.SAVED,
            actions: {
              type: "storePersistedBudget",
              params: ({ event }) => ({
                monthlyBudgetUsd: event.output.monthlyBudgetUsd,
              }),
            },
          },
          onError: {
            target: BUDGET_SETTINGS_STATE.ERROR,
            actions: "notifySaveError",
          },
        },
        on: {
          [BUDGET_SETTINGS_EVENT.INPUT_CHANGED]: {
            actions: {
              type: "updateBudgetInput",
              params: ({ event }) => ({
                value: event.value,
              }),
            },
          },
        },
      },
      [BUDGET_SETTINGS_STATE.SAVED]: {
        after: {
          [SAVED_IDLE_DELAY_MS]: BUDGET_SETTINGS_STATE.EDITING,
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
            target: BUDGET_SETTINGS_STATE.SAVING,
          },
          [BUDGET_SETTINGS_EVENT.CLEAR]: {
            guard: "canClear",
            target: BUDGET_SETTINGS_STATE.SAVING,
            actions: "clearBudgetInput",
          },
        },
      },
      [BUDGET_SETTINGS_STATE.ERROR]: {
        after: {
          [ERROR_IDLE_DELAY_MS]: BUDGET_SETTINGS_STATE.EDITING,
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
            target: BUDGET_SETTINGS_STATE.SAVING,
          },
          [BUDGET_SETTINGS_EVENT.CLEAR]: {
            guard: "canClear",
            target: BUDGET_SETTINGS_STATE.SAVING,
            actions: "clearBudgetInput",
          },
        },
      },
    },
  });
}

export function useBudgetSettingsController(
  input: UseBudgetSettingsControllerInput
): BudgetSettingsController {
  const machine = useMemo(
    () =>
      createBudgetSettingsMachine({
        initialBudgetUsd: input.monthlyBudgetUsd,
        saveBudget: input.saveBudget,
        errorMessage: input.errorMessage,
      }),
    [input.errorMessage, input.saveBudget]
  );
  const [state, send] = useMachine(machine);

  useEffect(() => {
    // Comment: React Query owns the persisted setting. Re-sync the local draft
    // whenever that canonical value changes.
    send({
      monthlyBudgetUsd: input.monthlyBudgetUsd,
      type: BUDGET_SETTINGS_EVENT.SETTINGS_SYNCED,
    });
  }, [input.monthlyBudgetUsd, send]);

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
