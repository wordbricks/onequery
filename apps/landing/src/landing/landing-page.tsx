import { useEffect } from "react";
import type { ComponentPropsWithoutRef } from "react";

import { trackLandingCtaClick, trackPageView } from "../analytics";
import {
  LANDING_INSTALL_SCRIPT_URL,
  LANDING_REPOSITORY_URL,
  LANDING_SECTION_IDS,
  LANDING_SELF_HOST_DOCS_URL,
} from "../landing-config";
import { FooterContactButton, ProductUpdatesSection } from "../marketing-forms";
import { OpenClawDemoPlayer } from "../openclaw-demo-player";
import { BRAND_ICON_PATHS } from "./brand-icon-paths";
import { ControlPlaneDiagram } from "./components/control-plane-diagram";
import { DownloadCommand } from "./components/download-command";
import { HeroProductSurface } from "./components/hero-product-surface";
import { TerminalSurface } from "./components/terminal-surface";
import {
  FOOTER_LINKS,
  HERO_SIGNALS,
  INSTALL_STEPS,
  NAVIGATION_ITEMS,
  QUERY_DETAILS_SNIPPET,
  QUERY_TERMINAL_LINES,
  QUICKSTART_TERMINAL_LINES,
} from "./landing-content";

type TrackedLinkProps = ComponentPropsWithoutRef<"a"> & {
  href: string;
  trackingName: string;
  trackingSection: string;
  trackingHref?: string;
};

type LandingCtaLink = {
  className: string;
  href: string;
  label: string;
  rel?: ComponentPropsWithoutRef<"a">["rel"];
  target?: ComponentPropsWithoutRef<"a">["target"];
  trackingName: string;
  trackingSection: string;
};

const heroActions = [
  {
    className: "button button-primary",
    href: `#${LANDING_SECTION_IDS.install}`,
    label: "Get started",
    trackingName: "hero_get_started",
    trackingSection: "hero",
  },
  {
    className: "button button-secondary",
    href: LANDING_REPOSITORY_URL,
    label: "Browse repository",
    rel: "noreferrer",
    target: "_blank",
    trackingName: "hero_browse_repository",
    trackingSection: "hero",
  },
] satisfies ReadonlyArray<LandingCtaLink>;

const finalCtaActions = [
  {
    className: "button button-primary",
    href: LANDING_INSTALL_SCRIPT_URL,
    label: "Install now",
    rel: "noreferrer",
    target: "_blank",
    trackingName: "final_install_now",
    trackingSection: "final_cta",
  },
  {
    className: "button button-secondary",
    href: LANDING_SELF_HOST_DOCS_URL,
    label: "Read self-host docs",
    rel: "noreferrer",
    target: "_blank",
    trackingName: "final_read_self_host_docs",
    trackingSection: "final_cta",
  },
] satisfies ReadonlyArray<LandingCtaLink>;

function TrackedLink({
  children,
  href,
  onClick,
  trackingHref,
  trackingName,
  trackingSection,
  ...props
}: TrackedLinkProps) {
  return (
    <a
      {...props}
      href={href}
      onClick={(event) => {
        onClick?.(event);
        trackLandingCtaClick(
          trackingName,
          trackingSection,
          trackingHref ?? href
        );
      }}
    >
      {children}
    </a>
  );
}

function SiteHeader() {
  return (
    <header className="site-header">
      <a href="/" className="brand-mark" aria-label="OneQuery landing homepage">
        <img
          src="/onequery-icon.png"
          alt=""
          aria-hidden="true"
          className="brand-mark-icon"
        />
        <span>OneQuery</span>
      </a>

      <nav className="site-nav" aria-label="Primary">
        {NAVIGATION_ITEMS.map((item) => (
          <TrackedLink
            key={item.label}
            href={item.href}
            trackingName="nav_section_link"
            trackingSection="header_nav"
          >
            {item.label}
          </TrackedLink>
        ))}
      </nav>

      <div className="header-actions">
        <TrackedLink
          className="header-github-link"
          href={LANDING_REPOSITORY_URL}
          target="_blank"
          rel="noreferrer"
          aria-label="Open OneQuery GitHub repository"
          trackingName="header_github_repository"
          trackingSection="header"
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            className="header-github-link-icon"
          >
            <path d={BRAND_ICON_PATHS.github} fill="currentColor" />
          </svg>
        </TrackedLink>
      </div>
    </header>
  );
}

function HeroSection() {
  return (
    <section className="hero-section">
      <div className="hero-copy">
        <p className="eyebrow">Open source, self-hostable</p>
        <h1>Data ready for AI agents.</h1>
        <p className="hero-body">
          One safe gateway connecting all data sources.
        </p>

        <DownloadCommand />

        <div className="hero-actions">
          {heroActions.map((action) => (
            <TrackedLink
              key={action.label}
              className={action.className}
              href={action.href}
              target={action.target}
              rel={action.rel}
              trackingName={action.trackingName}
              trackingSection={action.trackingSection}
            >
              {action.label}
            </TrackedLink>
          ))}
        </div>

        <ul className="hero-signals">
          {HERO_SIGNALS.map((signal) => (
            <li key={signal}>{signal}</li>
          ))}
        </ul>
      </div>

      <div className="hero-visual">
        <HeroProductSurface />
      </div>
    </section>
  );
}

