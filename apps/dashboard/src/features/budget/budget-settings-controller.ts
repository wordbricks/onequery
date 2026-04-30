import { useActor } from "@xstate/react";
import { Result, TaggedError } from "better-result";
import { toast } from "sonner";
import { assertEvent, assign, fromPromise, setup } from "xstate";
import type { SnapshotFrom } from "xstate";

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
} as const;

const BUDGET_SETTINGS_STATE = {
  EDITING: "editing",
  ERROR: "error",
  SAVED: "saved",
  SAVING: "saving",
} as const;

const BUDGET_SETTINGS_TAG = {
  EDITABLE: "editable",
  ERROR: "error",
  SAVED: "saved",
  SAVING: "saving",
} as const;

type BudgetSettingsContext = {
  budgetInput: string;
  isDirtyAfterSaveStarted: boolean;
  persistedBudgetUsd: number | null;
};

type BudgetSettingsEvent =
  | {
      type: typeof BUDGET_SETTINGS_EVENT.INPUT_CHANGED;
      value: string;
    }
  | { type: typeof BUDGET_SETTINGS_EVENT.SAVE }
  | { type: typeof BUDGET_SETTINGS_EVENT.CLEAR };

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
  input: BudgetSettingsMachineInput;
};

export type SaveBudgetActorInput = {
  nextBudgetUsd: number | null;
};

export type SaveBudgetActorOutput = Pick<
  OrganizationSettings,
  "monthlyBudgetUsd"
>;

type SaveBudgetRequestInput = SaveBudgetActorInput & {
  errorMessage: string;
  saveBudget: (nextBudgetUsd: number | null) => Promise<OrganizationSettings>;
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

function createInitialContext(
  initialBudgetUsd: number | null
): BudgetSettingsContext {
  return {
    budgetInput: formatBudgetInput(initialBudgetUsd),
    isDirtyAfterSaveStarted: false,
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

export function readBudgetSaveStatus(
  state: SnapshotFrom<ReturnType<typeof createBudgetSettingsMachine>>
): SaveStatus {
  if (state.hasTag(BUDGET_SETTINGS_TAG.SAVING)) {
    return "saving";
  }
  if (state.hasTag(BUDGET_SETTINGS_TAG.SAVED)) {
    return "saved";
  }
  if (state.hasTag(BUDGET_SETTINGS_TAG.ERROR)) {
    return "error";
  }
  return "idle";
}

async function saveBudgetRequest(
  input: SaveBudgetRequestInput
): Promise<OrganizationSettings> {
  const result = await Result.tryPromise({
    try: () => input.saveBudget(input.nextBudgetUsd),
    catch: (cause: unknown) =>
      new BudgetSaveError({
        cause,
        message: input.errorMessage,
      }),
  });

  if (result.isErr()) {
    throw result.error;
  }

  return result.value;
}

const budgetSettingsMachine = setup({
  actions: {
    markSaveSettled: assign({
      isDirtyAfterSaveStarted: () => false,
    }),
    updateBudgetInput: assign({
      budgetInput: (_, params: { value: string }) => params.value,
    }),
    updateBudgetInputWhileSaving: assign({
      budgetInput: (_, params: { value: string }) => params.value,
      isDirtyAfterSaveStarted: () => true,
    }),
    clearBudgetInput: assign({
      budgetInput: () => "",
    }),
    markSaveStarted: assign({
      isDirtyAfterSaveStarted: () => false,
    }),
    storePersistedBudget: assign({
      budgetInput: ({ context }, params: { monthlyBudgetUsd: number | null }) =>
        context.isDirtyAfterSaveStarted
          ? context.budgetInput
          : formatBudgetInput(params.monthlyBudgetUsd),
      persistedBudgetUsd: (_, params: { monthlyBudgetUsd: number | null }) =>
        params.monthlyBudgetUsd,
    }),
    showSaveError: (
      _,
      params: {
        error: unknown;
      }
    ) => {
      toast.error(
        params.error instanceof BudgetSaveError
          ? params.error.message
          : DEFAULT_ERROR_MESSAGE
      );
    },
  },
  actors: {
    saveBudget: fromPromise<SaveBudgetActorOutput, SaveBudgetActorInput>(
      async ({ input }: { input: SaveBudgetActorInput }) =>
        Promise.resolve({
          monthlyBudgetUsd: input.nextBudgetUsd,
        })
    ),
  },
  delays: {
    errorIdle: ERROR_IDLE_DELAY_MS,
    savedIdle: SAVED_IDLE_DELAY_MS,
  },
  guards: {
    canSave: ({ context }) => canSaveBudget(context),
    canClear: ({ context }) => canClearBudget(context),
  },
  types: {} as BudgetSettingsTypes,
}).createMachine({
  context: ({ input }) => createInitialContext(input.initialBudgetUsd),
  id: "budgetSettings",
  initial: BUDGET_SETTINGS_STATE.EDITING,
  states: {
    [BUDGET_SETTINGS_STATE.EDITING]: {
      tags: [BUDGET_SETTINGS_TAG.EDITABLE],
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
          actions: "markSaveStarted",
          target: BUDGET_SETTINGS_STATE.SAVING,
        },
        [BUDGET_SETTINGS_EVENT.CLEAR]: {
          guard: "canClear",
          actions: ["clearBudgetInput", "markSaveStarted"],
          target: BUDGET_SETTINGS_STATE.SAVING,
        },
      },
    },
    [BUDGET_SETTINGS_STATE.SAVING]: {
      tags: [BUDGET_SETTINGS_TAG.SAVING],
      invoke: {
        src: "saveBudget",
        input: ({ context, event }) => {
          assertEvent(event, [
            BUDGET_SETTINGS_EVENT.CLEAR,
            BUDGET_SETTINGS_EVENT.SAVE,
          ]);

          return {
            nextBudgetUsd:
              event.type === BUDGET_SETTINGS_EVENT.CLEAR
                ? null
                : getPendingBudgetUsd(context),
          };
        },
        onDone: {
          actions: [
            {
              type: "storePersistedBudget",
              params: ({ event }) => ({
                monthlyBudgetUsd: event.output.monthlyBudgetUsd,
              }),
            },
            "markSaveSettled",
          ],
          target: BUDGET_SETTINGS_STATE.SAVED,
        },
        onError: {
          actions: [
            {
              type: "showSaveError",
              params: ({ event }) => ({
                error: event.error,
              }),
            },
            "markSaveSettled",
          ],
          target: BUDGET_SETTINGS_STATE.ERROR,
        },
      },
      on: {
        [BUDGET_SETTINGS_EVENT.INPUT_CHANGED]: {
          actions: {
            type: "updateBudgetInputWhileSaving",
            params: ({ event }) => ({
              value: event.value,
            }),
          },
        },
      },
    },
    [BUDGET_SETTINGS_STATE.SAVED]: {
      tags: [BUDGET_SETTINGS_TAG.EDITABLE, BUDGET_SETTINGS_TAG.SAVED],
      after: {
        savedIdle: BUDGET_SETTINGS_STATE.EDITING,
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
          actions: "markSaveStarted",
          target: BUDGET_SETTINGS_STATE.SAVING,
        },
        [BUDGET_SETTINGS_EVENT.CLEAR]: {
          guard: "canClear",
          actions: ["clearBudgetInput", "markSaveStarted"],
          target: BUDGET_SETTINGS_STATE.SAVING,
        },
      },
    },
    [BUDGET_SETTINGS_STATE.ERROR]: {
      tags: [BUDGET_SETTINGS_TAG.EDITABLE, BUDGET_SETTINGS_TAG.ERROR],
      after: {
        errorIdle: BUDGET_SETTINGS_STATE.EDITING,
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
          actions: "markSaveStarted",
          target: BUDGET_SETTINGS_STATE.SAVING,
        },
        [BUDGET_SETTINGS_EVENT.CLEAR]: {
          guard: "canClear",
          actions: ["clearBudgetInput", "markSaveStarted"],
          target: BUDGET_SETTINGS_STATE.SAVING,
        },
      },
    },
  },
});
export function createBudgetSettingsMachine(
  options: BudgetSettingsMachineOptions = {}
) {
  return budgetSettingsMachine.provide({
    delays: {
      errorIdle: options.errorIdleDelayMs ?? ERROR_IDLE_DELAY_MS,
      savedIdle: options.savedIdleDelayMs ?? SAVED_IDLE_DELAY_MS,
    },
  });
}

