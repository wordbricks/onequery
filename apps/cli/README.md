# onequery

Rust CLI workspace for `onequery` and the companion protobuf/Connect contract.

Key references:

- CLI workflow architecture note: `docs/ARCHITECTURE.md`
- Protobuf source of truth: `../../proto/onequery/cli/v1/*.proto`
- Buf workspace config: `../../buf.yaml`, `../../buf.gen.yaml`

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

- Release builds refresh `${XDG_CONFIG_HOME:-~/.config}/onequery/version.json` on Unix-like systems and `%APPDATA%\\onequery\\version.json` on Windows as a cached latest-version record sourced from the latest GitHub release tag for `wordbricks/onequery`.
- The cache format mirrors Codex: `latest_version`, `last_checked_at`, and `dismissed_version`.

Install:

- `npm install -g @onequery/cli`
- `bun install -g @onequery/cli`
- `bunx @onequery/cli --help`
- `npx @onequery/cli --help`
- The published npm package supports macOS, Linux, and Windows.
- Packaged `onequery serve` uses a bundled native server executable and does not require `bun` on `PATH`.
- Linux npm installs ship musl-linked binaries so the CLI runs on both glibc and musl-based distributions, including Alpine.
- Packaged self-host commands now work on Windows as well as macOS and Linux.
