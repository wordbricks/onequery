import type { TerminalLine } from "@/features/home/terminal/types";
import { INSTALL_COMMANDS } from "@/shared/config/site";

const agentToolCommands = [
  "onequery api --source github://demo-prod acme/web/pulls --paginate --max-pages 2 --jq '.[] | {number,title,user,head,base}' --json",
  "onequery api --source github://demo-prod /repos/acme/web/commits?sha=main --json",
  "onequery api --source sentry://demo-org /api/0/projects/acme/web/issues/?query=is:unresolved --json",
  "onequery api --source slack://demo-org /api/conversations.history -F channel=C123 -F limit=20 --json",
] as const;

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

export const QUERY_DETAILS_SNIPPET = `source      github://demo-prod
endpoint    acme/web/pulls
actor       agent session
token       never exposed
policy      read-only
audit       source, endpoint, caller, time`;

export const QUICKSTART_TERMINAL_LINES = [
  { kind: "prompt", text: INSTALL_COMMANDS[0].command },
  { kind: "output", text: "installed onequery under ~/.onequery" },
  { kind: "prompt", text: "onequery gateway start" },
  { kind: "output", text: "gateway listening on http://localhost:5656" },
  { kind: "prompt", text: "onequery grant apply prod-debug-readonly.yaml" },
  { kind: "output", text: "grant ready | credentials hidden" },
] satisfies ReadonlyArray<TerminalLine>;

export const QUERY_TERMINAL_LINES = [
  { kind: "prompt", text: agentToolCommands[0] },
  { kind: "output", text: "200 OK | 2 pages | credentials hidden" },
  { kind: "prompt", text: agentToolCommands[1] },
  { kind: "output", text: "200 OK | commits returned | audited" },
  { kind: "prompt", text: agentToolCommands[2] },
  { kind: "output", text: "200 OK | unresolved issues | read-only" },
  { kind: "prompt", text: agentToolCommands[3] },
  { kind: "output", text: "200 OK | 20 messages | audited" },
] satisfies ReadonlyArray<TerminalLine>;
