import { useEffect, useRef, useState } from "react";

import {
  LANDING_CLI_SOURCE_URL,
  LANDING_COPY_FEEDBACK_RESET_DELAY_MS,
  LANDING_DOWNLOAD_COMMAND,
  LANDING_INSTALL_SCRIPT_URL,
  LANDING_INSTALL_SNIPPET,
  LANDING_REPOSITORY_URL,
  LANDING_SECTION_IDS,
} from "./landing-config";

const querySnippet = `onequery query exec \\
  --source postgres-prod \\
  --sql "select team, sum(cost) as spend from monthly_costs group by 1 order by 2 desc"`;

const workflowSnippet = `state -> reducer -> effect
failure -> retry -> explicit transition
query -> result envelope -> terminal output`;

const navigationItems = [
  { href: `#${LANDING_SECTION_IDS.install}`, label: "INSTALL" },
  { href: `#${LANDING_SECTION_IDS.surface}`, label: "WHAT IT DOES" },
  { href: `#${LANDING_SECTION_IDS.workflow}`, label: "WORKFLOW" },
];

const cards = [
  {
    label: "RUN LOCALLY",
    title: "Start the control plane on your machine",
    body: "Use `onequery gateway` to bring up the local runtime, then point the browser UI and CLI at the same instance.",
  },
  {
    label: "AUTH CLEARLY",
    title: "Keep sign-in and session lifecycle inspectable",
    body: "The CLI models device and session flows explicitly so retry, refresh, and failure stay legible to operators.",
  },
  {
    label: "QUERY DIRECTLY",
    title: "Work across connected sources from one surface",
    body: "Validate SQL, execute queries, and read structured results without inventing one-off shell glue for every source.",
  },
];

const explicitItems = [
  "Serve lifecycle and runtime status",
  "Auth login plus session refresh behavior",
  "CLI query validation and execution contracts",
  "Shared browser and terminal control plane",
];

const timeline = [
  "Install the published `onequery` package with curl, bunx, or npx.",
  "Run `onequery gateway` and open the local browser UI.",
  "Bootstrap the instance once, then point the CLI at it.",
  "Use the same runtime for authentication, organization context, and query workflows.",
];

function DownloadCommand() {
  const [copied, setCopied] = useState(false);
  const resetTimerRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (resetTimerRef.current !== null) {
        window.clearTimeout(resetTimerRef.current);
      }
    },
    []
  );

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(LANDING_DOWNLOAD_COMMAND);
      setCopied(true);
      if (resetTimerRef.current !== null) {
        window.clearTimeout(resetTimerRef.current);
      }
      resetTimerRef.current = window.setTimeout(() => {
        setCopied(false);
      }, LANDING_COPY_FEEDBACK_RESET_DELAY_MS);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="download-command" role="group" aria-label="Install command">
      <span className="download-command-prompt" aria-hidden="true">
        $
      </span>
      <code>{LANDING_DOWNLOAD_COMMAND}</code>
      <button
        type="button"
        className="download-command-copy"
        onClick={handleCopy}
        aria-label="Copy install command"
      >
        {copied ? "COPIED" : "⧉"}
      </button>
    </div>
  );
}

