import { assign, setup } from "xstate";
import type { SnapshotFrom } from "xstate";

export const HERO_PRODUCT_TAB_ORDER = [
  "integrations",
  "query",
  "audit",
] as const;

export type HeroProductTab = (typeof HERO_PRODUCT_TAB_ORDER)[number];
type SafeQueryCheckId = "nonDestructive" | "budgetLimit" | "accessPermission";
type SafeQueryCheckStatus = "pending" | "success" | "failure";
type SafeQueryResult = "pending" | "pass" | "blocked";

type SafeQueryAnimationState = {
  cycleIndex: number;
  result: SafeQueryResult;
  statuses: Record<SafeQueryCheckId, SafeQueryCheckStatus>;
};

type SafeQueryScenario =
  | { result: "pass"; failingStepId?: undefined }
  | {
      result: "blocked";
      failingStepId: SafeQueryCheckId;
    };

type HeroProductContext = {
  safeQuery: SafeQueryAnimationState;
};

type HeroProductEvent = {
  type: "heroProduct/tabSelected";
  tab: HeroProductTab;
};

type HeroProductAuditEntry = {
  detail: string;
  text: string;
};

type HeroProductIntegrationRow = {
  provider: string;
  source: string;
  status: string;
};

export const heroProductTabs = [
  { id: "integrations", label: "Grant" },
  { id: "query", label: "Policy check" },
  { id: "audit", label: "Audit log" },
] satisfies ReadonlyArray<{ id: HeroProductTab; label: string }>;

export const heroProductTabMeta = {
  audit: { tag: "latest", title: "Audit log" },
  integrations: { tag: "prod-debug-readonly", title: "Capability grant" },
  query: { tag: "enforced", title: "Policy check" },
} satisfies Record<HeroProductTab, { tag: string; title: string }>;

export const heroProductIntegrationRows = [
  { provider: "read", source: "sentry.errors", status: "granted" },
  { provider: "read-only", source: "orders-postgres-db", status: "limited" },
  { provider: "read/write", source: "github.repo/pr", status: "granted" },
  { provider: "write", source: "linear.issue", status: "granted" },
] satisfies ReadonlyArray<HeroProductIntegrationRow>;

export const heroProductAuditEntries = [
  {
    detail: "ok",
    text: "read sentry ISSUE-7421",
  },
  {
    detail: "31 rows | 10s",
    text: "query postgres orders",
  },
  {
    detail: "allowed",
    text: "open PR + issue",
  },
] satisfies ReadonlyArray<HeroProductAuditEntry>;

export const heroSafeQueryChecks = [
  { id: "nonDestructive", label: "no prod writes" },
  { id: "budgetLimit", label: "row/time limits" },
  { id: "accessPermission", label: "grant scope" },
] satisfies ReadonlyArray<{ id: SafeQueryCheckId; label: string }>;

const heroSafeQueryScenarios = [
  { result: "pass" },
  { failingStepId: "budgetLimit", result: "blocked" },
] satisfies ReadonlyArray<SafeQueryScenario>;

export const SAFE_QUERY_INITIAL_DELAY_MS = 360;
export const SAFE_QUERY_STEP_DELAY_MS = 520;
export const SAFE_QUERY_RESULT_HOLD_MS = 900;
// Comment: the initial dwell already covers the first checklist transition, so
// only the remaining checks contribute step delays to a full cycle.
const SAFE_QUERY_FULL_CYCLE_MS =
  SAFE_QUERY_INITIAL_DELAY_MS +
  (heroSafeQueryChecks.length - 1) * SAFE_QUERY_STEP_DELAY_MS +
  SAFE_QUERY_RESULT_HOLD_MS;
const SAFE_QUERY_TAB_MIN_DWELL_MS = 6500;

export const HERO_TAB_DWELL_MS = {
  audit: 5000,
  integrations: 5000,
  // Keep the hero on safe query long enough to show the full checklist pass.
  query: Math.max(SAFE_QUERY_TAB_MIN_DWELL_MS, SAFE_QUERY_FULL_CYCLE_MS + 1800),
} satisfies Record<HeroProductTab, number>;

function createSafeQueryStatuses(): Record<
  SafeQueryCheckId,
  SafeQueryCheckStatus
> {
  return {
    accessPermission: "pending",
    budgetLimit: "pending",
    nonDestructive: "pending",
  };
}

function createInitialSafeQueryState(): SafeQueryAnimationState {
  return {
    cycleIndex: 0,
    result: "pending",
    statuses: createSafeQueryStatuses(),
  };
}

