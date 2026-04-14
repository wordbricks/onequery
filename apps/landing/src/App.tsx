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
  --sql "select team, sum(cost) as spend \\
         from monthly_costs \\
         group by 1 order by 2 desc"`;

const workflowSnippet = `connect source  -> ready
run query       -> results (or clear error)
session expires -> auto-refresh -> continue`;

const navigationItems = [
  { href: `#${LANDING_SECTION_IDS.install}`, label: "INSTALL" },
  { href: `#${LANDING_SECTION_IDS.surface}`, label: "WHAT IT DOES" },
  { href: `#${LANDING_SECTION_IDS.workflow}`, label: "HOW IT WORKS" },
];

const cards = [
  {
    label: "RUN LOCALLY",
    title: "Start a server on your machine",
    body: "One command spins up a local server. Open the browser dashboard or stay in the terminal. Both connect to the same instance.",
  },
  {
    label: "LOG IN ONCE",
    title: "Authenticate and stay signed in",
    body: "Sign in from the CLI and your session carries over to the browser UI. Tokens refresh automatically so you don't get logged out mid-workflow.",
  },
  {
    label: "QUERY ANYTHING",
    title: "Run SQL across all your connected databases",
    body: "Point at any connected data source like Postgres or MySQL and run queries directly from the terminal. No extra scripts needed.",
  },
];

const explicitItems = [
  "Start and stop the server with clear status feedback",
  "Log in, refresh sessions, and handle expired tokens",
  "Validate and run SQL with structured results",
  "Keep the browser UI and terminal in sync",
];

const timeline = [
  "Install OneQuery with a single command (curl, bunx, or npx all work).",
  "Run `onequery gateway` to start the local server.",
  "Open the browser UI or configure the CLI to connect to it.",
  "Log in, connect your data sources, and start querying.",
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
          aria-label="OneQuery GitHub repository"
        >
          <span>ONEQUERY</span>
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
              OPEN-SOURCE CLI FOR SELF-HOSTED ONEQUERY
            </p>
            <h1>Query all your databases from one command line.</h1>
            <p className="hero-body">
              OneQuery CLI lets you run a local server, connect your databases,
              and query them from the terminal or a browser dashboard. Install
              it in seconds and get started right away.
            </p>
            <DownloadCommand />
            <div className="hero-actions">
              <a
                href={`#${LANDING_SECTION_IDS.install}`}
                className="action-link action-link-dark"
              >
                GET STARTED
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
            <p className="section-kicker">WHAT THIS CLI DOES</p>
            <h2>
              A local server, a browser dashboard, and a terminal, all in sync.
            </h2>
            <p>
              The CLI handles everything you need to get started: running the
              server, logging in, connecting data sources, and running queries
              from the terminal or browser.
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
            <h2>Up and running in four steps.</h2>
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
            <p className="section-kicker">EXAMPLE QUERY</p>
            <pre>{querySnippet}</pre>
          </article>

          <article className="text-panel text-panel-accent">
            <p className="section-kicker">HOW IT WORKS</p>
            <h2>Every step is visible. Errors are clear, never hidden.</h2>
            <p>
              OneQuery shows you exactly what is happening at each stage. If
              something fails, you get a clear message instead of a silent error
              buried in a log file.
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
            <p className="section-kicker">OPEN SOURCE, RUNS ON YOUR MACHINE</p>
            <h2>Your data stays local. Your queries stay yours.</h2>
            <p>
              Install OneQuery, start the server on your machine, and use the
              browser dashboard or terminal to query your databases. No cloud
              required.
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