export function App() {
  return (
    <div className="page-shell">
      <header className="site-header">
        <a
          href={LANDING_REPOSITORY_URL}
          target="_blank"
          rel="noreferrer"
          className="brand-tile"
          aria-label="OneQuery OSS GitHub repository"
        >
          <span>ONEQUERY</span>
          <span>OSS</span>
          <span>CLI</span>
        </a>

        <nav className="site-nav" aria-label="Primary">
          {navigationItems.map((item) => (
            <a key={item.label} href={item.href}>
              {item.label}
            </a>
          ))}
          <a href={LANDING_CLI_SOURCE_URL} target="_blank" rel="noreferrer">
            SOURCE
          </a>
        </nav>

        <a
          className="header-cta"
          href={LANDING_REPOSITORY_URL}
          target="_blank"
          rel="noreferrer"
        >
          GITHUB
        </a>
      </header>

      <main className="page-main">
        <section className="hero-grid">
          <div className="hero-copy">
            <p className="section-kicker">
              OPEN-SOURCE COMMAND LINE FOR SELF-HOSTED ONEQUERY
            </p>
            <h1>
              Operate your data workspace with a lighter, explicit surface.
            </h1>
            <p className="hero-body">
              OneQuery OSS CLI is built for local operation: install it, run the
              control plane on Bun, keep the browser UI and terminal pointed at
              the same instance, and make transitions visible instead of hidden.
            </p>
            <DownloadCommand />
            <div className="hero-actions">
              <a
                href={`#${LANDING_SECTION_IDS.install}`}
                className="action-link action-link-dark"
              >
                SEE INSTALL FLOW
              </a>
              <a
                href={LANDING_REPOSITORY_URL}
                target="_blank"
                rel="noreferrer"
                className="action-link"
              >
                BROWSE REPOSITORY
              </a>
            </div>
          </div>

          <div className="hero-art" aria-hidden="true">
            <div className="hero-globe">
              <div className="hero-continent continent-a" />
              <div className="hero-continent continent-b" />
              <div className="hero-continent continent-c" />
              <div className="hero-continent continent-d" />
              <div className="hero-tag tag-a">serve</div>
              <div className="hero-tag tag-b">auth</div>
              <div className="hero-tag tag-c">query</div>
              <div className="hero-tag tag-d">state</div>
            </div>
          </div>
        </section>

        <section
          className="content-block intro-block"
          id={LANDING_SECTION_IDS.surface}
        >
          <div className="content-heading">
            <p className="section-kicker">WHAT THIS CLI IS FOR</p>
            <h2>
              Not a thin shell around APIs, but the operating surface itself.
            </h2>
            <p>
              The OSS CLI owns local serve lifecycle, authentication, query
              workflows, and the bridge between the browser session and terminal
              session.
            </p>
          </div>

          <div className="card-grid">
            {cards.map((card) => (
              <article key={card.title} className="info-card">
                <p className="card-label">{card.label}</p>
                <h3>{card.title}</h3>
                <p>{card.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section
          className="content-block two-column"
          id={LANDING_SECTION_IDS.install}
        >
          <article className="text-panel">
            <p className="section-kicker">INSTALL AND BOOT</p>
            <h2>From installer to live runtime in a few deliberate steps.</h2>
            <ol className="timeline-list">
              {timeline.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ol>
          </article>

          <article className="code-panel">
            <p className="section-kicker">QUICKSTART</p>
            <pre>{LANDING_INSTALL_SNIPPET}</pre>
          </article>
        </section>

        <section
          className="content-block two-column"
          id={LANDING_SECTION_IDS.workflow}
        >
          <article className="code-panel code-panel-dark">
            <p className="section-kicker">QUERY SURFACE</p>
            <pre>{querySnippet}</pre>
          </article>

          <article className="text-panel text-panel-accent">
            <p className="section-kicker">WORKFLOW SEMANTICS</p>
            <h2>
              Reducers stay pure. Effects stay deferred. Failure stays modeled.
            </h2>
            <p>
              This repository treats workflows as explicit state machines.
              Hidden exceptions are not the design center; lifecycle transitions
              are.
            </p>
            <ul className="explicit-list">
              {explicitItems.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
            <pre className="workflow-inline">{workflowSnippet}</pre>
          </article>
        </section>

        <section className="cta-band">
          <div className="cta-copy">
            <p className="section-kicker">OPEN SOURCE, LOCALLY OPERABLE</p>
            <h2>
              Use the CLI when you want the runtime, contracts, and state
              transitions to remain visible.
            </h2>
            <p>
              Install it, run the server locally, and keep the web UI plus
              terminal anchored to the same OneQuery instance.
            </p>
          </div>
          <div className="cta-actions">
            <a
              href={LANDING_INSTALL_SCRIPT_URL}
              target="_blank"
              rel="noreferrer"
              className="action-link action-link-dark"
            >
              INSTALL NOW
            </a>
            <a
              href={LANDING_CLI_SOURCE_URL}
              target="_blank"
              rel="noreferrer"
              className="action-link"
            >
              READ CLI SOURCE
            </a>
          </div>
        </section>
      </main>
    </div>
  );
}