function advanceSafeQuery(
  state: SafeQueryAnimationState
): SafeQueryAnimationState {
  if (state.result !== "pending") {
    return state;
  }

  const scenario =
    heroSafeQueryScenarios[state.cycleIndex % heroSafeQueryScenarios.length];

  if (scenario === undefined) {
    return state;
  }

  const nextCheck = heroSafeQueryChecks.find(
    (check) => state.statuses[check.id] === "pending"
  );

  if (nextCheck === undefined) {
    return state;
  }

  const nextStatus =
    scenario.result === "blocked" && scenario.failingStepId === nextCheck.id
      ? "failure"
      : "success";
  const nextStatuses = {
    ...state.statuses,
    [nextCheck.id]: nextStatus,
  };

  if (nextStatus === "failure") {
    return {
      ...state,
      result: "blocked",
      statuses: nextStatuses,
    };
  }

  const hasPendingChecks = heroSafeQueryChecks.some(
    (check) => nextStatuses[check.id] === "pending"
  );

  return {
    ...state,
    result: hasPendingChecks ? "pending" : "pass",
    statuses: nextStatuses,
  };
}

export const heroProductMachine = setup({
  types: {
    context: {} as HeroProductContext,
    events: {} as HeroProductEvent,
  },
  actions: {
    advanceSafeQuery: assign(({ context }) => ({
      safeQuery: advanceSafeQuery(context.safeQuery),
    })),
    resetSafeQuery: assign({
      safeQuery: () => createInitialSafeQueryState(),
    }),
    restartSafeQuery: assign(({ context }) => ({
      safeQuery: {
        cycleIndex: context.safeQuery.cycleIndex + 1,
        result: "pending" as const,
        statuses: createSafeQueryStatuses(),
      },
    })),
  },
  delays: {
    auditDwell: HERO_TAB_DWELL_MS.audit,
    integrationsDwell: HERO_TAB_DWELL_MS.integrations,
    queryDwell: HERO_TAB_DWELL_MS.query,
    safeQueryInitialDelay: SAFE_QUERY_INITIAL_DELAY_MS,
    safeQueryResultHold: SAFE_QUERY_RESULT_HOLD_MS,
    safeQueryStepDelay: SAFE_QUERY_STEP_DELAY_MS,
  },
  guards: {
    selectedAuditTab: ({ event }) => event.tab === "audit",
    selectedIntegrationsTab: ({ event }) => event.tab === "integrations",
    selectedQueryTab: ({ event }) => event.tab === "query",
    safeQueryBlocked: ({ context }) => context.safeQuery.result === "blocked",
    safeQueryPassed: ({ context }) => context.safeQuery.result === "pass",
  },
}).createMachine({
  id: "heroProduct",
  initial: "integrations",
  context: () => ({
    safeQuery: createInitialSafeQueryState(),
  }),
  on: {
    "heroProduct/tabSelected": [
      {
        guard: "selectedIntegrationsTab",
        target: ".integrations",
      },
      {
        guard: "selectedQueryTab",
        target: ".query",
      },
      {
        guard: "selectedAuditTab",
        target: ".audit",
      },
    ],
  },
  states: {
    integrations: {
      after: {
        integrationsDwell: "query",
      },
    },
    query: {
      entry: "resetSafeQuery",
      initial: "initialDelay",
      after: {
        queryDwell: "#heroProduct.audit",
      },
      states: {
        initialDelay: {
          after: {
            safeQueryInitialDelay: "advancing",
          },
        },
        advancing: {
          entry: "advanceSafeQuery",
          always: [
            {
              guard: "safeQueryBlocked",
              target: "blocked",
            },
            {
              guard: "safeQueryPassed",
              target: "passed",
            },
            {
              target: "waitingForNextCheck",
            },
          ],
        },
        waitingForNextCheck: {
          after: {
            safeQueryStepDelay: "advancing",
          },
        },
        passed: {
          after: {
            safeQueryResultHold: {
              actions: "restartSafeQuery",
              target: "initialDelay",
            },
          },
        },
        blocked: {
          after: {
            safeQueryResultHold: {
              actions: "restartSafeQuery",
              target: "initialDelay",
            },
          },
        },
      },
    },
    audit: {
      after: {
        auditDwell: "integrations",
      },
    },
  },
});

export function readActiveHeroProductTab(
  snapshot: SnapshotFrom<typeof heroProductMachine>
): HeroProductTab {
  if (snapshot.matches("integrations")) {
    return "integrations";
  }

  if (snapshot.matches("query")) {
    return "query";
  }

  return "audit";
}

export function readSafeQueryAnimationState(
  snapshot: SnapshotFrom<typeof heroProductMachine>
): SafeQueryAnimationState {
  return snapshot.context.safeQuery;
}
