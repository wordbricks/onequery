import { surfaceTokens } from "../tokens";

export type CommandSegment = {
  text: string;
  color: string;
};

// Comment: Keep these command fixtures aligned with the live `onequery api`
// capture that backs the report fixtures.
const oneQueryApiSegments = [
  { text: "onequery", color: surfaceTokens.terminalCommand },
  { text: " api", color: surfaceTokens.terminalSubcommand },
  { text: " --request-id ", color: surfaceTokens.terminalFlag },
  { text: "openclaw-org-scan", color: surfaceTokens.terminalPath },
  { text: " --source ", color: surfaceTokens.terminalFlag },
  { text: "github://wordbricks", color: surfaceTokens.terminalPath },
] as const satisfies readonly CommandSegment[];

const createStringFlagSegments = (flag: string, value: string) =>
  [
    { text: ` ${flag} `, color: surfaceTokens.terminalFlag },
    { text: value, color: surfaceTokens.terminalString },
  ] as const satisfies readonly CommandSegment[];

const createJqFilterSegments = (expression: string) =>
  [
    { text: " -q ", color: surfaceTokens.terminalFlag },
    { text: expression, color: surfaceTokens.terminalJq },
  ] as const satisfies readonly CommandSegment[];

const createOneQueryCommand = (
  resourcePath: string,
  trailingSegments: readonly CommandSegment[]
) =>
  [
    ...oneQueryApiSegments,
    { text: ` ${resourcePath}`, color: surfaceTokens.terminalPath },
    ...trailingSegments,
  ] as const satisfies readonly CommandSegment[];

export const terminalCommands = {
  eventTypeBreakdown: createOneQueryCommand("/orgs/openclaw/events", [
    ...createStringFlagSegments("-F", "'params[per_page]=100'"),
    ...createJqFilterSegments(
      "'group_by(.type) | map({type: .[0].type, count: length}) | sort_by(-.count)'"
    ),
  ]),
  topRepoStars: createOneQueryCommand("/orgs/openclaw/repos", [
    ...createStringFlagSegments("-F", "'params[per_page]=100'"),
    ...createJqFilterSegments(
      "'sort_by(-.stargazers_count) | map({repo: .full_name, stars: .stargazers_count}) | .[:5]'"
    ),
  ]),
  mergedPullRequestSummary: createOneQueryCommand(
    "/repos/openclaw/openclaw/pulls",
    [
      ...createStringFlagSegments("-f", "'params[state]=closed'"),
      ...createStringFlagSegments("-F", "'params[sort]=updated'"),
      ...createStringFlagSegments("-F", "'params[direction]=desc'"),
      ...createStringFlagSegments("-F", "'params[per_page]=100'"),
      ...createJqFilterSegments(
        "'map(select(.merged_at != null)) | sort_by(.merged_at) | reverse | map({number, title, user: .user.login, merged_at}) | .[:3]'"
      ),
    ]
  ),
} as const satisfies Record<string, readonly CommandSegment[]>;

export const terminalStepSummaries = {
  eventTypeBreakdown: "-> 98 recent public events | 9 event types",
  topRepoStars: "-> 5 repos ranked by stars",
  mergedPullRequestSummary: "-> 3 recent merged PRs",
} as const;
