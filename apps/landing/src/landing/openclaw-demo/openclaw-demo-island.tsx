import { lazy, Suspense } from "react";

const LazyOpenClawDemoPlayer = lazy(() =>
  import("./openclaw-demo-player").then((module) => ({
    default: module.OpenClawDemoPlayer,
  }))
);

function OpenClawDemoFallback() {
  return (
    <div className="openclaw-demo-loading" aria-hidden="true">
      <div className="openclaw-demo-poster">
        <aside className="openclaw-demo-poster-sidebar">
          <span className="openclaw-demo-poster-avatar">OC</span>
          <span className="openclaw-demo-poster-channel"># prod-debug</span>
          <span className="openclaw-demo-poster-channel"># github-prs</span>
          <span className="openclaw-demo-poster-channel"># incidents</span>
        </aside>

        <div className="openclaw-demo-poster-main">
          <div className="openclaw-demo-poster-message">
            <span className="openclaw-demo-poster-dot" />
            <p>Sentry error ISSUE-7421</p>
          </div>
          <div className="openclaw-demo-poster-message">
            <span className="openclaw-demo-poster-dot" />
            <p>Postgres read limited to 100 rows</p>
          </div>
          <div className="openclaw-demo-poster-message">
            <span className="openclaw-demo-poster-dot" />
            <p>GitHub PR opened, Linear issue linked</p>
          </div>
          <div className="openclaw-demo-poster-audit">audit trail recorded</div>
        </div>
      </div>
    </div>
  );
}

export function OpenClawDemoIsland() {
  if (typeof window === "undefined") {
    return <OpenClawDemoFallback />;
  }

  return (
    <Suspense fallback={<OpenClawDemoFallback />}>
      <LazyOpenClawDemoPlayer />
    </Suspense>
  );
}