function OpenClawSection() {
  return (
    <section className="section openclaw-demo-section" id="demo">
      <div className="section-intro">
        <p className="eyebrow">See it in action</p>
        <h2>OpenClaw runs the OneQuery CLI inside a Discord thread.</h2>
        <p>
          The OpenClaw agent invokes OneQuery commands from chat, executes safe
          queries through the gateway, and posts the report back inline — no
          context switch, no copy-paste.
        </p>
      </div>

      <div className="openclaw-demo-frame">
        <OpenClawDemoPlayer />
      </div>
    </section>
  );
}

function SummarySection() {
  return (
    <section
      className="section section-summary"
      id={LANDING_SECTION_IDS.surface}
    >
      <div className="section-intro">
        <p className="eyebrow">What OneQuery does</p>
        <h2>
          A single query workspace across your internal data and external tools.
        </h2>
        <p>
          OneQuery sits between the tools asking for access and the systems
          holding the data, so teams can apply policy, budget, audit, and
          permission controls in one place.
        </p>
      </div>

      <ControlPlaneDiagram />
    </section>
  );
}

function InstallSection() {
  return (
    <section className="section utility-grid" id={LANDING_SECTION_IDS.install}>
      <article className="utility-panel">
        <p className="eyebrow">Install</p>
        <h2>Up and running in a few commands.</h2>
        <ol className="step-list">
          {INSTALL_STEPS.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </article>

      <article className="utility-panel utility-panel-code">
        <p className="eyebrow">Quickstart</p>
        <TerminalSurface
          title="Terminal session"
          lines={QUICKSTART_TERMINAL_LINES}
          footer="ready to connect the first source"
        />
      </article>
    </section>
  );
}

function WorkflowSection() {
  return (
    <section
      className="section utility-grid utility-grid-offset"
      id={LANDING_SECTION_IDS.workflow}
    >
      <article className="utility-panel utility-panel-code workflow-panel-example">
        <p className="eyebrow">Query example</p>
        <TerminalSurface
          title="Query execution"
          lines={QUERY_TERMINAL_LINES}
          footer="shared runtime state visible in CLI and browser"
        />
      </article>

      <article className="utility-panel workflow-panel-details">
        <p className="eyebrow">Query details</p>
        <h2>Review the result, guardrails, and cost context together.</h2>
        <p>
          The query surface is not only about SQL text. OneQuery keeps the
          source, read-only safeguards, execution time, row count, and budget
          context visible so operators can understand what just ran before
          sharing or retrying the request.
        </p>
        <pre className="workflow-block">{QUERY_DETAILS_SNIPPET}</pre>
      </article>
    </section>
  );
}

function FinalCtaSection() {
  return (
    <section className="section final-cta">
      <div className="final-cta-copy">
        <p className="eyebrow">Self-host or connect to an existing server</p>
        <h2>
          Deploy OneQuery in your environment for secure, controllable, and
          fully visible data operations.
        </h2>
        <p>
          OneQuery is an open-source platform for unified data querying.
          Self-host the full product with <code>onequery gateway start</code>,
          connect databases, analytics tools, and APIs from one place, and give
          operators and AI agents a shared surface for access, execution, and
          recovery.
        </p>
      </div>

      <div className="final-cta-actions">
        {finalCtaActions.map((action) => (
          <TrackedLink
            key={action.label}
            className={action.className}
            href={action.href}
            target={action.target}
            rel={action.rel}
            trackingName={action.trackingName}
            trackingSection={action.trackingSection}
          >
            {action.label}
          </TrackedLink>
        ))}
      </div>
    </section>
  );
}

function SiteFooter() {
  return (
    <footer className="site-footer">
      <p>OneQuery</p>
      <div className="footer-links">
        {FOOTER_LINKS.map((link) => (
          <TrackedLink
            key={link.label}
            href={link.href}
            target="_blank"
            rel="noreferrer"
            trackingName={link.trackingName}
            trackingSection="footer"
          >
            {link.label}
          </TrackedLink>
        ))}
        <FooterContactButton />
      </div>
    </footer>
  );
}

export function LandingPage() {
  useEffect(() => {
    trackPageView();
  }, []);

  return (
    <div className="page-shell">
      <SiteHeader />

      <main className="page-main">
        <HeroSection />
        <OpenClawSection />
        <SummarySection />
        <InstallSection />
        <WorkflowSection />
        <FinalCtaSection />
        <ProductUpdatesSection />
      </main>

      <SiteFooter />
    </div>
  );
}
