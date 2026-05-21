import {
  CLI_SOURCE_URL,
  DOWNLOAD_COMMAND,
  INSTALL_SCRIPT_URL,
  REPOSITORY_URL,
} from "../config/landing-config";
import type { TerminalLine } from "../terminal/terminal-types";

type FooterLink = {
  href: string;
  label: string;
  trackingName: string;
};

type NavigationItem = {
  href: string;
  label: string;
};

type RoadmapStatus = "shipped" | "next" | "later";

type RoadmapItem = {
  key: string;
  title: string;
};

type RoadmapLane = {
  eyebrow: string;
  items: ReadonlyArray<RoadmapItem>;
  status: RoadmapStatus;
  title: string;
};

const querySnippet = `onequery agent debug \\
  --grant prod-debug-readonly \\
  --sentry ISSUE-7421 \\
  --sources sentry,postgres,github,linear`;

export const FOOTER_LINKS = [
  {
    href: REPOSITORY_URL,
    label: "GitHub",
    trackingName: "footer_github",
  },
  {
    href: CLI_SOURCE_URL,
    label: "CLI source",
    trackingName: "footer_cli_source",
  },
  {
    href: INSTALL_SCRIPT_URL,
    label: "Install script",
    trackingName: "footer_install_script",
  },
] satisfies ReadonlyArray<FooterLink>;

export const HERO_SIGNALS = [
  "No prod keys",
  "No prod writes",
  "Full audit",
] as const;

export const INSTALL_STEPS = [
  "Start gateway.",
  "Apply grant.",
  "Connect sources.",
] as const;

export const NAVIGATION_ITEMS = [
  { href: "#demo", label: "Demo" },
  { href: "#install", label: "Install" },
  { href: "/blog", label: "Blog" },
] satisfies ReadonlyArray<NavigationItem>;

export const ROADMAP_LANES = [
  {
    eyebrow: "Shipped",
    status: "shipped",
    title: "In production today",
    items: [
      {
        key: "read-only-query-validation",
        title: "Read-only query validation",
      },
      {
        key: "audit-log-for-every-query",
        title: "Audit log for every query",
      },
      {
        key: "organization-membership",
        title: "Organization & membership",
      },
      {
        key: "agent-entrypoints",
        title: "Claude Code, OpenClaw, Hermes",
      },
    ],
  },
  {
    eyebrow: "Next up",
    status: "next",
    title: "Production guardrails",
    items: [
      {
        key: "agent-profiles",
        title: "Agent profiles",
      },
      {
        key: "policy-templates",
        title: "Policy templates",
      },
      {
        key: "custom-connectors",
        title: "Custom connectors",
      },
    ],
  },
  {
    eyebrow: "Planned",
    status: "later",
    title: "Security operations",
    items: [
      {
        key: "1password",
        title: "1Password",
      },
      {
        key: "sso-saml",
        title: "SSO & SAML",
      },
      {
        key: "approval-workflow",
        title: "Approvals",
      },
    ],
  },
] satisfies ReadonlyArray<RoadmapLane>;

export const QUERY_DETAILS_SNIPPET = `source     orders-postgres-db
policy     writes blocked
statement  single statement
duration   82 ms
rows       31 returned
budget     $59.20 remaining`;

export const QUICKSTART_TERMINAL_LINES = [
  { kind: "prompt", text: DOWNLOAD_COMMAND },
  { kind: "output", text: "installed onequery under ~/.onequery" },
  { kind: "prompt", text: "onequery gateway start" },
  { kind: "output", text: "gateway listening on http://localhost:5656" },
  { kind: "prompt", text: "onequery grant apply prod-debug-readonly.yaml" },
  { kind: "output", text: "grant ready | credentials hidden" },
] satisfies ReadonlyArray<TerminalLine>;

export const QUERY_TERMINAL_LINES = [
  ...querySnippet.split("\n").map(
    (line, index): TerminalLine => ({
      kind: index === 0 ? "prompt" : "continuation",
      text: line,
    })
  ),
  { kind: "output", text: "grant loaded | credentials hidden" },
  { kind: "output", text: "read sentry + postgres limit 100" },
  { kind: "output", text: "opened PR + Linear issue | audited" },
] satisfies ReadonlyArray<TerminalLine>;
