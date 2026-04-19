# OneQuery

<p align="center">
  <a href="./README.md">English</a> · <a href="./README.zh-CN.md">简体中文</a> · <a href="./README.zh-TW.md">繁體中文</a>
</p>

<p align="center">
  <a href="https://onequery.dev"><img src="https://img.shields.io/badge/Site-onequery.dev-blue?style=for-the-badge" alt="Site"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/License-Apache%202.0-green?style=for-the-badge" alt="License: Apache 2.0"></a>
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

PostgreSQL · Supabase · MySQL · MongoDB · BigQuery · AWS Athena · Google Analytics · Amplitude · Mixpanel · PostHog · Sentry · GitHub · Linear · Laminar

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

From npm:

```bash
openclaw plugins install @onequery/openclaw-plugin
openclaw plugins enable onequery
```

From a checkout of this repository:

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

---

## Contributing

We welcome data source integration contributions. See [CONTRIBUTING.md](./CONTRIBUTING.md) for structure and PR process.

---

## License

Apache 2.0. See [LICENSE](./LICENSE).
