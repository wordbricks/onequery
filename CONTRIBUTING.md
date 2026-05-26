# Contributing

Thank you for your interest in OneQuery. We welcome contributions across the
project, including bug fixes, documentation, tests, data source integrations,
CLI/runtime improvements, and dashboard polish.

## How to contribute

- Small fixes, docs updates, focused tests, and clear bug fixes can go straight
  to a pull request.
- Larger changes should start with an issue so maintainers can align on scope
  before you invest significant time. This includes public API changes, database
  schema changes, new dependencies, security-sensitive work, broad refactors,
  and major UI or workflow changes.
- Keep each pull request focused. If a change naturally splits into independent
  pieces, send separate PRs.
- Explain what changed, why it changed, and how you validated it.
- Never commit secrets, access tokens, customer data, or private logs.

## Pull request checklist

Before opening a PR:

1. Add or update tests for behavior changes.
2. Update docs or examples when behavior, commands, configuration, or setup
   changes.
3. If generated files are involved, update the source file and run the generator
   instead of editing generated output by hand.
4. Run the relevant checks:

```bash
bun lint --format json
bunx turbo typecheck --json
bunx turbo test --json
```

For a full monorepo check, use:

```bash
bunx turbo check --json
```

## Data source integrations

Data source integrations are especially welcome. A typical integration includes
credential validation, a provider relay, a connection tester, a route, and tests.

Use the existing integrations as references, and keep each PR to one data source
unless a maintainer asks for a different shape.

## Development

Basic local setup:

```bash
bun install
bun run dev:setup
bun dev
```

See [README.md](./README.md) for product context and
[docs/architecture.md](./docs/architecture.md) for the high-level architecture.
