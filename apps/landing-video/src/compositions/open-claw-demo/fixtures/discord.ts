export const discordChannels = [
  "announcements",
  "launch-room",
  "plugin-demo",
  "shipping",
] as const;

export const activeDiscordChannel = "plugin-demo";

export const discordWorkspace = {
  serverName: "OpenClaw",
  channelName: activeDiscordChannel,
  channelDescription:
    "OpenClaw agent answers GitHub questions using the OneQuery plugin.",
  currentUserName: "OQOQ",
  currentUserStatus: "online",
  assistantName: "Yuha",
} as const;

export const discordAvatarBackgrounds = {
  assistant: "linear-gradient(135deg, #f59e0b, #d97706)",
  currentUser: "linear-gradient(135deg, #7c3aed, #4f46e5)",
} as const;

// Comment: Fixed timestamps keep still renders stable as the demo asset ages.
export const messageTimestamps = {
  userPrompt: "Apr 17 at 2:46 PM",
  runReply: "Apr 17 at 2:46 PM",
  reportReply: "Apr 17 at 2:47 PM",
} as const;

export const userPromptText =
  "run this week's OpenClaw review - group the org events by type and repo, then pull the merged PRs on the plugin repo so I know where the energy is going.";

export const runReplyCopy = {
  beforeSource: "On it - running OneQuery against",
  sourceName: "github-openclaw",
  afterSource: "read-only. I'll aggregate with jq and drop the breakdown here.",
} as const;

export const reportReplyText =
  "Done. Here's the read-only summary from the plugin run, split into activity, repo concentration, and merged PRs.";
