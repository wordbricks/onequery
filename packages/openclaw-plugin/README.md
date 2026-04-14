# OneQuery OpenClaw Plugin

OpenClaw plugin that bundles a `onequery-openclaw` skill. The skill teaches the
agent to use the `onequery` CLI directly through OpenClaw's core `exec` tool
instead of registering a separate wrapper tool surface.

## Install

From this repository:

```bash
openclaw plugins install -l ./packages/openclaw-plugin
openclaw plugins enable onequery
```

Then enable the plugin in `openclaw.json`:

```json5
{
  plugins: {
    entries: {
      onequery: { enabled: true },
    },
  }
}
```

Start a new session after enabling the plugin so OpenClaw reloads the bundled
skill.

## Requirements

- `onequery` must be installed and available on `PATH`.
- The agent needs access to OpenClaw's core `exec` tool.
- If your OpenClaw exec policy uses approvals or allowlists, allow the resolved
  `onequery` binary or enable skill-bin auto-allow for required skill binaries.

## Behavior

- The plugin adds no custom agent tools and has no plugin-specific runtime
  config.
- The bundled `onequery-openclaw` skill teaches the agent to run
  `onequery ... --output json` directly via `exec`.
- The skill keeps the same workflow as before: resolve auth and org context,
  inspect sources, validate unfamiliar SQL first, then execute bounded
  read-only queries.
- For quote-heavy or multiline SQL, the skill prefers `onequery query ... --file
  <path>` over brittle shell escaping.
