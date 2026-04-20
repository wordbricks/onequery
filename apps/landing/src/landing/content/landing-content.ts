import {
  LANDING_CLI_SOURCE_URL,
  LANDING_DOWNLOAD_COMMAND,
  LANDING_INSTALL_SCRIPT_URL,
  LANDING_REPOSITORY_URL,
  LANDING_SECTION_IDS,
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
    href: LANDING_REPOSITORY_URL,
    label: "GitHub",
    trackingName: "footer_github",
  },
  {
    href: LANDING_CLI_SOURCE_URL,
    label: "CLI source",
    trackingName: "footer_cli_source",
  },
  {
    href: LANDING_INSTALL_SCRIPT_URL,
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
  { href: `#${LANDING_SECTION_IDS.surface}`, label: "Product" },
  { href: `#${LANDING_SECTION_IDS.install}`, label: "Install" },
  { href: `#${LANDING_SECTION_IDS.workflow}`, label: "Workflow" },
] satisfies ReadonlyArray<NavigationItem>;

export const QUERY_DETAILS_SNIPPET = `source       warehouse
policy       read-only passed
statement    single statement
duration     842 ms
rows         7 returned
budget       $4.2k remaining`;

export const QUICKSTART_TERMINAL_LINES = [
  { kind: "prompt", text: LANDING_DOWNLOAD_COMMAND },
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
