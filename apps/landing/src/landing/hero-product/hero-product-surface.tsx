import { useMountEffect } from "@onequery/ui/hooks/use-mount-effect";
import {
  ViewTransition,
  startTransition,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";

import { useTextSwapController } from "../transitions/use-text-swap-controller";
import type { TextSwapController } from "../transitions/use-text-swap-controller";
import { useTransitionedStoreState } from "../transitions/use-transitioned-store-state";
import {
  createHeroProductStore,
  heroProductAuditEntries,
  heroProductIntegrationRows,
  heroProductTabMeta,
  heroProductTabs,
  heroSafeQueryChecks,
  readActiveHeroProductTab,
  readSafeQueryAnimationState,
} from "./hero-product.store";
import type {
  HeroProductTab,
  SafeQueryAnimationState,
} from "./hero-product.store";

type SafeQueryCheckStatus =
  SafeQueryAnimationState["statuses"][keyof SafeQueryAnimationState["statuses"]];

function readSafeQueryResultLabel(result: SafeQueryAnimationState["result"]) {
  return result === "blocked"
    ? "BLOCKED"
    : result === "pass"
      ? "PASS"
      : "CHECKING";
}

function SafeQueryStatusIndicator({
  status,
}: {
  status: SafeQueryCheckStatus;
}) {
  if (status === "success") {
    return (
      <span
        className="hero-safe-query-status-check t-success-check"
        data-state="in"
        aria-hidden="true"
      >
        <svg viewBox="0 0 16 16" fill="none">
          <path
            d="M3.5 8.5L6.5 11.5L12.5 4.5"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    );
  }

  if (status === "failure") {
    return <span aria-hidden="true">×</span>;
  }

  return null;
}

function SafeQueryPanel({
  result,
  resultText,
  statuses,
}: SafeQueryAnimationState & { resultText: TextSwapController }) {
  return (
    <div
      className="hero-safe-query"
      data-result={result}
      aria-label="Capability grant policy checks"
    >
      <div className="hero-safe-query-preview">
        <span className="hero-safe-query-preview-line hero-safe-query-preview-line-primary">
          read sentry
        </span>
        <span className="hero-safe-query-preview-line">select orders</span>
        <span className="hero-safe-query-preview-line">write PR</span>
      </div>

      <div className="hero-safe-query-sidebar">
        <div className="hero-safe-query-checklist" aria-live="polite">
          {heroSafeQueryChecks.map((check) => {
            const status = statuses[check.id];

            return (
              <div
                key={check.id}
                className="hero-safe-query-check"
                data-status={status}
              >
                <span className="hero-safe-query-check-box" aria-hidden="true">
                  {status === "pending" ? null : (
                    <ViewTransition
                      key={status}
                      enter="scale-in"
                      exit="scale-out"
                      default="none"
                    >
                      <SafeQueryStatusIndicator status={status} />
                    </ViewTransition>
                  )}
                </span>
                <span>{check.label}</span>
              </div>
            );
          })}
        </div>

        <div className="hero-safe-query-result-wrap">
          <div className="hero-safe-query-result" data-result={result}>
            <span
              ref={resultText.textRef}
              className="hero-safe-query-result-text t-text-swap"
              aria-live="polite"
            >
              {resultText.currentTextRef.current}
            </span>
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
      return null;

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

function HeroProductPanel({
  activeTab,
  children,
}: {
  activeTab: HeroProductTab;
  children: ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(false);

  useMountEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setIsOpen(true);
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  });

  return (
    <div
      className="hero-product-panel t-panel-slide"
      data-open={isOpen ? "true" : "false"}
      data-tab={activeTab}
    >
      {children}
    </div>
  );
}

function useHeroProductController(
  onSafeQueryResultChange: (label: string) => void
) {
  const heroProductStore = useMemo(
    () => createHeroProductStore({ runTransition: startTransition }),
    []
  );
  const safeQueryResultRef = useRef(
    readSafeQueryAnimationState(heroProductStore.$heroProductState.get()).result
  );
  const state = useTransitionedStoreState(
    heroProductStore.$heroProductState,
    (nextState) => {
      const nextResult = readSafeQueryAnimationState(nextState).result;

      if (safeQueryResultRef.current === nextResult) {
        return;
      }

      safeQueryResultRef.current = nextResult;
      onSafeQueryResultChange(readSafeQueryResultLabel(nextResult));
    }
  );
  const activeTab = readActiveHeroProductTab(state);
  const safeQuery = readSafeQueryAnimationState(state);

  return {
    activeTab,
    safeQuery,
    selectTab: (tab: HeroProductTab) => {
      heroProductStore.selectTab(tab);
    },
  };
}

export function HeroProductSurface() {
  const safeQueryResultText = useTextSwapController("CHECKING");
  const { activeTab, safeQuery, selectTab } = useHeroProductController(
    safeQueryResultText.swapText
  );
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
              onClick={() => selectTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="hero-product-sidebar-footer">audited</div>
      </aside>

      <div className="hero-product-main">
        <div className="hero-product-header">
          <div>
            <h3>prod-debug-readonly</h3>
            <p>Context without secrets.</p>
          </div>
          <div className="hero-product-header-meta">
            <span>4 sources</span>
            <span>keys hidden</span>
          </div>
        </div>

        <section className="hero-product-focus">
          <div className="hero-product-section-header">
            <h4>{activeTabMeta.title}</h4>
            <span>{activeTabMeta.tag}</span>
          </div>
          <div className="hero-product-panel-body">
            <ViewTransition
              key={activeTab}
              enter="slide-up"
              exit="slide-down"
              default="none"
            >
              <HeroProductPanel activeTab={activeTab}>
                {activeTab === "query" ? (
                  <SafeQueryPanel
                    {...safeQuery}
                    resultText={safeQueryResultText}
                  />
                ) : (
                  renderHeroProductPanel(activeTab)
                )}
              </HeroProductPanel>
            </ViewTransition>
          </div>
        </section>
      </div>
    </div>
  );
}
