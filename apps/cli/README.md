# onequery

Rust CLI workspace for `onequery` and the companion CLI API contract.

Key references:

- CLI workflow architecture note: `docs/ARCHITECTURE.md`
- Split OpenAPI source: `../../packages/cli-contract/openapi/source/cli.openapi.yaml`
- Generated JSON API contract: `../../packages/cli-contract/openapi/generated/cli.openapi.json`

Runtime config:

- On Unix-like systems, the user config file is `${XDG_CONFIG_HOME:-~/.config}/onequery/config.toml`.
- On Windows, the user config file is `%APPDATA%\\onequery\\config.toml`.
- `config.toml` stores `[org].active`, `[api].server_url`, and `[api].request_timeout_sec`.
- Runtime config is resolved in this order: built-in defaults -> user config file -> internal typed runtime overrides.
- `onequery org use <org>` persists `active_org`. Passing `--org <org>` for a command takes precedence over the stored `active_org` value for that invocation.
- `onequery auth logout` clears both the stored auth session and the stored `active_org`, so later org-scoped commands fail explicitly until a new org is selected.

Credential storage:

- On Unix-like systems, the CLI persists the full auth session blob to `${XDG_CONFIG_HOME:-~/.config}/onequery/auth.json`.
- On Windows, the CLI persists the full auth session blob to `%APPDATA%\\onequery\\auth.json`.
- `auth.json` stores the user identity, bearer token, session timing metadata, and the last refresh timestamp.
- Authenticated commands now run an explicit auth-session lifecycle before building an authenticated API client:
  load `auth.json` on startup -> call the CLI session refresh contract -> persist the returned token and timing metadata.

Version cache:

- Release builds refresh `${XDG_CONFIG_HOME:-~/.config}/onequery/version.json` on Unix-like systems and `%APPDATA%\\onequery\\version.json` on Windows as a cached latest-version record sourced from the npm dist-tags for `@onequery/cli`.
- The cache format mirrors Codex: `latest_version`, `last_checked_at`, and `dismissed_version`.

Install:

- `curl -fsSL https://onequery.wordbricks.ai/ | sh`
- `bun install -g @onequery/cli`
- `bunx @onequery/cli --help`
- `npx @onequery/cli --help`
- The published npm package supports macOS, Linux, and Windows.
- Packaged `onequery serve` uses a bundled native server executable and does not require `bun` on `PATH`.
- Linux npm installs ship musl-linked binaries so the CLI runs on both glibc and musl-based distributions, including Alpine.
- Packaged self-host commands now work on Windows as well as macOS and Linux.

Release:

- Keep `apps/cli/package.json` at `0.0.0-dev`.
- Keep `apps/cli/Cargo.toml` and `apps/cli/Cargo.lock` at `0.0.0` on normal development commits.
- Only temporary `release/...` branches should change `apps/cli/Cargo.toml` and `apps/cli/Cargo.lock` to the real release version before tagging.
- Install `git-cliff` locally and generate the release changelog before tagging, for example `git cliff --config cliff.toml --tag "v0.1.0" > /tmp/cli-v0.1.0-notes.md`.
- Use the generated changelog as the tagged release commit message so the GitHub release notes match the changelog content published for that version.
- After the release is tagged, close or delete that temporary release branch/PR so `origin/main` stays at `0.0.0`.
- Configure npm trusted publishing for `@onequery/cli` with GitHub Actions using the workflow filename `cli-release.yml`.
- Push a tag like `cli-v0.1.0` or `cli-v0.1.0-alpha.1`.
- The `cli-release` workflow validates `cli-v<version>` against `apps/cli/Cargo.toml`, builds the CLI binaries plus per-target self-host server executables, stages versioned npm tarballs plus stable installer asset names, creates a GitHub release from the tagged commit message, and publishes the versioned tarballs to npm with `npm publish --provenance`.
- Linux npm platform tarballs are staged from musl artifacts for the broadest runtime compatibility.
- Additional GNU Linux tarballs are attached to GitHub releases for direct download, but they are not published to npm.
- Windows npm tarballs are built on GitHub-hosted Windows runners and now include the bundled self-host runtime.
