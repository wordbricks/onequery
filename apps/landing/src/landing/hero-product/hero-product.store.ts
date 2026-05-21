import { atom, onMount } from "nanostores";

export const HERO_PRODUCT_TAB_ORDER = [
  "integrations",
  "query",
  "audit",
] as const;

export type HeroProductTab = (typeof HERO_PRODUCT_TAB_ORDER)[number];
type SafeQueryCheckId = "nonDestructive" | "budgetLimit" | "accessPermission";
type SafeQueryCheckStatus = "pending" | "success" | "failure";
type SafeQueryResult = "pending" | "pass" | "blocked";

export type SafeQueryAnimationState = {
  cycleIndex: number;
  result: SafeQueryResult;
  statuses: Record<SafeQueryCheckId, SafeQueryCheckStatus>;
};

export type HeroProductState = {
  activeTab: HeroProductTab;
  safeQuery: SafeQueryAnimationState;
};

type SafeQueryScenario =
  | { result: "pass"; failingStepId?: undefined }
  | {
      result: "blocked";
      failingStepId: SafeQueryCheckId;
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

function createInitialHeroProductState(): HeroProductState {
  return {
    activeTab: "integrations",
    safeQuery: createInitialSafeQueryState(),
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

function restartSafeQuery(state: SafeQueryAnimationState) {
  return {
    cycleIndex: state.cycleIndex + 1,
    result: "pending" as const,
    statuses: createSafeQueryStatuses(),
  };
}

function getNextHeroProductTab(tab: HeroProductTab): HeroProductTab {
  const tabIndex = HERO_PRODUCT_TAB_ORDER.indexOf(tab);
  return (
    HERO_PRODUCT_TAB_ORDER[(tabIndex + 1) % HERO_PRODUCT_TAB_ORDER.length] ??
    "integrations"
  );
}

function getSafeQueryDelay(state: SafeQueryAnimationState) {
  if (state.result !== "pending") {
    return SAFE_QUERY_RESULT_HOLD_MS;
  }

  const hasStarted = heroSafeQueryChecks.some(
    (check) => state.statuses[check.id] !== "pending"
  );

  return hasStarted ? SAFE_QUERY_STEP_DELAY_MS : SAFE_QUERY_INITIAL_DELAY_MS;
}

export function createHeroProductStore() {
  const $heroProductState = atom<HeroProductState>(
    createInitialHeroProductState()
  );
  let isMounted = false;
  let safeQueryTimeout: ReturnType<typeof setTimeout> | undefined;
  let tabTimeout: ReturnType<typeof setTimeout> | undefined;

  function clearSafeQueryTimeout() {
    if (safeQueryTimeout !== undefined) {
      clearTimeout(safeQueryTimeout);
      safeQueryTimeout = undefined;
    }
  }

  function clearTabTimeout() {
    if (tabTimeout !== undefined) {
      clearTimeout(tabTimeout);
      tabTimeout = undefined;
    }
  }

  function scheduleSafeQuery() {
    clearSafeQueryTimeout();

    if (!isMounted) {
      return;
    }

    const state = $heroProductState.get();
    if (state.activeTab !== "query") {
      return;
    }

    safeQueryTimeout = setTimeout(() => {
      const current = $heroProductState.get();

      if (current.activeTab !== "query") {
        return;
      }

      $heroProductState.set({
        ...current,
        safeQuery:
          current.safeQuery.result === "pending"
            ? advanceSafeQuery(current.safeQuery)
            : restartSafeQuery(current.safeQuery),
      });
      scheduleSafeQuery();
    }, getSafeQueryDelay(state.safeQuery));
  }

  function scheduleActiveTab() {
    clearTabTimeout();

    if (!isMounted) {
      return;
    }

    const { activeTab } = $heroProductState.get();
    tabTimeout = setTimeout(() => {
      setActiveTab(getNextHeroProductTab(activeTab));
    }, HERO_TAB_DWELL_MS[activeTab]);
  }

  function syncTimersForActiveTab() {
    scheduleActiveTab();

    if ($heroProductState.get().activeTab === "query") {
      scheduleSafeQuery();
      return;
    }

    clearSafeQueryTimeout();
  }

  function setActiveTab(tab: HeroProductTab) {
    const current = $heroProductState.get();

    if (current.activeTab === tab) {
      return;
    }

    $heroProductState.set({
      activeTab: tab,
      safeQuery:
        tab === "query" ? createInitialSafeQueryState() : current.safeQuery,
    });
    syncTimersForActiveTab();
  }

  onMount($heroProductState, () => {
    isMounted = true;
    syncTimersForActiveTab();

    return () => {
      isMounted = false;
      clearSafeQueryTimeout();
      clearTabTimeout();
    };
  });

  return {
    $heroProductState,
    selectTab: setActiveTab,
  };
}

export function readActiveHeroProductTab(
  state: HeroProductState
): HeroProductTab {
  return state.activeTab;
}

export function readSafeQueryAnimationState(
  state: HeroProductState
): SafeQueryAnimationState {
  return state.safeQuery;
}
