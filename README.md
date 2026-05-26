# OneQuery

<p align="center">
  <strong>English</strong> | <a href="./README.zh-CN.md">中文</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@onequery/cli"><img src="https://img.shields.io/npm/dm/@onequery/cli?style=flat-square" alt="npm downloads"></a>
  <a href="https://onequery.dev"><img src="https://img.shields.io/badge/Site-onequery.dev-blue?style=flat-square" alt="Site"></a>
  <a href="https://github.com/wordbricks/onequery/releases"><img src="https://img.shields.io/github/v/release/wordbricks/onequery?display_name=release&style=flat-square" alt="Release"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/github/license/wordbricks/onequery?style=flat-square" alt="License"></a>
</p>

**Self-host OneQuery to connect databases, analytics tools, and APIs, manage credentials centrally, and run safe, auditable queries from a CLI and web UI.**

One interface for your whole data stack, with built-in safeguards and a simpler workflow for your team.

---

## Features

| | Self-Host | Cloud / Enterprise |
|---|---|---|
| **Safe querying** | Read-only validation, single-statement enforcement | ✓ |
| **Query cost limit** | Budget caps for BigQuery, Athena, etc. | ✓ |
| **Audit log** | Full query history and tracking | ✓ |
| **Auth / Org / RBAC** | Organization-level access control | SSO, SAML |
| **Connection vault** | Centralized credential management | ✓ |
| **Connectors** | 15+ sources | ✓ |
| **NL → SQL** | — | ✓ |
| **Insights** | — | ✓ |
| **SLA / Compliance** | — | ✓ |

---

## Quick Install

```bash
curl -fsSL https://onequery.dev/install.sh | sh
```

Or use a package manager:

```bash
brew install wordbricks/tap/onequery    # Homebrew
npm install -g @onequery/cli            # npm
bun add -g @onequery/cli                # Bun
```

Without a global install: `npx @onequery/cli --help` or `bunx @onequery/cli --help`.

---

## Getting Started

### Option A: Self-host (run your own server)

```bash
onequery gateway start
onequery auth login
```

Add a source and run a query:

```bash
onequery source connect --source postgres \
  --input '{"name":"warehouse","credentials":{"host":"db.example.com","database":"app","username":"onequery","password":"secret"}}'
onequery query execute --source warehouse --sql "select 1"
```

### Option B: Connect to an existing server

```bash
onequery config set server https://onequery.example.com
onequery auth login
onequery source list
onequery query execute --source <source-key> --sql "select 1"
```

---

## Supported Sources

PostgreSQL · Supabase · MySQL · Snowflake · MongoDB · BigQuery · AWS Athena · Google Analytics · Amplitude · Mixpanel · PostHog · Sentry · GitHub · Linear · Laminar

Run `onequery source connect --help` for provider-specific setup.

---

## Documentation

| Document | Description |
|----------|-------------|
| [Self-Hosting Guide](./docs/self-host.md) | Install, proxy, SMTP, storage, backup, restore, upgrade |
| [Architecture](./docs/architecture.md) | System design, monorepo structure, runtime surfaces |
| [CLI Reference](./apps/cli/README.md) | CLI workspace, config, and runtime behavior |
| [Env & Secrets](./docs/env-secrets-management.md) | Managed local config flow for the web/server workspace |

---

## Claude Code Plugin

The `onequery` Claude Code plugin ships from the Wordbricks marketplace:

```bash
/plugin marketplace add wordbricks/skills
/plugin install onequery@wordbricks
```

For skills-compatible agents, install the `onequery-cli` skill:

```bash
npx skills add https://github.com/wordbricks/skills --skill onequery-cli -y
```

## OpenClaw Plugin

The OpenClaw plugin bundles the `onequery-openclaw` skill so agents can use the
`onequery` CLI directly through OpenClaw's built-in `exec` tool.

Install from ClawHub explicitly:

```bash
openclaw plugins install clawhub:@onequery/openclaw-plugin
openclaw plugins enable onequery
```

Install from npm (OpenClaw also checks ClawHub first for bare package specs):

```bash
openclaw plugins install @onequery/openclaw-plugin
openclaw plugins enable onequery
```

Install from a checkout of this repository:

```bash
bun run --cwd packages/openclaw-plugin build
openclaw plugins install -l ./packages/openclaw-plugin
openclaw plugins enable onequery
```

If you want to inspect the published package through the separate ClawHub CLI first:

```bash
clawhub package inspect @onequery/openclaw-plugin
```

If your setup persists plugin entries in `openclaw.json`, make sure the plugin
is enabled there too:

```json5
{
  plugins: {
    entries: {
      onequery: { enabled: true },
    },
  }
}
```

After enabling the plugin, start a new session so OpenClaw reloads the bundled
skill.

## Hermes

For plugin-free Hermes Agent usage, install the standalone `onequery-cli`
skill:

```bash
hermes skills install skills-sh/wordbricks/skills/onequery-cli --yes --force
```

Then start Hermes with the skill preloaded:

```bash
hermes chat --skills onequery-cli
```

Or load it inside an existing Hermes session:

```text
Load skill onequery-cli.
```

---

## Built With

Two libraries that make OneQuery more reliable:

- [better-result](https://github.com/dmmulroy/better-result): Forces every failure to be handled explicitly, so errors never silently slip through.
- [antiox](https://github.com/rivet-dev/antiox): Keeps concurrent queries, timeouts, and cancellations predictable, with no leaked tasks or hanging connections.

---

## Contributing

We welcome data source integration contributions. See [CONTRIBUTING.md](./CONTRIBUTING.md) for structure and PR process.

---

## License

Apache 2.0. See [LICENSE](./LICENSE).
