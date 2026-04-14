# onequery

Rust CLI workspace for `onequery` and the companion protobuf/Connect contract.

Key references:

- CLI workflow architecture note: `docs/ARCHITECTURE.md`
- Protobuf workspace: `../../proto/`
- Protobuf source of truth: `../../proto/onequery/cli/v1/*.proto`
- Buf workspace config: `../../proto/buf.yaml`, `../../proto/buf.gen.yaml`

Runtime config:

- On Unix-like systems, the user config file is `${XDG_CONFIG_HOME:-~/.config}/onequery/config.toml`.
- On Windows, the user config file is `%APPDATA%\\onequery\\config.toml`.
- `config.toml` stores `[org].active`, `[api].server_url`, and `[api].request_timeout_sec`.
- `[api].server_url` must be an absolute `http://` or `https://` app origin such as `http://127.0.0.1:5656`, not an API path like `/api` or `/api/cli`.
- Persisted CLI config layering is: built-in defaults -> user config file -> internal typed runtime overrides.
- Base URL targeting resolves in this order: `ONEQUERY_BASE_URL` -> `[api].server_url` -> debug builds read the repo-root `onequery.dev.toml` browser origin -> packaged self-host default.
- Release builds do not use `cwd` or ancestor config discovery to choose a server target.
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

- `brew install wordbricks/tap/onequery`
- `npm install -g @onequery/cli`
- `bun install -g @onequery/cli`
- `bunx @onequery/cli --help`
- `npx @onequery/cli --help`
- For skills-compatible agents, install the `onequery-cli` skill with `npx skills add https://github.com/wordbricks/skills --skill onequery-cli -y`.
- `onequery upgrade` upgrades a published install in place when the CLI can detect the installer family from the current binary layout.
- The published Homebrew and npm packages support macOS and Linux.
- The published npm package also supports Windows.
- Packaged `onequery gateway` uses a bundled Rolldown-built server runtime launched with Node.js, so it does not require `bun` on `PATH`. `onequery gateway` runs that server in foreground, while `onequery gateway start` launches the same server in background. The hosted `install.sh` bootstrap installs a pinned official Node.js 24 runtime on macOS/Linux when `node` 24+ is not already available. Direct npm/bun installs still require Node.js 22+ on `PATH` or `ONEQUERY_SERVER_JS_RUNTIME`.
- Linux npm installs ship musl-linked binaries so the CLI runs on both glibc and musl-based distributions, including Alpine.
- Packaged self-host commands now work on Windows as well as macOS and Linux.