export function useBudgetSettingsController(
  input: UseBudgetSettingsControllerInput
): BudgetSettingsController {
  const errorMessage = input.errorMessage ?? DEFAULT_ERROR_MESSAGE;
  const [state, send] = useActor(
    budgetSettingsMachine.provide({
      actions: {
        showSaveError: (
          _,
          params: {
            error: unknown;
          }
        ) => {
          toast.error(
            params.error instanceof BudgetSaveError
              ? params.error.message
              : errorMessage
          );
        },
      },
      actors: {
        saveBudget: fromPromise(
          async ({ input: saveInput }: { input: SaveBudgetActorInput }) =>
            saveBudgetRequest({
              errorMessage,
              nextBudgetUsd: saveInput.nextBudgetUsd,
              saveBudget: input.saveBudget,
            })
        ),
      },
    }),
    {
      input: {
        initialBudgetUsd: input.monthlyBudgetUsd,
      },
    }
  );

  const saveEvent = { type: BUDGET_SETTINGS_EVENT.SAVE } as const;
  const clearEvent = { type: BUDGET_SETTINGS_EVENT.CLEAR } as const;
  const parsedBudgetInput = parseBudgetInput(state.context.budgetInput);
  const isSavePending = state.hasTag(BUDGET_SETTINGS_TAG.SAVING);

  return {
    budgetInput: state.context.budgetInput,
    clear: () => {
      send(clearEvent);
    },
    hasBudgetConfigured: state.context.persistedBudgetUsd !== null,
    isBudgetInputInvalid: parsedBudgetInput === "invalid",
    isSaveDisabled: !state.can(saveEvent),
    isSavePending,
    save: () => {
      send(saveEvent);
    },
    saveStatus: readBudgetSaveStatus(state),
    setBudgetInput: (value: string) => {
      send({
        type: BUDGET_SETTINGS_EVENT.INPUT_CHANGED,
        value,
      });
    },
  };
}
