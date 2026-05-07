import { lazy, Suspense, useState } from "react";
import type { ComponentPropsWithoutRef } from "react";

import { trackLandingCtaClick } from "../analytics/landing-analytics";
import {
  INSTALL_SCRIPT_URL,
  REPOSITORY_URL,
  SECTION_IDS,
  SELF_HOST_DOCS_URL,
} from "../config/landing-config";
import { BRAND_ICON_PATHS } from "../content/brand-icon-paths";
import {
  FOOTER_LINKS,
  HERO_SIGNALS,
  INSTALL_STEPS,
  NAVIGATION_ITEMS,
  QUERY_DETAILS_SNIPPET,
  QUERY_TERMINAL_LINES,
  QUICKSTART_TERMINAL_LINES,
} from "../content/landing-content";
import { ControlPlaneDiagram } from "../control-plane/control-plane-diagram";
import { DownloadCommand } from "../download-command/download-command";
import { HeroProductSurface } from "../hero-product/hero-product-surface";
import { RoadmapSection } from "../roadmap/roadmap-section";
import { TerminalSurface } from "../terminal/terminal-surface";
import { useNearViewport, ViewportDeferredMount } from "./deferred-mount";

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

const OPENCLAW_DEMO_ROOT_MARGIN = "700px 0px";
const PRODUCT_UPDATES_ROOT_MARGIN = "600px 0px";

const heroActions: ReadonlyArray<LandingCtaLink> = [
  {
    className: "button button-primary",
    href: `#${SECTION_IDS.install}`,
    label: "Install CLI",
    trackingName: "hero_get_started",
    trackingSection: "hero",
  },
  {
    className: "button button-secondary",
    href: "#demo",
    label: "Watch demo",
    trackingName: "hero_watch_demo",
    trackingSection: "hero",
  },
];

const finalCtaActions = [
  {
    className: "button button-primary",
    href: INSTALL_SCRIPT_URL,
    label: "Install now",
    rel: "noreferrer",
    target: "_blank",
    trackingName: "final_install_now",
    trackingSection: "final_cta",
  },
  {
    className: "button button-secondary",
    href: SELF_HOST_DOCS_URL,
    label: "Read self-host docs",
    rel: "noreferrer",
    target: "_blank",
    trackingName: "final_read_self_host_docs",
    trackingSection: "final_cta",
  },
] satisfies ReadonlyArray<LandingCtaLink>;

const LazyOpenClawDemoPlayer = lazy(() =>
  import("../openclaw-demo/openclaw-demo-player").then((module) => ({
    default: module.OpenClawDemoPlayer,
  }))
);

const LazyFooterContactButton = lazy(() =>
  import("../marketing/footer-contact-button").then((module) => ({
    default: module.FooterContactButton,
  }))
);

const LazyProductUpdatesSection = lazy(() =>
  import("../marketing/product-updates-section").then((module) => ({
    default: module.ProductUpdatesSection,
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
          href={REPOSITORY_URL}
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
        <p className="eyebrow">Agent access control plane</p>
        <h1>Give AI agents production context, not production keys.</h1>
        <p className="hero-body">
          OneQuery gives agents a governed path to approved sources while
          credentials stay centralized and every query leaves an audit trail.
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
      </div>

      <div className="hero-visual">
        <HeroProductSurface />
      </div>

      <ul className="hero-signals">
        {HERO_SIGNALS.map((signal) => (
          <li key={signal}>{signal}</li>
        ))}
      </ul>
    </section>
  );
}

function OpenClawSection() {
  const { isNearViewport, targetRef } = useNearViewport<HTMLDivElement>({
    rootMargin: OPENCLAW_DEMO_ROOT_MARGIN,
  });

  return (
    <section className="section openclaw-demo-section" id="demo">
      <div className="section-intro">
        <p className="eyebrow">Agent-native access</p>
        <h2>One grant. Any agent.</h2>
      </div>

      <div ref={targetRef} className="openclaw-demo-frame">
        {isNearViewport ? (
          <Suspense fallback={<OpenClawDemoFallback />}>
            <LazyOpenClawDemoPlayer />
          </Suspense>
        ) : (
          <OpenClawDemoFallback />
        )}
      </div>
    </section>
  );
}

function SummarySection() {
  return (
    <section className="section section-summary" id={SECTION_IDS.surface}>
      <div className="section-intro">
        <p className="eyebrow">What OneQuery does</p>
        <h2>Policy between agents and prod.</h2>
      </div>

      <ControlPlaneDiagram />
    </section>
  );
}

function InstallSection() {
  return (
    <section className="section utility-grid" id={SECTION_IDS.install}>
      <article className="utility-panel">
        <p className="eyebrow">First workflow</p>
        <h2>Debug production without sharing credentials.</h2>
        <ol className="step-list">
          {INSTALL_STEPS.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </article>

      <article className="utility-panel utility-panel-code">
        <p className="eyebrow">Grant setup</p>
        <TerminalSurface
          title="Terminal session"
          lines={QUICKSTART_TERMINAL_LINES}
          footer="ready to debug production without sharing credentials"
        />
      </article>
    </section>
  );
}

function WorkflowSection() {
  return (
    <section
      className="section utility-grid utility-grid-offset"
      id={SECTION_IDS.workflow}
    >
      <article className="utility-panel utility-panel-code workflow-panel-example">
        <p className="eyebrow">Incident loop</p>
        <TerminalSurface
          title="Agent run"
          lines={QUERY_TERMINAL_LINES}
          footer="inspect evidence, open PRs and issues, audit everything"
        />
      </article>

      <article className="utility-panel workflow-panel-details">
        <p className="eyebrow">Query details</p>
        <h2>Review the result and guardrails together.</h2>
        <p>Source, policy, row count, latency, and budget stay visible.</p>
        <pre className="workflow-block">{QUERY_DETAILS_SNIPPET}</pre>
      </article>
    </section>
  );
}

function FinalCtaSection() {
  return (
    <section className="section final-cta">
      <div className="final-cta-copy">
        <p className="eyebrow">Built for real incidents</p>
        <h2>Give agents the clues, not the keys.</h2>
        <p>
          Agents can inspect errors, logs, and database state without raw
          credentials or permission to change production.
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
  const [isContactRequested, setIsContactRequested] = useState(false);

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
        {isContactRequested ? (
          <Suspense
            fallback={
              <span
                className="contact-link-button contact-link-button-loading"
                aria-hidden="true"
              >
                Contact
              </span>
            }
          >
            <LazyFooterContactButton autoOpen />
          </Suspense>
        ) : (
          <button
            type="button"
            className="contact-link-button"
            onClick={() => setIsContactRequested(true)}
          >
            Contact
          </button>
        )}
      </div>
    </footer>
  );
}

export function LandingPage() {
  return (
    <div className="page-shell">
      <SiteHeader />

      <main className="page-main">
        <HeroSection />
        <SummarySection />
        <InstallSection />
        <WorkflowSection />
        <RoadmapSection />
        <OpenClawSection />
        <FinalCtaSection />
        <ViewportDeferredMount
          className="deferred-mount-anchor"
          rootMargin={PRODUCT_UPDATES_ROOT_MARGIN}
        >
          <Suspense fallback={null}>
            <LazyProductUpdatesSection />
          </Suspense>
        </ViewportDeferredMount>
      </main>

      <SiteFooter />
    </div>
  );
}
