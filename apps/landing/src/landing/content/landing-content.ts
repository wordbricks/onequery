import {
  CLI_SOURCE_URL,
  DOWNLOAD_COMMAND,
  INSTALL_SCRIPT_URL,
  REPOSITORY_URL,
  SECTION_IDS,
} from "../config/landing-config";
import type { TerminalLine } from "../terminal/terminal-surface";

type FooterLink = {
  href: string;
  label: string;
  trackingName: string;
};

type NavigationItem = {
  href: string;
  label: string;
};

export type RoadmapStatus = "shipped" | "next" | "later";

export type RoadmapItem = {
  key: string;
  title: string;
  description: string;
};

export type RoadmapLane = {
  eyebrow: string;
  items: ReadonlyArray<RoadmapItem>;
  status: RoadmapStatus;
  title: string;
};

const querySnippet = `onequery query exec \\
  --source warehouse \\
  --sql "select date_trunc('day', occurred_at) as day, \\
                sum(total_usd) as spend \\
         from agent_runs \\
         group by 1 \\
         order by 1 desc \\
         limit 7"`;

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
  "Self-host the gateway with `onequery gateway start`.",
  "Keep the CLI and browser pointed at the same runtime state.",
  "Centralize budgets, policies, and source access in one control plane.",
] as const;

export const INSTALL_STEPS = [
  "Install the CLI with the script, Homebrew, npm, or Bun.",
  "Start the self-hosted gateway with `onequery gateway start`.",
  "Open the local UI to bootstrap the first user, then run `onequery auth login`.",
  "Connect a source and execute queries from the CLI or the browser against the same gateway.",
] as const;

export const NAVIGATION_ITEMS = [
  { href: `#${SECTION_IDS.surface}`, label: "Product" },
  { href: `#${SECTION_IDS.install}`, label: "Install" },
  { href: `#${SECTION_IDS.workflow}`, label: "Workflow" },
  { href: `#${SECTION_IDS.roadmap}`, label: "Roadmap" },
] satisfies ReadonlyArray<NavigationItem>;

export const ROADMAP_LANES = [
  {
    eyebrow: "Shipped",
    status: "shipped",
    title: "In production today",
    items: [
      {
        key: "read-only-validation",
        title: "Read-only query validation",
        description:
          "Every statement is parsed and screened for writes and side effects before it reaches a connected source. Unsafe SQL is rejected, not guessed at.",
      },
      {
        key: "audit-log",
        title: "Audit log for every query",
        description:
          "Operator and agent queries are captured with identity, statement text, duration, row count, and policy outcome. Anything that touched a source is reviewable.",
      },
      {
        key: "organization-membership",
        title: "Organization & membership",
        description:
          "Invite engineers, analysts, and agents into a single org. Roles scope who can connect a source, run a query, or read the audit log.",
      },
    ],
  },
  {
    eyebrow: "Next up",
    status: "next",
    title: "Actively being built",
    items: [
      {
        key: "1password",
        title: "1Password integration",
        description:
          "Resolve source credentials and connection secrets from a shared 1Password vault so they never live on operator laptops or in env files.",
      },
      {
        key: "agent-profiles",
        title: "Agent profiles",
        description:
          "Each agent gets its own permission set and source list. Two agents on the same gateway can be pointed at two completely different surfaces.",
      },
      {
        key: "hermes-plugin",
        title: "Hermes Agent plugin",
        description:
          "A first-party plugin so Hermes agents call OneQuery through the same safe gateway as every other operator — same audit, same budget, same policy.",
      },
      {
        key: "custom-connectors",
        title: "Custom connectors",
        description:
          "A connector manifest and SDK for the systems that aren't in the built-in catalog. Ship your own and keep everything else on the OneQuery rails.",
      },
    ],
  },
  {
    eyebrow: "Planned",
    status: "later",
    title: "Coming after that",
    items: [
      {
        key: "sso-saml",
        title: "SSO & SAML",
        description:
          "Sign in with Okta, Azure AD, or any SAML/OIDC provider. Required once OneQuery becomes shared infra inside a larger org.",
      },
      {
        key: "scheduled-queries",
        title: "Scheduled read-only queries",
        description:
          "Run a query on a cron and forward the result to Slack, email, or a webhook. The same policy and audit log still apply.",
      },
      {
        key: "approval-workflow",
        title: "Query approval workflows",
        description:
          "Escalate sensitive or over-budget queries to a reviewer inline. Operators ship the riskier ones without turning off the safety net.",
      },
    ],
  },
] satisfies ReadonlyArray<RoadmapLane>;

export const QUERY_DETAILS_SNIPPET = `source       warehouse
policy       read-only passed
statement    single statement
duration     842 ms
rows         7 returned
budget       $4.2k remaining`;

export const QUICKSTART_TERMINAL_LINES = [
  { kind: "prompt", text: DOWNLOAD_COMMAND },
  { kind: "output", text: "downloaded @onequery/cli to ~/.local/bin" },
  { kind: "prompt", text: "onequery gateway start" },
  { kind: "output", text: "gateway listening on http://localhost:5656" },
  { kind: "prompt", text: "onequery auth login" },
  { kind: "output", text: "signed in as owner@acme.dev · org acme-org" },
] satisfies ReadonlyArray<TerminalLine>;

export const QUERY_TERMINAL_LINES = [
  ...querySnippet.split("\n").map(
    (line, index): TerminalLine => ({
      kind: index === 0 ? "prompt" : "continuation",
      text: line,
    })
  ),
  { kind: "output", text: "7 rows returned from warehouse · 842 ms" },
  { kind: "output", text: "latest day: 2026-04-13 · spend: $12,481.32" },
] satisfies ReadonlyArray<TerminalLine>;
