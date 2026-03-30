import {
  CLI_DEFAULT_RELAY_TIMEOUT_MS,
  buildCliUseExecuteCommand,
  buildCliUseIntegrationReminder,
  buildCliUseInspectCommand,
} from "../cli-defaults";

export const CLI_USE_SOURCES = [
  "amplitude",
  "ga",
  "github",
  "mixpanel",
  "mongodb",
  "posthog",
  "sentry",
] as const;

export type CliUseSource = (typeof CLI_USE_SOURCES)[number];

type CliUseSkill = {
  source: CliUseSource;
  title: string;
  description: string;
  format: "markdown";
  content: string;
};

const CLI_USE_PROVIDER_LABELS: Record<CliUseSource, string> = {
  amplitude: "Amplitude",
  ga: "Google Analytics",
  github: "GitHub",
  mixpanel: "Mixpanel",
  mongodb: "MongoDB",
  posthog: "PostHog",
  sentry: "Sentry",
};

type RelaySkillDefinition = {
  source: CliUseSource;
  providerLabel: string;
  description: string;
  methods: readonly string[];
  example: string;
  notes: readonly string[];
};

function buildRelaySkillContent(input: RelaySkillDefinition): string {
  const methods = input.methods.map((method) => `- \`${method}\``).join("\n");
  const notes = input.notes.map((note) => `- ${note}`).join("\n");

  return [
    `# OneQuery ${input.providerLabel} Relay Skill`,
    "",
    "Use this when a OneQuery-connected source is visible in the product but `oneq query` does not support SQL for that provider.",
    "",
    "## Preferred CLI Workflow",
    "1. Resolve the target org slug and set it with `oneq org use <slug>` or pass `--org <slug>`.",
    `2. Inspect this skill with \`${buildCliUseInspectCommand(input.source)}\`.`,
    `3. Execute the relay with \`${buildCliUseExecuteCommand(input.source)}\`.`,
    "4. The CLI injects `organizationSlug` automatically. Do not include `organizationId` or `organizationSlug` in `--input`.",
    "5. Keep requests narrow with explicit limits, date windows, filters, or collection names.",
    "",
    "## Methods",
    methods,
    "",
    "## CLI Example",
    "```json",
    input.example.trim(),
    "```",
    "",
    "## Guardrails",
    "- Prefer the smallest useful read and widen only if needed.",
    "- Treat `404` as missing or inactive source configuration inside OneQuery.",
    "- Treat `409` as a OneQuery configuration problem: multiple active/default sources need cleanup.",
    "- Do not fall back to `oneq query` SQL for this provider unless OneQuery explicitly marks it queryable later.",
    notes,
  ].join("\n");
}

