import { useActorRef, useSelector } from "@xstate/react";

import {
  heroProductMachine,
  heroProductAuditEntries,
  heroProductIntegrationRows,
  heroProductTabMeta,
  heroProductTabs,
  heroSafeQueryChecks,
  readActiveHeroProductTab,
  readSafeQueryAnimationState,
} from "./hero-product.machine";
import type { HeroProductTab } from "./hero-product.machine";

function SafeQueryPanel({
  result,
  statuses,
}: ReturnType<typeof useHeroProductController>["safeQuery"]) {
  return (
    <div
      className="hero-safe-query"
      data-result={result}
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
            const status = statuses[check.id];
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
          <div className="hero-safe-query-result" data-result={result}>
            {result === "blocked"
              ? "BLOCKED"
              : result === "pass"
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

function useHeroProductController() {
  const actorRef = useActorRef(heroProductMachine);
  const activeTab = useSelector(actorRef, readActiveHeroProductTab);
  const safeQuery = useSelector(actorRef, readSafeQueryAnimationState);

  return {
    activeTab,
    safeQuery,
    selectTab: (tab: HeroProductTab) => {
      actorRef.send({
        type: "heroProduct/tabSelected",
        tab,
      });
    },
  };
}

export function HeroProductSurface() {
  const { activeTab, safeQuery, selectTab } = useHeroProductController();
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
            {activeTab === "query" ? (
              <div className="hero-product-panel" data-tab={activeTab}>
                <SafeQueryPanel {...safeQuery} />
              </div>
            ) : (
              <div
                key={activeTab}
                className="hero-product-panel"
                data-tab={activeTab}
              >
                {renderHeroProductPanel(activeTab)}
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
