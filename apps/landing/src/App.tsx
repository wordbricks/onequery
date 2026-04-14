import { useEffect, useRef, useState } from "react";

import {
  LANDING_CLI_SOURCE_URL,
  LANDING_COPY_FEEDBACK_RESET_DELAY_MS,
  LANDING_INSTALL_COMMANDS,
  LANDING_INSTALL_SCRIPT_URL,
  LANDING_INSTALL_SNIPPET,
  LANDING_REPOSITORY_URL,
  LANDING_SECTION_IDS,
  LANDING_SELF_HOST_DOCS_URL,
} from "./landing-config";

const querySnippet = `onequery query exec \\
  --source warehouse \\
  --sql "select date_trunc('day', occurred_at) as day, \\
                sum(total_usd) as spend \\
         from agent_runs \\
         group by 1 \\
         order by 1 desc \\
         limit 7"`;

const workflowSnippet = `gateway.start   -> running
auth.login      -> authenticated
source.connect  -> ready
query.exec      -> failed
retry           -> completed`;

const navigationItems = [
  { href: `#${LANDING_SECTION_IDS.surface}`, label: "Product" },
  { href: `#${LANDING_SECTION_IDS.install}`, label: "Install" },
  { href: `#${LANDING_SECTION_IDS.workflow}`, label: "Workflow" },
];

const heroSignals = [
  "Self-host the gateway with `onequery gateway start`.",
  "Keep the CLI and browser pointed at the same runtime state.",
  "Centralize budgets, policies, and source access in one control plane.",
];

const featureRows = [
  {
    eyebrow: "Unified Sources",
    title: "Connect databases, analytics tools, and APIs behind one gateway.",
    body: "OneQuery gives your team one place to register data access across SQL databases, analytics vendors, and SaaS APIs. Operators can keep source setup, credential ownership, and query routing inside a self-hosted runtime instead of rebuilding access rules per tool.",
    points: [
      "Support PostgreSQL, MySQL, MongoDB, BigQuery, GitHub, Linear, and more from one product surface.",
      "Use provider-specific connect flows from the CLI or the browser without changing the underlying runtime.",
      "Register customer-side connectors when protected credentials must stay inside a private network.",
    ],
    mediaBadge: "Source catalog",
    mediaTitle: "Configured sources and ownership stay visible.",
    mediaBody:
      "Operators can see which providers are connected, which paths are ready, and where connector-based access is pinned.",
    mediaSrc: "/surface-sources.svg",
    mediaAlt:
      "Illustrated OneQuery source catalog showing databases, analytics providers, and API integrations with runtime statuses.",
    mediaStats: ["14 ready", "3 connector-backed", "2 need action"],
  },
  {
    eyebrow: "Shared Runtime State",
    title: "Move between the terminal and the browser without desync.",
    body: "The CLI and web UI sit on top of the same gateway process. Sign-in state, source readiness, and recent activity stay aligned, so teams can bootstrap in the browser, automate in the terminal, and still inspect the same underlying workflow.",
    points: [
      "Boot the gateway once and keep both surfaces pointed at the same server.",
      "Make auth refresh, source connection, and query execution visible as normal lifecycle transitions.",
      "Share one organization context across operator workflows and teammate onboarding.",
    ],
    mediaBadge: "Shared runtime state",
    mediaTitle: "One command stream, one browser view, one source of truth.",
    mediaBody:
      "The same query run and auth session are legible from both surfaces instead of being split across unrelated tools.",
    mediaSrc: "/surface-sync.svg",
    mediaAlt:
      "Illustrated split view showing a OneQuery CLI session and browser dashboard synchronized around the same gateway state.",
    mediaStats: ["Gateway running", "Session synced", "Query state shared"],
  },
  {
    eyebrow: "Safety And Observability",
    title: "Treat execution, budgets, failures, and retries as product state.",
    body: "OneQuery makes the operational path visible: preview a request, execute it, inspect the result, and recover when something fails. Budget tracking and policy checks help teams understand cost and safety before a query turns into an outage.",
    points: [
      "Enforce read-only and single-statement safeguards for SQL-style query execution.",
      "Track spend-sensitive providers with budget status and remaining-limit context.",
      "Expose failure and retry paths as visible workflow steps instead of opaque exceptions.",
    ],
    mediaBadge: "Query observability",
    mediaTitle: "Review the request, result, and next action in one place.",
    mediaBody:
      "Budget usage, policy outcome, result shape, and retry guidance are part of the same execution story.",
    mediaSrc: "/surface-query.svg",
    mediaAlt:
      "Illustrated OneQuery query execution surface showing SQL text, result rows, policy checks, budget usage, and retry guidance.",
    mediaStats: ["Read-only policy", "$4.20 cost", "Retry available"],
  },
];

