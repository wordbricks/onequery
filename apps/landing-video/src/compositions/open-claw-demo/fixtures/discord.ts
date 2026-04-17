export const discordChannels = [
  "announcements",
  "launch-room",
  "github-research",
  "shipping",
] as const;

export const activeDiscordChannel = "github-research";

export const discordWorkspace = {
  serverName: "OpenClaw",
  channelName: activeDiscordChannel,
  channelDescription:
    "Live OpenClaw org analysis through the OneQuery GitHub source.",
  currentUserName: "OQOQ",
  currentUserStatus: "online",
  assistantName: "Yuha",
} as const;

export const discordAvatarBackgrounds = {
  assistant: "#f4f3ee",
  currentUser: "linear-gradient(135deg, #7c3aed, #4f46e5)",
} as const;

// Comment: Fixed timestamps keep the still frame stable even though the
// underlying GitHub data is time-sensitive.
export const messageTimestamps = {
  userPrompt: "Apr 17 at 3:47 PM",
  runReply: "Apr 17 at 3:47 PM",
  reportReply: "Apr 17 at 3:48 PM",
} as const;

export const userPromptText =
  "scan the openclaw GitHub org - break down the recent public events by type, rank the repos by stars, and show the latest merged PRs on openclaw/openclaw.";

export const runReplyCopy = {
  beforeSource: "On it - querying the live org through",
  sourceName: "github",
  afterSource:
    "read-only. I'll aggregate the API output and post the snapshot here.",
} as const;

export const reportReplyText =
  "Done. Here's the live snapshot from the GitHub source: recent event mix, top repos by stars, and the latest merged PRs in openclaw/openclaw.";
