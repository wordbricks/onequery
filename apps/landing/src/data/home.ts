import { DOWNLOAD_COMMAND } from "../landing/config/landing-config";
import type { TerminalLine } from "../landing/terminal/terminal-types";

const querySnippet = `onequery agent debug \\
  --grant prod-debug-readonly \\
  --sentry ISSUE-7421 \\
  --sources sentry,postgres,github,linear`;

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
