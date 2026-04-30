import { useActor } from "@xstate/react";
import { useCallback } from "react";
import { assign, setup } from "xstate";

import { serializeOrganizationRoleNames } from "@/lib/organization-role-access";
import type { OrganizationRoleName } from "@/lib/organization-role-access";

export const assignableTeamRoleNames = ["admin", "member"] as const;

export type AssignableTeamRoleName = (typeof assignableTeamRoleNames)[number];

export const assignableTeamRoleOptions = [
  { label: "Admin", value: "admin" },
  { label: "Member", value: "member" },
] as const satisfies readonly {
  label: string;
  value: AssignableTeamRoleName;
}[];

export const defaultAssignableTeamRoleNames = [
  "member",
] as const satisfies readonly AssignableTeamRoleName[];

const TEAM_ROLE_SELECTION_EVENT = {
  RESET: "teamRoleSelection/reset",
  SOURCE_ROLE_NAMES_SYNCED: "teamRoleSelection/sourceRoleNamesSynced",
  TOGGLE_ROLE: "teamRoleSelection/toggleRole",
} as const;

const TEAM_ROLE_SELECTION_STATE = {
  CLEAN: "clean",
  DIRTY: "dirty",
  EVALUATING: "evaluating",
} as const;

const TEAM_ROLE_SELECTION_TAG = {
  DIRTY: "dirty",
} as const;

type TeamRoleSelectionContext = {
  selectedRoleNames: AssignableTeamRoleName[];
  sourceRoleNames: AssignableTeamRoleName[];
};

type TeamRoleSelectionEvent =
  | { type: typeof TEAM_ROLE_SELECTION_EVENT.RESET }
  | {
      type: typeof TEAM_ROLE_SELECTION_EVENT.SOURCE_ROLE_NAMES_SYNCED;
      roleNames: readonly AssignableTeamRoleName[];
    }
  | {
      type: typeof TEAM_ROLE_SELECTION_EVENT.TOGGLE_ROLE;
      roleName: AssignableTeamRoleName;
    };

type TeamRoleSelectionMachineInput = {
  initialRoleNames: readonly AssignableTeamRoleName[];
};

type TeamRoleSelectionTypes = {
  context: TeamRoleSelectionContext;
  events: TeamRoleSelectionEvent;
  input: TeamRoleSelectionMachineInput;
};

type TeamRoleSelectionController = {
  hasChanges: boolean;
  isSelectionEmpty: boolean;
  reset: () => void;
  resetToRoleNames: (roleNames: readonly AssignableTeamRoleName[]) => void;
  selectedRoleNames: AssignableTeamRoleName[];
  toggleRole: (roleName: AssignableTeamRoleName) => void;
};

export function resolveAssignableTeamRoleNames(
  roleNames: readonly OrganizationRoleName[]
): AssignableTeamRoleName[] {
  const normalizedRoleNameSet = new Set<AssignableTeamRoleName>();

  for (const roleName of roleNames) {
    if (roleName === "admin" || roleName === "member") {
      normalizedRoleNameSet.add(roleName);
    }
  }

  return assignableTeamRoleNames.filter((roleName) =>
    normalizedRoleNameSet.has(roleName)
  );
}

function createTeamRoleSelectionContext(
  roleNames: readonly OrganizationRoleName[]
): TeamRoleSelectionContext {
  const initialRoleNames = resolveAssignableTeamRoleNames(roleNames);

  return {
    selectedRoleNames: [...initialRoleNames],
    sourceRoleNames: [...initialRoleNames],
  };
}