const CLI_USE_SKILL_REGISTRY: Record<CliUseSource, CliUseSkill> = {
  amplitude: {
    source: "amplitude",
    title: "OneQuery Amplitude Relay Skill",
    description:
      "Use the Amplitude relay route instead of SQL for a OneQuery-connected Amplitude source.",
    format: "markdown",
    content: buildRelaySkillContent({
      source: "amplitude",
      providerLabel: "Amplitude",
      description:
        "Use the Amplitude relay route instead of SQL for a OneQuery-connected Amplitude source.",
      methods: ["fetch_api"],
      example: `{
  "method": "fetch_api",
  "request": {
    "endpoint": "/2/events/segmentation",
    "options": {
      "params": {
        "e": "[{\\"event_type\\":\\"Signup\\"}]",
        "start": "2026-03-01",
        "end": "2026-03-07"
      },
      "timeoutMs": ${CLI_DEFAULT_RELAY_TIMEOUT_MS}
    }
  }
}`,
      notes: [
        "Use Amplitude REST endpoints and pass query/body options through `request.options`.",
      ],
    }),
  },
  ga: {
    source: "ga",
    title: "OneQuery Google Analytics Relay Skill",
    description:
      "Use the Google Analytics relay route instead of SQL for a OneQuery-connected GA source.",
    format: "markdown",
    content: buildRelaySkillContent({
      source: "ga",
      providerLabel: "Google Analytics",
      description:
        "Use the Google Analytics relay route instead of SQL for a OneQuery-connected GA source.",
      methods: ["run_report", "run_realtime_report"],
      example: `{
  "method": "run_report",
  "request": {
    "property": "properties/123456789",
    "dateRanges": [{ "startDate": "7daysAgo", "endDate": "today" }],
    "dimensions": [{ "name": "date" }],
    "metrics": [{ "name": "activeUsers" }],
    "limit": 100
  }
}`,
      notes: [
        "If the request omits `property`, OneQuery will try the property saved on the data source.",
      ],
    }),
  },
  github: {
    source: "github",
    title: "OneQuery GitHub Relay Skill",
    description:
      "Use the GitHub relay route instead of SQL for a OneQuery-connected GitHub source.",
    format: "markdown",
    content: [
      "# OneQuery GitHub Relay Skill",
      "",
      "Use this when a OneQuery-connected GitHub source is visible in the product but `oneq query` does not support SQL for GitHub.",
      "",
      "## Preferred CLI Workflow",
      "1. Confirm the org already has an active GitHub integration in OneQuery. If not, stop and ask the user to connect GitHub from the Integrations page first.",
      "2. Resolve the target org slug and set it with `oneq org use <slug>` or pass `--org <slug>`.",
      `3. Inspect this skill with \`${buildCliUseInspectCommand("github")}\`.`,
      `4. Execute the relay with \`${buildCliUseExecuteCommand("github")}\`.`,
      "5. The CLI injects `organizationSlug` automatically. Do not include `organizationId` or `organizationSlug` in `--input`.",
      "",
      "## CLI Input Shape",
      "- `fetch_api`",
      "",
      "## Preferred Examples",
      "When one repository is selected on the GitHub data source, prefer repo-relative endpoints:",
      "```json",
      `{
  "method": "fetch_api",
  "request": {
    "endpoint": "/pulls",
    "options": {
      "params": {
        "per_page": 25,
        "state": "open"
      }
    }
  }
}`,
      "```",
      "",
      "When multiple repositories are selected, keep the endpoint repo-relative and add `request.repository`:",
      "```json",
      `{
  "method": "fetch_api",
  "request": {
    "endpoint": "/pulls",
    "repository": "octocat/Hello-World",
    "options": {
      "params": {
        "per_page": 25,
        "state": "open"
      }
    }
  }
}`,
      "```",
      "",
      "## Notes",
      "- Prefer repo-relative endpoints such as `/pulls`, `/issues`, `/contents/README.md`, `/branches`, and `/releases` so OneQuery can apply the repository selection already saved on the data source.",
      "- Use `fetch_api` for most GitHub REST endpoints. The endpoint may be a relative GitHub REST path or a full `https://api.github.com/...` or `https://uploads.github.com/...` URL.",
      "- If OneQuery reports that no active GitHub data source is available for the org, stop and tell the user to integrate GitHub first instead of retrying the relay.",
      "- When the GitHub data source already has selected repositories, OneQuery uses that selection. Repo-scoped endpoints such as `/pulls`, `/issues`, `/contents/...`, `/branches`, and `/releases` resolve against the selected repo.",
      "- If exactly one repository is selected, repo-scoped endpoints may omit `request.repository`. If multiple repositories are selected, pass `request.repository` as `<owner>/<repo>`.",
      "- If you send an explicit `/repos/<owner>/<repo>/...` path or full URL, it must target a repository that is already selected on the GitHub data source.",
      "- Pass custom `Accept`, `Content-Type`, or `X-GitHub-Api-Version` headers through `request.options.headers` when a GitHub endpoint requires them.",
      '- Use `bodyBase64` only for binary uploads. Binary responses are returned as base64 with `type: "binary"`.',
      "- Account-level endpoints such as `/user` or `/search/issues` still work directly and do not use repository selection.",
    ].join("\n"),
  },
  mixpanel: {
    source: "mixpanel",
    title: "OneQuery Mixpanel Relay Skill",
    description:
      "Use the Mixpanel relay route instead of SQL for a OneQuery-connected Mixpanel source.",
    format: "markdown",
    content: buildRelaySkillContent({
      source: "mixpanel",
      providerLabel: "Mixpanel",
      description:
        "Use the Mixpanel relay route instead of SQL for a OneQuery-connected Mixpanel source.",
      methods: [
        "query_engage",
        "query_segmentation",
        "fetch_query_api",
        "export_events",
      ],
      example: `{
  "method": "query_segmentation",
  "request": {
    "event": "Signup",
    "fromDate": "2026-03-01",
    "toDate": "2026-03-07",
    "type": "general",
    "unit": "day"
  }
}`,
      notes: [
        "Use `fetch_query_api` only when the higher-level Mixpanel methods do not cover the endpoint you need.",
      ],
    }),
  },
  mongodb: {
    source: "mongodb",
    title: "OneQuery MongoDB Relay Skill",
    description:
      "Use the MongoDB relay route instead of SQL for a OneQuery-connected MongoDB source.",
    format: "markdown",
    content: buildRelaySkillContent({
      source: "mongodb",
      providerLabel: "MongoDB",
      description:
        "Use the MongoDB relay route instead of SQL for a OneQuery-connected MongoDB source.",
      methods: ["list_databases", "list_collections", "find_documents"],
      example: `{
  "method": "find_documents",
  "request": {
    "database": "app",
    "collection": "users",
    "filter": { "plan": "pro" },
    "projection": { "email": 1, "plan": 1 },
    "limit": 25,
    "sort": { "_id": -1 }
  }
}`,
      notes: [
        "Start with `list_databases` or `list_collections` when the collection name is uncertain.",
      ],
    }),
  },
  posthog: {
    source: "posthog",
    title: "OneQuery PostHog Relay Skill",
    description:
      "Use the PostHog relay route instead of SQL for a OneQuery-connected PostHog source.",
    format: "markdown",
    content: buildRelaySkillContent({
      source: "posthog",
      providerLabel: "PostHog",
      description:
        "Use the PostHog relay route instead of SQL for a OneQuery-connected PostHog source.",
      methods: ["run_query"],
      example: `{
  "method": "run_query",
  "request": {
    "query": {
      "kind": "HogQLQuery",
      "query": "select event, count() from events where timestamp >= now() - interval 7 day group by event order by count() desc limit 20"
    },
    "timeoutMs": ${CLI_DEFAULT_RELAY_TIMEOUT_MS}
  }
}`,
      notes: [
        "The request body must wrap the provider query in `request.query`.",
      ],
    }),
  },
  sentry: {
    source: "sentry",
    title: "OneQuery Sentry Relay Skill",
    description:
      "Use the Sentry relay route instead of SQL for a OneQuery-connected Sentry source.",
    format: "markdown",
    content: buildRelaySkillContent({
      source: "sentry",
      providerLabel: "Sentry",
      description:
        "Use the Sentry relay route instead of SQL for a OneQuery-connected Sentry source.",
      methods: ["fetch_api"],
      example: `{
  "method": "fetch_api",
  "request": {
    "endpoint": "/api/0/organizations/acme/issues/",
    "options": {
      "params": {
        "query": "is:unresolved level:error",
        "limit": 25
      },
      "timeoutMs": ${CLI_DEFAULT_RELAY_TIMEOUT_MS}
    }
  }
}`,
      notes: [
        "Prefer issue, event, release, and stats endpoints with explicit filters and limits.",
      ],
    }),
  },
};

export function getCliUseSkill(source: CliUseSource): CliUseSkill {
  return CLI_USE_SKILL_REGISTRY[source];
}

export function getCliUseIntegrationRequiredSkill(input: {
  source: CliUseSource;
  orgSlug: string;
}): CliUseSkill {
  const providerLabel = CLI_USE_PROVIDER_LABELS[input.source];

  return {
    source: input.source,
    title: `OneQuery ${providerLabel} Connection Required`,
    description: `Connect a ${providerLabel} source in OneQuery before using the ${providerLabel} relay.`,
    format: "markdown",
    content: [
      `# OneQuery ${providerLabel} Connection Required`,
      "",
      `No active ${providerLabel} source is connected to org \`${input.orgSlug}\`.`,
      "",
      buildCliUseIntegrationReminder(providerLabel, input.source),
      "",
      "## Next Step",
      "1. Open the org's Integrations page in OneQuery.",
      `2. Connect ${providerLabel} and finish the authorization flow.`,
      "3. Confirm the source appears as active in OneQuery.",
      `4. Rerun \`${buildCliUseInspectCommand(input.source)}\`.`,
    ].join("\n"),
  };
}
