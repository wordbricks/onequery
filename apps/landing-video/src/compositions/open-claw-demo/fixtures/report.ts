export const eventTypeCounts = [
  { name: "PullRequestEvent", count: 28 },
  { name: "PushEvent", count: 24 },
  { name: "CreateEvent", count: 14 },
  { name: "DeleteEvent", count: 12 },
  { name: "IssueCommentEvent", count: 10 },
] as const;

export const repositoryActivityCounts = [
  { name: "openclaw/plugin", count: 72 },
  { name: "openclaw/demo", count: 18 },
  { name: "openclaw/homebrew-tap", count: 6 },
  { name: "openclaw/docs", count: 2 },
  { name: "openclaw/landing", count: 2 },
] as const;

export const mergedPullRequests = [
  {
    number: 142,
    title: "Answer formatting polish for Discord threads",
    author: "lentil32",
    mergedAt: "Apr 17",
  },
  {
    number: 139,
    title: "Discord plugin wiring for OneQuery tool calls",
    author: "kirkh",
    mergedAt: "Apr 16",
  },
  {
    number: 135,
    title: "Demo scene restyling for the landing embed",
    author: "lentil32",
    mergedAt: "Apr 15",
  },
] as const;

export const overviewMetrics = [
  { label: "Events", value: "100", hint: "last 7 days" },
  { label: "Active repos", value: "7", hint: "non-empty" },
  { label: "Merged PRs", value: "11", hint: "plugin repo" },
] as const;

export const reportNarrative =
  "Plugin layer dominates this week - answer formatting, Discord wiring, and demo polish.";

// Comment: Compute panel maxima from the fixtures so visual scale stays correct
// even if the rows are reordered later.
export const maxEventTypeCount = Math.max(
  ...eventTypeCounts.map((eventType) => eventType.count)
);

export const maxRepositoryActivityCount = Math.max(
  ...repositoryActivityCounts.map((repository) => repository.count)
);
