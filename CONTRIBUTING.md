# Contributing

Thank you for your interest in OneQuery.

## Pull Requests

**We only accept pull requests for data source connectors.**

The core platform (server, web UI, CLI, database schema) is not open to external contributions at this time. If you have a request for core functionality, please open an issue instead — see [Feature Requests](#feature-requests) below.

### What counts as a connector contribution

A connector is a self-contained agent that runs on customer infrastructure, polls OneQuery for query jobs, executes them against a data source, and returns results. The current connector lives in `apps/connector` and targets AWS Athena.

Accepted connector contributions include:

- New data source support (e.g. a new connector for Snowflake, Redshift, BigQuery on-prem, etc.)
- Bug fixes or reliability improvements to an existing connector
- New query validation rules for an existing connector

### Before you open a PR

1. Open an issue first describing the connector you want to add or the problem you want to fix. Wait for a maintainer to confirm it's in scope before investing significant time.
2. Fork the repo and work on a branch.
3. Follow the existing structure in `apps/connector` — each connector must:
   - Register with OneQuery via an enrollment token
   - Validate queries for safety (read-only, single statement) before executing
   - Return normalized success or error payloads
   - Not log query result row contents
4. Run checks before submitting:

```bash
cd apps/connector
bun run typecheck
bun run test
bun run check
```

5. Keep the PR focused. One connector or one fix per PR.

## Feature Requests

For any feature request outside of connector contributions — new platform capabilities, CLI commands, web UI features, integrations, API changes — please **open a GitHub issue** with a title starting with:

```
[Feature Request] <your title here>
```

Describe what you want to achieve, why it matters, and any relevant context. We review feature requests periodically and will respond in the issue thread.

## Bug Reports

Open a GitHub issue with a clear description of the problem, steps to reproduce, and the version of the CLI or server you're running.

## Setup

See the root `README.md` for local development setup. If you're working on the connector only:

```bash
cd apps/connector
cp config/local.toml.example config/local.toml
# edit config/local.toml with your local values
bun run dev
```
