import type { ProviderType } from "@onequery/db/server";
import { getSourceProviderDefinition } from "@onequery/db/server";

import {
  buildCliSourceConnectCommand,
  buildCliSourceShowCommand,
} from "../cli-defaults";
import type { CliSourceRecord } from "../domain/workflows";

export function buildCliSourceConnectGuide(provider: ProviderType) {
  const definition = getSourceProviderDefinition(provider);
  if (!definition?.connectable) {
    throw new Error(`unsupported source connect provider: ${provider}`);
  }

  return {
    command: buildCliSourceConnectCommand(provider),
    content: buildSourceConnectContent({
      provider,
      summary: definition.guide.summary,
      steps: definition.guide.steps,
      exampleInput: definition.guide.exampleInput,
    }),
    description: `Follow these steps to gather credentials and create one ${provider} org-scoped OneQuery source.`,
    format: "markdown" as const,
    title: "OneQuery Source Connect Guide",
  };
}

export function buildCliSourceConnectResult(source: CliSourceRecord) {
  return {
    nextCommand: buildCliSourceShowCommand(source.sourceKey),
    source,
  };
}

function buildSourceConnectContent(provider: {
  provider: ProviderType;
  summary: string;
  steps: readonly string[];
  exampleInput: Record<string, unknown>;
}): string {
  const lines = [
    "# OneQuery Source Connect Guide",
    "",
    `Provider: \`${provider.provider}\``,
    "",
    "Agent workflow:",
    "1. If this provider requires a browser or dashboard setup flow, do not just ask the user to hand over the final token or secret. Work through the setup with the user step by step.",
    "2. First check whether you already have browser capability in the current environment.",
    "3. If browser capability is missing, install `agent-browser` with `npx skills add https://github.com/vercel-labs/agent-browser --skill agent-browser`, then follow that skill to open a browser and continue the setup with the user.",
    "4. Only use the final credential value when you are ready to build the JSON input and run the connect command.",
    "",
    "Use a CLI-safe `sourceKey` such as `warehouse` or `github_main`.",
    `Run: \`${buildCliSourceConnectCommand(provider.provider)}\``,
    "Verify: `onequery source show <source_key>`",
    "Do not include `organizationId` or `organizationSlug`; the CLI injects org context automatically.",
    'The JSON input shape is always `{ "sourceKey": string, "credentials": { ...provider-specific fields... } }`.',
    "",
    provider.summary,
    "",
    "Steps:",
  ];

  for (const [index, step] of provider.steps.entries()) {
    lines.push(`${index + 1}. ${step}`);
  }
  lines.push("");
  lines.push("Example input:");
  lines.push("```json");
  lines.push(JSON.stringify(provider.exampleInput, null, 2));
  lines.push("```");
  lines.push("");

  return lines.join("\n");
}