const infrastructureCards = [
  {
    title: "Self-hosted gateway",
    body: "Run the control plane on your own infrastructure and keep query execution close to the data.",
  },
  {
    title: "Shared surfaces",
    body: "Use the CLI for speed and the browser for onboarding and inspection without forking the state model.",
  },
  {
    title: "Source access",
    body: "Connect databases, analytics providers, and APIs from one gateway instead of maintaining separate paths.",
  },
  {
    title: "Operator controls",
    body: "Make policy, budgets, failures, and retries visible so teams can trust how agent access behaves.",
  },
];

const installSteps = [
  "Install the CLI with the script, Homebrew, npm, or Bun.",
  "Start the self-hosted gateway with `onequery gateway start`.",
  "Open the local UI to bootstrap the first user, then run `onequery auth login`.",
  "Connect a source and execute queries from the CLI or the browser against the same gateway.",
];

const footerLinks = [
  { href: LANDING_REPOSITORY_URL, label: "GitHub" },
  { href: LANDING_CLI_SOURCE_URL, label: "CLI source" },
  { href: LANDING_INSTALL_SCRIPT_URL, label: "Install script" },
];

function DownloadCommand() {
  const [selectedMethodLabel, setSelectedMethodLabel] = useState<string>(
    LANDING_INSTALL_COMMANDS[0].label
  );
  const [copiedLabel, setCopiedLabel] = useState<string | null>(null);
  const resetTimerRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (resetTimerRef.current !== null) {
        window.clearTimeout(resetTimerRef.current);
      }
    },
    []
  );

  async function handleCopy(label: string, command: string) {
    try {
      await navigator.clipboard.writeText(command);
      setCopiedLabel(label);

      if (resetTimerRef.current !== null) {
        window.clearTimeout(resetTimerRef.current);
      }

      resetTimerRef.current = window.setTimeout(() => {
        setCopiedLabel(null);
      }, LANDING_COPY_FEEDBACK_RESET_DELAY_MS);
    } catch {
      setCopiedLabel(null);
    }
  }

  const selectedMethod =
    LANDING_INSTALL_COMMANDS.find(
      (method) => method.label === selectedMethodLabel
    ) ?? LANDING_INSTALL_COMMANDS[0];

  return (
    <div className="install-selector">
      <div className="install-tabs" role="tablist" aria-label="Install method">
        {LANDING_INSTALL_COMMANDS.map((method) => {
          const isSelected = method.label === selectedMethod.label;

          return (
            <button
              key={method.label}
              id={`install-tab-${method.label}`}
              type="button"
              role="tab"
              aria-selected={isSelected}
              aria-controls="install-command-panel"
              className={`install-tab ${isSelected ? "install-tab-active" : ""}`}
              onClick={() => setSelectedMethodLabel(method.label)}
            >
              {method.label}
            </button>
          );
        })}
      </div>

      <div
        id="install-command-panel"
        className="download-command"
        role="tabpanel"
        aria-labelledby={`install-tab-${selectedMethod.label}`}
      >
        <span className="download-command-label">{selectedMethod.label}</span>
        <code>{selectedMethod.command}</code>
        <button
          type="button"
          className="install-method-copy"
          onClick={() =>
            handleCopy(selectedMethod.label, selectedMethod.command)
          }
          aria-label={`Copy ${selectedMethod.label} install command`}
        >
          {copiedLabel === selectedMethod.label ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}

type ProductSurfaceProps = {
  badge: string;
  src: string;
  alt: string;
  title: string;
  body: string;
  stats?: string[];
  variant?: "hero" | "media";
};

function ProductSurface({
  badge,
  src,
  alt,
  title,
  body,
  stats = [],
  variant = "media",
}: ProductSurfaceProps) {
  return (
    <figure className={`product-surface product-surface-${variant}`}>
      <div className="product-surface-toolbar">
        <div className="product-surface-toolbar-leading">
          <div className="product-surface-dots" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <span className="product-surface-toolbar-label">{badge}</span>
        </div>

        <span className="product-surface-chip">Sample surface</span>
      </div>

      <div className="product-surface-media">
        <img src={src} alt={alt} className="product-surface-image" />
      </div>

      <figcaption className="product-surface-meta">
        <div className="product-surface-copy">
          <h3>{title}</h3>
          <p>{body}</p>
        </div>

        {stats.length > 0 ? (
          <div
            className="product-surface-stats"
            aria-label="Surface highlights"
          >
            {stats.map((stat) => (
              <span key={stat}>{stat}</span>
            ))}
          </div>
        ) : null}
      </figcaption>
    </figure>
  );
}

export function App() {
  return (
    <div className="page-shell">
      <header className="site-header">
        <a
          href="/"
          className="brand-mark"
          aria-label="OneQuery landing homepage"
        >
          <img
            src="/onequery-icon.png"
            alt=""
            aria-hidden="true"
            className="brand-mark-icon"
          />
          <span>OneQuery</span>
        </a>

        <nav className="site-nav" aria-label="Primary">
          {navigationItems.map((item) => (
            <a key={item.label} href={item.href}>
              {item.label}
            </a>
          ))}
        </nav>

        <div className="header-actions">
          <a href={LANDING_CLI_SOURCE_URL} target="_blank" rel="noreferrer">
            Source
          </a>
          <a
            className="button button-primary"
            href={LANDING_REPOSITORY_URL}
            target="_blank"
            rel="noreferrer"
          >
            GitHub
          </a>
        </div>
      </header>

      <main className="page-main">
        <section className="hero-section">
          <div className="hero-copy">
            <p className="eyebrow">Open source, self-hostable</p>
            <h1>One gateway for the data your team and AI agents need.</h1>
            <p className="hero-body">
              Run OneQuery on your own infrastructure, connect databases,
              analytics tools, and APIs, and work from the CLI or browser
              against the same runtime state.
            </p>

            <DownloadCommand />

            <div className="hero-actions">
              <a
                className="button button-primary"
                href={`#${LANDING_SECTION_IDS.install}`}
              >
                Get started
              </a>
              <a
                className="button button-secondary"
                href={LANDING_REPOSITORY_URL}
                target="_blank"
                rel="noreferrer"
              >
                Browse repository
              </a>
            </div>

            <ul className="hero-signals">
              {heroSignals.map((signal) => (
                <li key={signal}>{signal}</li>
              ))}
            </ul>
          </div>

          <div className="hero-visual">
            <ProductSurface
              badge="Local gateway dashboard"
              src="/surface-hero.svg"
              alt="Illustrated OneQuery dashboard showing sources, recent activity, budget status, and query runs in a self-hosted gateway."
              title="A self-hosted control plane with visible runtime state."
              body="Sources, sessions, recent runs, and operator controls are available from one place instead of being split across separate tools."
              stats={["12 sources", "3 active sessions", "localhost:5656"]}
              variant="hero"
            />
          </div>
        </section>

        <section
          className="section section-summary"
          id={LANDING_SECTION_IDS.surface}
        >
          <div className="section-intro">
            <p className="eyebrow">What OneQuery does</p>
            <h2>
              A single query workspace across your internal data and external
              tools.
            </h2>
            <p>
              OneQuery combines a self-hosted gateway, multi-source access, and
              explicit operator guardrails in one product. Teams can install the
              CLI, run the gateway locally or on their own infrastructure, and
              expose the same runtime truth to both terminal workflows and the
              browser.
            </p>
          </div>

          <div className="infrastructure-grid">
            {infrastructureCards.map((card) => (
              <article key={card.title} className="infrastructure-card">
                <h3>{card.title}</h3>
                <p>{card.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="section feature-stack">
          {featureRows.map((feature, index) => (
            <article
              key={feature.title}
              className={`feature-row ${index % 2 === 1 ? "feature-row-reversed" : ""}`}
            >
              <div className="feature-copy">
                <p className="eyebrow">{feature.eyebrow}</p>
                <h2>{feature.title}</h2>
                <p>{feature.body}</p>
                <ul className="detail-list">
                  {feature.points.map((point) => (
                    <li key={point}>{point}</li>
                  ))}
                </ul>
              </div>

              <div className="feature-media">
                <ProductSurface
                  badge={feature.mediaBadge}
                  src={feature.mediaSrc}
                  alt={feature.mediaAlt}
                  title={feature.mediaTitle}
                  body={feature.mediaBody}
                  stats={feature.mediaStats}
                />
              </div>
            </article>
          ))}
        </section>

        <section
          className="section utility-grid"
          id={LANDING_SECTION_IDS.install}
        >
          <article className="utility-panel">
            <p className="eyebrow">Install</p>
            <h2>Up and running in a few commands.</h2>
            <ol className="step-list">
              {installSteps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </article>

          <article className="utility-panel utility-panel-code">
            <p className="eyebrow">Quickstart</p>
            <pre>{LANDING_INSTALL_SNIPPET}</pre>
          </article>
        </section>

        <section
          className="section utility-grid utility-grid-offset"
          id={LANDING_SECTION_IDS.workflow}
        >
          <article className="utility-panel utility-panel-code">
            <p className="eyebrow">Query example</p>
            <pre>{querySnippet}</pre>
          </article>

          <article className="utility-panel">
            <p className="eyebrow">Workflow state</p>
            <h2>Failure and retry are part of the normal operating model.</h2>
            <p>
              OneQuery is built around explicit workflow state. That makes auth
              refresh, query failure, retry, and recovery inspectable instead of
              hidden in side effects or background exception paths.
            </p>
            <pre className="workflow-block">{workflowSnippet}</pre>
          </article>
        </section>

        <section className="section final-cta">
          <div className="final-cta-copy">
            <p className="eyebrow">
              Self-host or connect to an existing server
            </p>
            <h2>
              Bring OneQuery into your own environment and keep the control
              plane close to the data.
            </h2>
            <p>
              OneQuery is an open-source platform for unified data querying.
              Self-host the full product with{" "}
              <code>onequery gateway start</code>, connect databases, analytics
              tools, and APIs from one place, and give operators and AI agents a
              shared surface for access, execution, and recovery.
            </p>
          </div>

          <div className="final-cta-actions">
            <a
              className="button button-primary"
              href={LANDING_INSTALL_SCRIPT_URL}
              target="_blank"
              rel="noreferrer"
            >
              Install now
            </a>
            <a
              className="button button-secondary"
              href={LANDING_SELF_HOST_DOCS_URL}
              target="_blank"
              rel="noreferrer"
            >
              Read self-host docs
            </a>
          </div>
        </section>
      </main>

      <footer className="site-footer">
        <p>OneQuery</p>
        <div className="footer-links">
          {footerLinks.map((link) => (
            <a
              key={link.label}
              href={link.href}
              target="_blank"
              rel="noreferrer"
            >
              {link.label}
            </a>
          ))}
        </div>
      </footer>
    </div>
  );
}
