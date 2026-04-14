# OneQuery OpenClaw Plugin

OpenClaw plugin that exposes the OneQuery CLI as a small set of optional,
read-only agent tools. It also ships a bundled skill that teaches the agent the
recommended OneQuery workflow.

## Install

From this repository:

```bash
openclaw plugins install -l ./packages/openclaw-plugin
openclaw plugins enable onequery
```

Then enable the plugin's optional tools in `openclaw.json`:

```json5
{
  plugins: {
    entries: {
      onequery: {
        enabled: true,
        config: {
          binaryPath: "onequery",
          defaultMaxRows: 100,
          defaultMaxBytes: 1048576,
          defaultCellMaxChars: 2000,
          defaultQueryTimeoutMs: 60000,
        },
      },
    },
  },
  tools: {
    allow: ["onequery"],
  },
}
```

Adding the plugin id to `tools.allow` enables all of this plugin's optional
tools.

## Tools

- `onequery_auth_whoami`
- `onequery_org_current`
- `onequery_org_list`
- `onequery_source_list`
- `onequery_source_show`
- `onequery_query_validate`
- `onequery_query_exec`

## Behavior

- All commands run through `onequery --output json`.
- Org-scoped source and query tools require an explicit `org`.
- Query tools apply bounded defaults when the caller omits them.
- Query tools reject obviously mutating SQL before the CLI is invoked.
- The bundled `onequery-openclaw` skill teaches the agent to validate before
  execution and keep reads small.
