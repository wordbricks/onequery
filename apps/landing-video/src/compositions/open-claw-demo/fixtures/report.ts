const formatCompactCount = (count: number) => {
  if (count >= 100_000) {
    return `${Math.round(count / 1000)}k`;
  }

  if (count >= 1_000) {
    return `${(count / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  }

  return `${count}`;
};

// Comment: These report fixtures mirror a live `onequery api --source github`
// capture against `openclaw` from Apr 17, 2026.
export const eventTypeCounts = [
  { name: "PullRequestEvent", count: 17 },
  { name: "WatchEvent", count: 17 },
  { name: "PullRequestReviewCommentEvent", count: 15 },
  { name: "PullRequestReviewEvent", count: 14 },
  { name: "PushEvent", count: 13 },
] as const;

export const topRepositoryStars = [
  {
    name: "openclaw/openclaw",
    count: 359059,
    valueText: formatCompactCount(359059),
  },
  {
    name: "openclaw/clawhub",
    count: 8050,
    valueText: formatCompactCount(8050),
  },
  {
    name: "openclaw/skills",
    count: 4157,
    valueText: formatCompactCount(4157),
  },
  {
    name: "openclaw/acpx",
    count: 2155,
    valueText: formatCompactCount(2155),
  },
  {
    name: "openclaw/lobster",
    count: 1128,
    valueText: formatCompactCount(1128),
  },
] as const;

export const mergedPullRequests = [
  {
    number: 67876,
    title: "fix(auth): serialize OAuth refresh across agents to fix #26322",
    author: "visionik",
    mergedAt: "06:44 UTC",
  },
  {
    number: 67643,
    title: "matrix: fix sessions_spawn --thread subagent session spawning",
    author: "eejohnso-ops",
    mergedAt: "06:17 UTC",
  },
  {
    number: 67993,
    title: "fix(telegram): clear compaction replay after visible boundaries",
    author: "obviyus",
    mergedAt: "05:48 UTC",
  },
] as const;

const recentPublicEventTotal = 98;

export const overviewMetrics = [
  {
    label: "Events",
    value: `${recentPublicEventTotal}`,
    hint: "recent public feed",
  },
  {
    label: "Repos",
    value: `${topRepositoryStars.length}`,
    hint: "ranked by stars",
  },
  {
    label: "Merged PRs",
    value: `${mergedPullRequests.length}`,
    hint: "openclaw/openclaw",
  },
] as const;

export const reportNarrative =
  "Recent public activity is concentrated in openclaw/openclaw, and the star curve drops sharply after the flagship repo.";

// Comment: Compute panel maxima from the fixtures so visual scale stays correct
// even if the rows are reordered later.
export const maxEventTypeCount = Math.max(
  ...eventTypeCounts.map((eventType) => eventType.count)
);

export const maxTopRepositoryStarCount = Math.max(
  ...topRepositoryStars.map((repository) => repository.count)
);
