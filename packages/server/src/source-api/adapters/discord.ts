import type { DiscordCredentials } from "@onequery/db/server";

import { createSimpleRestSourceApiAdapter } from "./simple-rest";

const DISCORD_DEFAULT_API_BASE_URL = "https://discord.com/api/v10";
const DISCORD_DESCRIPTOR_VERSION = "discord.v1";

export const discordSourceApiAdapter =
  createSimpleRestSourceApiAdapter<DiscordCredentials>({
    allowedRequestHeaders: ["Accept", "Content-Type", "X-Audit-Log-Reason"],
    apiBaseUrl: (credentials) =>
      credentials.apiBaseUrl ?? DISCORD_DEFAULT_API_BASE_URL,
    auth: (credentials) =>
      credentials.authScheme === "bearer"
        ? { token: credentials.token, type: "bearer" }
        : { type: "raw", value: `Bot ${credentials.token}` },
    buildEndpoint: ({ credentials, selector }) =>
      buildDiscordEndpoint({ guildId: credentials.guildId, selector }),
    buildExamples: (sourceKey) => [
      {
        command: `onequery api --source ${sourceKey} /channels`,
        description:
          "List channels from the configured guild ID when the source includes `guildId`.",
        label: "List guild channels",
      },
      {
        command: `onequery api --source ${sourceKey} /channels/123456789012345678/messages -f params[limit]=50`,
        description: "Fetch recent messages from a channel.",
        label: "List channel messages",
      },
    ],
    descriptorVersion: DISCORD_DESCRIPTOR_VERSION,
    notes: [
      "Discord message content may be empty unless the application has the Message Content privileged intent where Discord requires it.",
    ],
    operationNotes: [
      "When `guildId` is configured, selector `/channels` expands to `/guilds/<guildId>/channels`.",
      "Use explicit Discord REST paths for channel, message, guild, and user endpoints.",
    ],
    provider: "discord",
    providerLabel: "Discord",
  });

function buildDiscordEndpoint(input: {
  guildId: string | undefined;
  selector: string;
}): string {
  if (input.guildId && input.selector === "/channels") {
    return `/guilds/${encodeURIComponent(input.guildId)}/channels`;
  }
  return input.selector;
}
