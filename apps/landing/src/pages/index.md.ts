import type { APIRoute } from "astro";

import {
  HERO_SIGNALS,
  INSTALL_STEPS,
  QUERY_DETAILS_SNIPPET,
  QUERY_TERMINAL_LINES,
  QUICKSTART_TERMINAL_LINES,
} from "@/features/home/content";
import { ROADMAP_LANES } from "@/features/home/roadmap";
import {
  INSTALL_COMMANDS,
  NPM_PACKAGE_URL,
  REPOSITORY_URL,
  SELF_HOST_DOCS_URL,
} from "@/shared/config/site";
import { ONEQUERY } from "@/shared/seo/constants";

export const prerender = true;

function listItems(items: readonly string[]) {
  return items.map((item) => `- ${item}`).join("\n");
}

function codeBlock(language: string, value: string) {
  return `\`\`\`${language}\n${value.trim()}\n\`\`\``;
}

function installCommands() {
  return INSTALL_COMMANDS.map(
    (command) => `- ${command.label}: \`${command.command}\``
  ).join("\n");
}

function terminalLines(
  lines: readonly { kind: "output" | "prompt"; text: string }[]
) {
  return lines
    .map((line) => `${line.kind === "prompt" ? "$ " : ""}${line.text}`)
    .join("\n");
}

function roadmap() {
  return ROADMAP_LANES.map(
    (lane) =>
      `### ${lane.title}\n\n${lane.items
        .map((item) => `- ${item.title}`)
        .join("\n")}`
  ).join("\n\n");
}

// The Cloudflare build currently emits a shell-only HTML asset for the home
// route, so keep a curated Markdown source for agent bundle generation.
const markdown = `# OneQuery

> ${ONEQUERY.SITE_DESCRIPTION}

OneQuery is a governed production context layer for AI agents. It gives agents a controlled path to approved sources while production credentials stay centralized and every request leaves an audit trail.

## Core Positioning

OneQuery helps teams give AI agents production context, not production keys.

${listItems(HERO_SIGNALS)}

## Install

${installCommands()}

## First Workflow

${INSTALL_STEPS.map((step, index) => `${index + 1}. ${step}`).join("\n")}

${codeBlock("console", terminalLines(QUICKSTART_TERMINAL_LINES))}

## Agent Source API Examples

${codeBlock("console", terminalLines(QUERY_TERMINAL_LINES))}

## Access Record Shape

Each call names an approved source and endpoint. OneQuery sends the request with server-side credentials and records what happened.

${codeBlock("text", QUERY_DETAILS_SNIPPET)}

## Roadmap

${roadmap()}

## Links

- Documentation: https://onequery.dev/docs/
- Connectors: https://onequery.dev/connectors/
- Blog: https://onequery.dev/blog/
- GitHub: ${REPOSITORY_URL}
- CLI package: ${NPM_PACKAGE_URL}
- Self-host docs: ${SELF_HOST_DOCS_URL}
`;

export const GET: APIRoute = () =>
  new Response(markdown, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
    },
  });
