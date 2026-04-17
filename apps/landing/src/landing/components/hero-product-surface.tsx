import { useEffect, useReducer } from "react";

const HERO_PRODUCT_TAB_ORDER = ["integrations", "query", "audit"] as const;

type HeroProductTab = (typeof HERO_PRODUCT_TAB_ORDER)[number];
type SafeQueryCheckId = "nonDestructive" | "budgetLimit" | "accessPermission";
type SafeQueryCheckStatus = "pending" | "success" | "failure";
type SafeQueryResult = "pending" | "pass" | "blocked";

type SafeQueryAnimationAction = { type: "advance" } | { type: "restart" };

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

type HeroProductAction =
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

const heroProductTabs = [
  { id: "integrations", label: "Integrations" },
  { id: "query", label: "Safe query" },
  { id: "audit", label: "Audit log" },
] satisfies ReadonlyArray<{ id: HeroProductTab; label: string }>;

const heroProductTabMeta = {
  audit: { tag: "latest", title: "Audit log" },
  integrations: { tag: "multi-source", title: "Multiple integrations" },
  query: { tag: "read-only", title: "Safe querying" },
} satisfies Record<HeroProductTab, { tag: string; title: string }>;

const heroProductIntegrationRows = [
  { provider: "postgres", source: "warehouse", status: "ready" },
  { provider: "github", source: "product-gh", status: "ready" },
  { provider: "bigquery", source: "spend", status: "pending" },
  { provider: "mongodb", source: "events", status: "ready" },
] satisfies ReadonlyArray<HeroProductIntegrationRow>;

const heroProductAuditEntries = [
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

const heroSafeQueryChecks = [
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

const HERO_TAB_DWELL_MS = {
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

const initialSafeQueryAnimationState: SafeQueryAnimationState = {
  cycleIndex: 0,
  result: "pending",
  statuses: createSafeQueryStatuses(),
};

function heroProductReducer(
  state: HeroProductTab,
  action: HeroProductAction
): HeroProductTab {
  switch (action.type) {
    case "advanceTab": {
      const currentIndex = HERO_PRODUCT_TAB_ORDER.indexOf(state);
      const nextIndex = (currentIndex + 1) % HERO_PRODUCT_TAB_ORDER.length;
      return HERO_PRODUCT_TAB_ORDER[nextIndex] ?? HERO_PRODUCT_TAB_ORDER[0];
    }

    case "selectTab":
      return action.tab;

    default:
      return state;
  }
}

function safeQueryAnimationReducer(
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

function SafeQueryPanel() {
  const [state, dispatch] = useReducer(
    safeQueryAnimationReducer,
    initialSafeQueryAnimationState
  );

  // Safe-query feedback loops through explicit reducer transitions so the
  // mock stays deterministic across pass and blocked scenarios.
  useEffect(() => {
    const timeoutId = window.setTimeout(
      () => {
        if (state.result === "pending") {
          dispatch({ type: "advance" });
          return;
        }

        dispatch({ type: "restart" });
      },
      state.result === "pending" &&
        heroSafeQueryChecks.every(
          (check) => state.statuses[check.id] === "pending"
        )
        ? SAFE_QUERY_INITIAL_DELAY_MS
        : state.result === "pending"
          ? SAFE_QUERY_STEP_DELAY_MS
          : SAFE_QUERY_RESULT_HOLD_MS
    );

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [state]);

  return (
    <div
      className="hero-safe-query"
      data-result={state.result}
      aria-label="Safe querying checks"
    >
      <div className="hero-safe-query-preview">
        <span className="hero-safe-query-preview-line hero-safe-query-preview-line-primary">
          query
        </span>
        <span className="hero-safe-query-preview-line">content</span>
        <span className="hero-safe-query-preview-line">content</span>
      </div>

      <div className="hero-safe-query-sidebar">
        <div className="hero-safe-query-checklist" aria-live="polite">
          {heroSafeQueryChecks.map((check) => {
            const status = state.statuses[check.id];
            const indicator =
              status === "success" ? "✓" : status === "failure" ? "×" : "";

            return (
              <div
                key={check.id}
                className="hero-safe-query-check"
                data-status={status}
              >
                <span className="hero-safe-query-check-box" aria-hidden="true">
                  {indicator}
                </span>
                <span>{check.label}</span>
              </div>
            );
          })}
        </div>

        <div className="hero-safe-query-result-wrap">
          <div className="hero-safe-query-result" data-result={state.result}>
            {state.result === "blocked"
              ? "BLOCKED"
              : state.result === "pass"
                ? "PASS"
                : "CHECKING"}
          </div>
        </div>
      </div>
    </div>
  );
}

function renderHeroProductPanel(activeTab: HeroProductTab) {
  switch (activeTab) {
    case "integrations":
      return (
        <div className="hero-product-list">
          {heroProductIntegrationRows.map((row) => (
            <div key={row.source} className="hero-product-row">
              <span>{row.source}</span>
              <span>{row.provider}</span>
              <span>{row.status}</span>
            </div>
          ))}
        </div>
      );

    case "query":
      return <SafeQueryPanel />;

    case "audit":
      return (
        <div className="hero-product-audit">
          {heroProductAuditEntries.map((entry) => (
            <div key={entry.text} className="hero-product-audit-item">
              <span className="hero-product-audit-dot" aria-hidden="true" />
              <div>
                <p>{entry.text}</p>
                <span>{entry.detail}</span>
              </div>
            </div>
          ))}
        </div>
      );
  }
}

export function HeroProductSurface() {
  const [activeTab, dispatch] = useReducer(
    heroProductReducer,
    HERO_PRODUCT_TAB_ORDER[0]
  );

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      dispatch({ type: "advanceTab" });
    }, HERO_TAB_DWELL_MS[activeTab]);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [activeTab]);

  const activeTabMeta = heroProductTabMeta[activeTab];

  return (
    <div
      className="hero-product-surface"
      aria-label="OneQuery product overview"
    >
      <aside className="hero-product-sidebar">
        <div className="hero-product-brand">
          <span className="hero-product-brand-mark" aria-hidden="true" />
          <div>
            <p>OneQuery</p>
            <span>acme-org</span>
          </div>
        </div>

        <div className="hero-product-nav">
          {heroProductTabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={
                tab.id === activeTab
                  ? "hero-product-nav-button hero-product-nav-active"
                  : "hero-product-nav-button"
              }
              onClick={() => dispatch({ type: "selectTab", tab: tab.id })}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="hero-product-sidebar-footer">gateway running</div>
      </aside>

      <div className="hero-product-main">
        <div className="hero-product-header">
          <div>
            <h3>Welcome to OneQuery</h3>
            <p>
              Connect sources, run safe queries, and review organization
              history.
            </p>
          </div>
          <div className="hero-product-header-meta">
            <span>12 sources</span>
            <span>budget healthy</span>
          </div>
        </div>

        <section className="hero-product-focus">
          <div className="hero-product-section-header">
            <h4>{activeTabMeta.title}</h4>
            <span>{activeTabMeta.tag}</span>
          </div>
          <div className="hero-product-panel-body">
            <div
              key={activeTab}
              className="hero-product-panel"
              data-tab={activeTab}
            >
              {renderHeroProductPanel(activeTab)}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
