export const HERO_PRODUCT_TAB_ORDER = [
  "integrations",
  "query",
  "audit",
] as const;

export type HeroProductTab = (typeof HERO_PRODUCT_TAB_ORDER)[number];
export type SafeQueryCheckId =
  | "nonDestructive"
  | "budgetLimit"
  | "accessPermission";
export type SafeQueryCheckStatus = "pending" | "success" | "failure";
export type SafeQueryResult = "pending" | "pass" | "blocked";

export type SafeQueryAnimationAction =
  | { type: "advance" }
  | { type: "restart" };

export type SafeQueryAnimationState = {
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

export type HeroProductAction =
  | { type: "advanceTab" }
  | { type: "selectTab"; tab: HeroProductTab };

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
  { id: "integrations", label: "Integrations" },
  { id: "query", label: "Safe query" },
  { id: "audit", label: "Audit log" },
] satisfies ReadonlyArray<{ id: HeroProductTab; label: string }>;

export const heroProductTabMeta = {
  audit: { tag: "latest", title: "Audit log" },
  integrations: { tag: "multi-source", title: "Multiple integrations" },
  query: { tag: "read-only", title: "Safe querying" },
} satisfies Record<HeroProductTab, { tag: string; title: string }>;

export const heroProductIntegrationRows = [
  { provider: "postgres", source: "warehouse", status: "ready" },
  { provider: "github", source: "product-gh", status: "ready" },
  { provider: "bigquery", source: "spend", status: "pending" },
  { provider: "mongodb", source: "events", status: "ready" },
] satisfies ReadonlyArray<HeroProductIntegrationRow>;

export const heroProductAuditEntries = [
  {
    detail: "842 ms · succeeded",
    text: "owner@acme.dev executed query on warehouse",
  },
  {
    detail: "pending provider refresh",
    text: "ops@acme.dev reviewed bigquery budget window",
  },
  {
    detail: "retry available",
    text: "agent@acme.dev retry queued for athena-prod",
  },
] satisfies ReadonlyArray<HeroProductAuditEntry>;

export const heroSafeQueryChecks = [
  { id: "nonDestructive", label: "Non-destructive" },
  { id: "budgetLimit", label: "budget limit" },
  { id: "accessPermission", label: "access permission" },
] satisfies ReadonlyArray<{ id: SafeQueryCheckId; label: string }>;

const heroSafeQueryScenarios = [
  { result: "pass" },
  { failingStepId: "budgetLimit", result: "blocked" },
] satisfies ReadonlyArray<SafeQueryScenario>;

const SAFE_QUERY_INITIAL_DELAY_MS = 360;
const SAFE_QUERY_STEP_DELAY_MS = 520;
const SAFE_QUERY_RESULT_HOLD_MS = 900;
const SAFE_QUERY_FULL_CYCLE_MS =
  SAFE_QUERY_INITIAL_DELAY_MS +
  heroSafeQueryChecks.length * SAFE_QUERY_STEP_DELAY_MS +
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

export const initialHeroProductTab = HERO_PRODUCT_TAB_ORDER[0];

export const initialSafeQueryAnimationState: SafeQueryAnimationState = {
  cycleIndex: 0,
  result: "pending",
  statuses: createSafeQueryStatuses(),
};

export function heroProductReducer(
  state: HeroProductTab,
  action: HeroProductAction
): HeroProductTab {
  switch (action.type) {
    case "advanceTab": {
      const currentIndex = HERO_PRODUCT_TAB_ORDER.indexOf(state);
      const nextIndex = (currentIndex + 1) % HERO_PRODUCT_TAB_ORDER.length;
      return HERO_PRODUCT_TAB_ORDER[nextIndex] ?? initialHeroProductTab;
    }

    case "selectTab":
      return action.tab;

    default:
      return state;
  }
}

export function safeQueryAnimationReducer(
  state: SafeQueryAnimationState,
  action: SafeQueryAnimationAction
): SafeQueryAnimationState {
  switch (action.type) {
    case "advance": {
      if (state.result !== "pending") {
        return state;
      }

      const scenario =
        heroSafeQueryScenarios[
          state.cycleIndex % heroSafeQueryScenarios.length
        ];

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

    case "restart":
      return {
        cycleIndex: state.cycleIndex + 1,
        result: "pending",
        statuses: createSafeQueryStatuses(),
      };

    default:
      return state;
  }
}

export function getSafeQueryAnimationDelay(
  state: SafeQueryAnimationState
): number {
  if (
    state.result === "pending" &&
    heroSafeQueryChecks.every((check) => state.statuses[check.id] === "pending")
  ) {
    return SAFE_QUERY_INITIAL_DELAY_MS;
  }

  if (state.result === "pending") {
    return SAFE_QUERY_STEP_DELAY_MS;
  }

  return SAFE_QUERY_RESULT_HOLD_MS;
}
