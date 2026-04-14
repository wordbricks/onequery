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
  --source postgres-prod \\
  --sql "select team, sum(cost) as spend \\
         from monthly_costs \\
         group by 1 order by 2 desc"`;

const workflowSnippet = `connect source  -> ready
run query       -> results
token expires   -> refresh
retry           -> resume`;

const navigationItems = [
  { href: `#${LANDING_SECTION_IDS.surface}`, label: "Product" },
  { href: `#${LANDING_SECTION_IDS.install}`, label: "Install" },
  { href: `#${LANDING_SECTION_IDS.workflow}`, label: "Workflow" },
];

const heroSignals = [
  "Local gateway, not a hosted control plane",
  "Terminal and browser share the same runtime state",
  "Explicit workflows with visible status transitions",
];

const featureRows = [
  {
    eyebrow: "Local Control Plane",
    title: "Run the gateway where your data already lives.",
    body: "Start OneQuery on your own machine, point it at your own sources, and keep the control plane inside your environment. The landing page should feel like software proof, not brand theater.",
    points: [
      "Boot a local server with one command.",
      "Keep credentials and query execution inside your own network boundary.",
      "Use the browser UI only as another view onto the same running process.",
    ],
    placeholderType: "Product screenshot placeholder",
    placeholderTitle: "Gateway dashboard",
    placeholderBody:
      "Replace with a real dashboard capture showing sources, auth state, and query activity.",
  },
  {
    eyebrow: "Shared Runtime State",
    title: "The browser and the CLI read from the same truth.",
    body: "This product is built around explicit workflow state, so the marketing surface should show state transitions clearly. A user should immediately understand that auth, source connection, query execution, and retries are observable lifecycle steps.",
    points: [
      "CLI actions should reflect instantly in the browser view.",
      "Session refresh is modeled as a normal transition, not a hidden exception path.",
      "Each surface should make the current state legible without extra narration.",
    ],
    placeholderType: "Animated GIF placeholder",
    placeholderTitle: "CLI to dashboard sync",
    placeholderBody:
      "Replace with a short GIF showing sign-in, source connection, and synchronized status updates.",
  },
  {
    eyebrow: "Explicit Query Flow",
    title: "Every query is visible, inspectable, and recoverable.",
    body: "The page should emphasize that failures, retries, and success states are part of the normal operating model. This is a better fit for OneQuery than generic AI-product marketing language.",
    points: [
      "Show request, execution, results, and failure states as first-class UI.",
      "Use clean terminal and table placeholders instead of decorative illustration.",
      "Keep copy short so the product frame carries the proof.",
    ],
    placeholderType: "Product screenshot placeholder",
    placeholderTitle: "Query result surface",
    placeholderBody:
      "Replace with a real query result table, error state, or retry flow capture.",
  },
];

const infrastructureCards = [
  {
    title: "Gateway runtime",
    body: "A local control plane that keeps source connections, auth, and query execution in one place.",
  },
  {
    title: "CLI surface",
    body: "Fast terminal workflows for install, auth, source management, and SQL execution.",
  },
  {
    title: "Browser view",
    body: "A visual surface for the same underlying runtime state, useful for inspection and onboarding.",
  },
  {
    title: "Workflow model",
    body: "Deterministic transitions for loading, failure, retry, and success instead of hidden side effects.",
  },
];

const installSteps = [
  "Install the CLI with the bootstrap script.",
  "Start the local gateway.",
  "Point the CLI at the local server and sign in once.",
  "Connect a source, then run queries from either surface.",
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

type PlaceholderFrameProps = {
  badge: string;
  title: string;
  body: string;
  variant?: "hero" | "media" | "terminal";
};

function PlaceholderFrame({
  badge,
  title,
  body,
  variant = "media",
}: PlaceholderFrameProps) {
  return (
    <div className={`placeholder-frame placeholder-frame-${variant}`}>
      <div className="placeholder-toolbar">
        <div className="placeholder-dots" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <span className="placeholder-toolbar-label">{badge}</span>
      </div>

      <div className="placeholder-canvas">
        <div className="placeholder-pane placeholder-pane-sidebar">
          <span>runtime</span>
          <span>sources</span>
          <span>queries</span>
          <span>auth</span>
        </div>

        <div className="placeholder-pane placeholder-pane-main">
          <div className="placeholder-badges">
            <span>local</span>
            <span>active</span>
            <span>placeholder</span>
          </div>
          <h3>{title}</h3>
          <p>{body}</p>
          <div className="placeholder-grid" aria-hidden="true">
            <span />
            <span />
            <span />
            <span />
          </div>
        </div>
      </div>
    </div>
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
          <span className="brand-mark-dot" aria-hidden="true" />
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
            <p className="eyebrow">Self-hosted data workspace</p>
            <h1>Data ready for AI agents.</h1>
            <p className="hero-body">
              One safe gateway connecting all data sources.
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
            <PlaceholderFrame
              badge="Product screenshot placeholder"
              title="Unified local dashboard"
              body="Replace this frame with a real capture of the browser UI, source list, query panel, and runtime status."
              variant="hero"
            />
          </div>
        </section>

        <section
          className="section section-summary"
          id={LANDING_SECTION_IDS.surface}
        >
          <div className="section-intro">
            <p className="eyebrow">What the landing needs to prove</p>
            <h2>
              Show real workflow surfaces instead of decorative marketing art.
            </h2>
            <p>
              The target design is quiet, monochrome, and screenshot-led. Large
              headlines set the pace, but the real proof comes from product
              frames, terminal snippets, and explicit state transitions.
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
                <PlaceholderFrame
                  badge={feature.placeholderType}
                  title={feature.placeholderTitle}
                  body={feature.placeholderBody}
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
            <h2>Up and running with one bootstrap path.</h2>
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
            <h2>Failure and retry are part of the normal product story.</h2>
            <p>
              OneQuery is easier to trust when the landing page shows that
              errors are modeled, visible, and recoverable. This section should
              read like operating software, not a conceptual brand statement.
            </p>
            <pre className="workflow-block">{workflowSnippet}</pre>
          </article>
        </section>

        <section className="section final-cta">
          <div className="final-cta-copy">
            <p className="eyebrow">Open source, self-hostable</p>
            <h2>
              Run OneQuery on your own infrastructure, or point the CLI at an
              existing server.
            </h2>
            <p>
              OneQuery is an open-source platform for unified data querying.
              Self-host the full product with{" "}
              <code>onequery gateway start</code>, connect databases, analytics
              tools, and APIs from one place, and use the CLI or web UI with
              centralized credential management, query safety controls, and
              organization-level access control.
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
              Read docs on GitHub
            </a>
          </div>
        </section>
      </main>

      <footer className="site-footer">
        <p>OneQuery OSS CLI</p>
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
