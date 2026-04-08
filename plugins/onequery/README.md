# OneQuery plugin bundle for Claude Code and Codex

This folder is a shared plugin root that carries both plugin manifests:

- `.claude-plugin/plugin.json` for Claude Code
- `.codex-plugin/plugin.json` for Codex

The bundle is intentionally skill-first. It does not ship an MCP server yet.
Instead, the skills guide the agent to use the existing `onequery` CLI and prefer
`--output json` so the model can reason over structured results.

## Included skills

- `local-state` — explicit-only local auth and org-state changes
- `source-connect` — explicit-only source creation workflow

## Local development

### Claude Code

Run Claude Code against this plugin directory:

```bash
claude --plugin-dir ./plugins/onequery
```

Then reload after edits with:

```bash
/reload-plugins
```

### Codex

A repo-local marketplace entry is included at `.agents/plugins/marketplace.json`.
With that file in place:

1. Start or restart Codex from the repository root.
2. Open `/plugins`.
3. Install the `onequery` plugin from the local marketplace.

## Suggested next step

If you want richer structured tool use later, add a thin MCP wrapper around the
OneQuery CLI commands and point both manifests at a shared `.mcp.json`.
