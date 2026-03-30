# Development Scripts

## Local Bootstrap

`onequery.local.env.toml` is the editable source of truth for managed OSS
web/server local config. Child processes receive projected env vars in memory at
launch time; there is no generated local env file on disk.

`bun dev` runs `scripts/dev-setup.ts` before starting the workspace. That setup
step now does three things:

1. Creates `onequery.local.env.toml` from the managed config contract if it is
   missing.
2. Appends newly managed keys to `onequery.local.env.toml` without overwriting
   existing values, and seeds a random `BETTER_AUTH_SECRET` when that key is
   missing.
3. Starts the local Postgres container and syncs the Drizzle schema.

## Quick Start

```bash
# First run: bootstrap local state and run the one-port Bun runtime
bun run serve

# Refresh tracked local config artifacts
bun run env:sync
```

After the first run, edit `onequery.local.env.toml` for managed local defaults.
Scripts that spawn local tooling project those managed values into process env
at launch time.

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

`bun run serve` is still the normal one-port runtime path. `bun dev` now keeps
the browser on the managed `WEB_URL` origin while Vite proxies `/api` to a
separate local Bun listener for HMR-friendly full-stack work.

## Environment Files

- `packages/dev-config/src/local-env.ts` is the single source of truth for managed local
  development config.
- `onequery.local.env.toml.template` is the generated committed TOML artifact.
- `onequery.local.env.toml` is a local machine file and stays untracked.
- `bun run env:sync` refreshes the tracked TOML template, appends any newly
  managed keys to `onequery.local.env.toml`, seeds a random
  `BETTER_AUTH_SECRET` only when missing.

For a higher-level overview, see
[`docs/env-secrets-management.md`](../docs/env-secrets-management.md).

## Remaining Scripts

- `scripts/dev-setup.ts`: local Postgres bootstrap plus managed config syncing and
  validation.
- `scripts/github/sync-rulesets.ts`: checks or applies the repo-tracked GitHub
  ruleset definitions under `.github/rulesets/`.
- `scripts/sync-local-env.ts`: refreshes the tracked TOML template and syncs
  the managed local TOML file.
- `scripts/run-local-env-command.ts`: runs a command with the managed local config
  projected from TOML at process launch.
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
bun run github:rulesets:apply
```