export const teamRoleSelectionMachine = setup({
  actions: {
    resetSelectedRoleNames: assign({
      selectedRoleNames: ({ context }) => [...context.sourceRoleNames],
    }),
    syncSourceRoleNames: assign({
      selectedRoleNames: (
        _,
        params: { roleNames: readonly AssignableTeamRoleName[] }
      ) => [...params.roleNames],
      sourceRoleNames: (
        _,
        params: { roleNames: readonly AssignableTeamRoleName[] }
      ) => [...params.roleNames],
    }),
    toggleRoleName: assign({
      selectedRoleNames: (
        { context },
        params: { roleName: AssignableTeamRoleName }
      ) => {
        const nextSelectedRoleNames = new Set(context.selectedRoleNames);

        if (nextSelectedRoleNames.has(params.roleName)) {
          nextSelectedRoleNames.delete(params.roleName);
        } else {
          nextSelectedRoleNames.add(params.roleName);
        }

        return assignableTeamRoleNames.filter((roleName) =>
          nextSelectedRoleNames.has(roleName)
        );
      },
    }),
  },
  guards: {
    hasRoleSelectionChanges: ({ context }) =>
      serializeOrganizationRoleNames(context.selectedRoleNames) !==
      serializeOrganizationRoleNames(context.sourceRoleNames),
  },
  types: {} as TeamRoleSelectionTypes,
}).createMachine({
  context: ({ input }) =>
    createTeamRoleSelectionContext(input.initialRoleNames),
  id: "teamRoleSelection",
  initial: TEAM_ROLE_SELECTION_STATE.EVALUATING,
  on: {
    [TEAM_ROLE_SELECTION_EVENT.RESET]: {
      actions: "resetSelectedRoleNames",
      target: `.${TEAM_ROLE_SELECTION_STATE.EVALUATING}`,
    },
    [TEAM_ROLE_SELECTION_EVENT.SOURCE_ROLE_NAMES_SYNCED]: {
      actions: {
        type: "syncSourceRoleNames",
        params: ({ event }) => ({
          roleNames: resolveAssignableTeamRoleNames(event.roleNames),
        }),
      },
      target: `.${TEAM_ROLE_SELECTION_STATE.EVALUATING}`,
    },
    [TEAM_ROLE_SELECTION_EVENT.TOGGLE_ROLE]: {
      actions: {
        type: "toggleRoleName",
        params: ({ event }) => ({
          roleName: event.roleName,
        }),
      },
      target: `.${TEAM_ROLE_SELECTION_STATE.EVALUATING}`,
    },
  },
  states: {
    [TEAM_ROLE_SELECTION_STATE.EVALUATING]: {
      always: [
        {
          guard: "hasRoleSelectionChanges",
          target: TEAM_ROLE_SELECTION_STATE.DIRTY,
        },
        {
          target: TEAM_ROLE_SELECTION_STATE.CLEAN,
        },
      ],
    },
    [TEAM_ROLE_SELECTION_STATE.CLEAN]: {},
    [TEAM_ROLE_SELECTION_STATE.DIRTY]: {
      tags: TEAM_ROLE_SELECTION_TAG.DIRTY,
    },
  },
});

export function useTeamRoleSelectionController(input: {
  initialRoleNames: readonly AssignableTeamRoleName[];
}): TeamRoleSelectionController {
  const [state, send] = useActor(teamRoleSelectionMachine, {
    input: {
      initialRoleNames: resolveAssignableTeamRoleNames(input.initialRoleNames),
    },
  });

  return {
    hasChanges: state.hasTag(TEAM_ROLE_SELECTION_TAG.DIRTY),
    isSelectionEmpty: state.context.selectedRoleNames.length === 0,
    reset: useCallback(() => {
      send({ type: TEAM_ROLE_SELECTION_EVENT.RESET });
    }, [send]),
    resetToRoleNames: useCallback(
      (roleNames: readonly AssignableTeamRoleName[]) => {
        send({
          type: TEAM_ROLE_SELECTION_EVENT.SOURCE_ROLE_NAMES_SYNCED,
          roleNames,
        });
      },
      [send]
    ),
    selectedRoleNames: state.context.selectedRoleNames,
    toggleRole: useCallback(
      (roleName: AssignableTeamRoleName) => {
        send({
          type: TEAM_ROLE_SELECTION_EVENT.TOGGLE_ROLE,
          roleName,
        });
      },
      [send]
    ),
  };
}
