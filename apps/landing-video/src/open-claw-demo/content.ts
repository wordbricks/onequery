import { surfaces } from "./theme";

export type CommandSegment = {
  text: string;
  color: string;
};

export const COMMANDS = {
  eventsByType: [
    { text: "onequery", color: surfaces.terminalCmd },
    { text: " api", color: surfaces.terminalSub },
    { text: " --source ", color: surfaces.terminalFlag },
    { text: "github-openclaw", color: surfaces.terminalPath },
    { text: " /orgs/openclaw/events", color: surfaces.terminalPath },
    { text: " -F ", color: surfaces.terminalFlag },
    { text: "'params[per_page]=100'", color: surfaces.terminalString },
    { text: " -q ", color: surfaces.terminalFlag },
    {
      text: "'group_by(.type) | map({type: .[0].type, count: length}) | sort_by(-.count)'",
      color: surfaces.terminalJq,
    },
  ],
  reposByActivity: [
    { text: "onequery", color: surfaces.terminalCmd },
    { text: " api", color: surfaces.terminalSub },
    { text: " --source ", color: surfaces.terminalFlag },
    { text: "github-openclaw", color: surfaces.terminalPath },
    { text: " /orgs/openclaw/events", color: surfaces.terminalPath },
    { text: " -F ", color: surfaces.terminalFlag },
    { text: "'params[per_page]=100'", color: surfaces.terminalString },
    { text: " -q ", color: surfaces.terminalFlag },
    {
      text: "'group_by(.repo.name) | map({repo: .[0].repo.name, count: length}) | sort_by(-.count) | .[:5]'",
      color: surfaces.terminalJq,
    },
  ],
  mergedPulls: [
    { text: "onequery", color: surfaces.terminalCmd },
    { text: " api", color: surfaces.terminalSub },
    { text: " --source ", color: surfaces.terminalFlag },
    { text: "github-openclaw", color: surfaces.terminalPath },
    { text: " /repos/openclaw/plugin/pulls", color: surfaces.terminalPath },
    { text: " -f ", color: surfaces.terminalFlag },
    { text: "'params[state]=closed'", color: surfaces.terminalString },
    { text: " -F ", color: surfaces.terminalFlag },
    { text: "'params[sort]=updated'", color: surfaces.terminalString },
    { text: " -F ", color: surfaces.terminalFlag },
    { text: "'params[per_page]=10'", color: surfaces.terminalString },
    { text: " -q ", color: surfaces.terminalFlag },
    {
      text: "'map({number, title, user: .user.login, merged_at})'",
      color: surfaces.terminalJq,
    },
  ],
} as const satisfies Record<string, readonly CommandSegment[]>;

export const EVENT_TYPES = [
  { type: "PullRequestEvent", count: 28 },
  { type: "PushEvent", count: 24 },
  { type: "CreateEvent", count: 14 },
  { type: "DeleteEvent", count: 12 },
  { type: "IssueCommentEvent", count: 10 },
] as const;

export const TOP_REPOS = [
  { name: "openclaw/plugin", count: 72 },
  { name: "openclaw/demo", count: 18 },
  { name: "openclaw/homebrew-tap", count: 6 },
  { name: "openclaw/docs", count: 2 },
  { name: "openclaw/landing", count: 2 },
] as const;

export const MERGED_PRS = [
  {
    number: 142,
    title: "Answer formatting polish for Discord threads",
    user: "lentil32",
    when: "2h ago",
  },
  {
    number: 139,
    title: "Discord plugin wiring for OneQuery tool calls",
    user: "kirkh",
    when: "yesterday",
  },
  {
    number: 135,
    title: "Demo scene restyling for the landing embed",
    user: "lentil32",
    when: "2d ago",
  },
] as const;

export const OVERVIEW = [
  { label: "Events", value: "100", hint: "last 7 days" },
  { label: "Active repos", value: "7", hint: "non-empty" },
  { label: "Merged PRs", value: "11", hint: "plugin repo" },
] as const;

export const CHANNELS = [
  "announcements",
  "launch-room",
  "plugin-demo",
  "shipping",
] as const;

export const ACTIVE_CHANNEL = "plugin-demo";

export const USER_PROMPT =
  "run this week's OpenClaw review — group the org events by type and repo, then pull the merged PRs on the plugin repo so I know where the energy is going.";

export const RUN_MESSAGE =
  "On it — running OneQuery against github-openclaw read-only. I'll aggregate with jq and drop the breakdown here.";

export const REPORT_MESSAGE =
  "Done. Here's the read-only summary from the plugin run, split into activity, repo concentration, and merged PRs.";

export const NARRATIVE =
  "Plugin layer dominates this week — answer formatting, Discord wiring, and demo polish.";
