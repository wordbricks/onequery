# Development Scripts

## Local Bootstrap

`onequery.dev.toml` is the tracked workspace-dev config for browser, API, and
local Postgres settings. `onequery.dev.secrets.toml` is the local untracked
secrets file. Child tooling still gets env-style values when needed, but those
values are projected from `@onequery/config` at process launch rather than
authored as env-shaped config.

`bun dev` runs `scripts/dev-setup.ts` before starting the workspace. That setup
step now does three things:

1. Creates `onequery.dev.secrets.toml` if it is missing.
2. Resolves the structured workspace-dev config from `@onequery/config`.
3. Starts the local Postgres container from the Docker projection and prepares
   the shared test database.

## Quick Start

```bash
# First run: bootstrap local state and run the one-port Bun runtime
bun run serve
```

After the first run, edit `onequery.dev.toml` for local defaults. Keep
`onequery.dev.secrets.toml` for machine-local secrets only.

## Runtime Commands

Phase 1 now has two distinct local workflows:

```bash
# Standard OSS runtime path: build apps/web and serve web + api from Bun
bun run serve

# Start only the managed local bootstrap
bun run dev:setup

# Rebuild the frontend bundle
bun run --cwd apps/web build

# Start the Bun-owned runtime against an existing build
bun run --cwd packages/bun-server start:local

# Vite web/landing dev plus a proxied Bun API server
bun dev
```

`bun run serve` is still the normal one-port runtime path. `bun dev` keeps the
browser on the workspace-dev browser origin while Vite proxies `/api` to a
separate local Bun listener for HMR-friendly full-stack work.

## Environment Files

- `packages/config/src/workspace-dev.ts` owns the workspace-dev authored shape
  and resolver.
- `packages/config/src/workspace-dev-init.ts` seeds the local secrets file.
- `onequery.dev.toml` is the tracked repo config for local dev defaults.
- `onequery.dev.secrets.toml` is a local machine file and stays untracked.

For a higher-level overview, see
[`docs/env-secrets-management.md`](../docs/env-secrets-management.md).

## Remaining Scripts

- `scripts/dev-setup.ts`: local Postgres bootstrap plus workspace-dev config
  validation.
- `packages/github-rulesets`: package that owns the repo-tracked GitHub
  ruleset planner and sync CLI for `.github/rulesets/`.
- `scripts/run-local-env-command.ts`: runs a command with config projected from
  the workspace-dev resolver at process launch.
- `scripts/upload-image.ts`: uploads local images into the app’s asset flow.

## GitHub Rulesets

The GitHub repository rulesets for OSS governance are tracked in
`.github/rulesets/`:

- `main.json`: the `main` branch protection ruleset. The
  `onequery-maintainers` team can bypass pull request review requirements from
  the PR UI without bypassing CI or branch-history protections.
- `cli-release-tags.json`: the protected CLI release tag ruleset.
- `teams.json`: org team state required by the tag ruleset.

Use the Bun scripts below to check or apply the GitHub state:

```bash
bun run github:rulesets:check
bun run github:rulesets:plan
bun run github:rulesets:apply
```

`github:rulesets:plan` prints the exact team/ruleset changes that
`github:rulesets:apply` would make without mutating GitHub state.

The root commands delegate to `packages/github-rulesets`, which can also be run
directly:

```bash
bun run --cwd packages/github-rulesets check
bun run --cwd packages/github-rulesets plan
bun run --cwd packages/github-rulesets apply
```
