import { surfaceTokens } from "../tokens";

export type CommandSegment = {
  text: string;
  color: string;
};

const oneQueryApiSegments = [
  { text: "onequery", color: surfaceTokens.terminalCommand },
  { text: " api", color: surfaceTokens.terminalSubcommand },
  { text: " --source ", color: surfaceTokens.terminalFlag },
  { text: "github-openclaw", color: surfaceTokens.terminalPath },
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
  repositoryActivityBreakdown: createOneQueryCommand("/orgs/openclaw/events", [
    ...createStringFlagSegments("-F", "'params[per_page]=100'"),
    ...createJqFilterSegments(
      "'group_by(.repo.name) | map({repo: .[0].repo.name, count: length}) | sort_by(-.count) | .[:5]'"
    ),
  ]),
  mergedPullRequestSummary: createOneQueryCommand(
    "/repos/openclaw/plugin/pulls",
    [
      ...createStringFlagSegments("-f", "'params[state]=closed'"),
      ...createStringFlagSegments("-F", "'params[sort]=updated'"),
      ...createStringFlagSegments("-F", "'params[per_page]=10'"),
      ...createJqFilterSegments(
        "'map({number, title, user: .user.login, merged_at})'"
      ),
    ]
  ),
} as const satisfies Record<string, readonly CommandSegment[]>;

export const terminalStepSummaries = {
  eventTypeBreakdown: "-> 100 events | 7 types | 612 ms",
  repositoryActivityBreakdown: "-> 5 repos ranked | 58 ms",
  mergedPullRequestSummary: "-> 11 merged PRs | 28 files changed | 812 ms",
} as const;
