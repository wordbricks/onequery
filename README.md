# OneQuery OSS

OneQuery OSS is a self-hosted OneQuery distribution for a single-node Bun runtime.
The product shape is:

1. install the `onequery` CLI package
2. run `onequery serve`
3. open the local web UI
4. point the CLI at that server with `onequery config set server ...`
5. use `onequery auth login` against the same self-hosted instance

## Install

Prerequisites:

- `curl` and `tar`
- Bun `1.3.10` or newer on `PATH` when you want to run `onequery serve`
- current packaged support: macOS and Linux only

Install directly with npm:

```bash
npm install -g @onequery/cli
```

```bash
bun install -g @onequery/cli
```

Other package-manager entrypoints still work:

```bash
bunx @onequery/cli --help
# or
npx @onequery/cli --help
```

## Quick Start

Start the server:

```bash
onequery serve
```

Then:

1. open `http://127.0.0.1:4545`
2. complete the first-user bootstrap in the browser
3. point the CLI at the same server

```bash
onequery config set server http://127.0.0.1:4545
onequery auth login
```

The first browser user bootstraps the instance. After that, sign-up becomes
invite-only.

## Operate

Core runtime commands:

```bash
onequery serve
onequery serve status
onequery serve logs
onequery serve stop
```

Backup and restore:

```bash
onequery backup --include-secrets --archive-path ./onequery-backup.tar.gz
onequery restore ./onequery-backup.tar.gz
```

Stop the runtime before running `onequery backup` or `onequery restore`.

Upgrade flow:

```bash
onequery serve stop
curl -fsSL https://onequery.wordbricks.ai/ | sh
onequery serve
```

Take a backup before upgrading. In Postgres mode, the server applies checked-in
migrations during startup. In SQLite mode, the runtime bootstraps the checked-in
schema automatically.

## Config And Storage

Platform-default paths on supported hosts:

- Unix config: `${XDG_CONFIG_HOME:-~/.config}/onequery`
- Unix data: `${XDG_DATA_HOME:-~/.local/share}/onequery`

Important files:

- `self-host/config.toml`: listen host, port, public origin, log level, and SMTP settings
- `self-host/secrets.toml`: generated secrets plus optional SMTP password
- `sqlite/onequery.sqlite`: default SQLite database path
- `logs/server.log`: runtime lifecycle log
- `backups/`: default backup directory
- `run/server.pid` and `run/server.lock`: runtime markers

By default, OneQuery uses SQLite at the path above. To run against Postgres, set
`DATABASE_URL` before starting the server:

```bash
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/onequery onequery serve
```

If you run OneQuery behind a reverse proxy, set `public_origin` in
`self-host/config.toml`
to the external URL, for example:

```toml
[server]
listen_host = "127.0.0.1"
port = 4545
public_origin = "https://onequery.example.com"
```

## Email

SMTP is optional.

- If SMTP is configured, invitation and auth emails are delivered through SMTP.
- If SMTP is not configured, the product falls back to manual-link flows.

`self-host/config.toml` SMTP keys under `[smtp]`:

- `host`
- `port`
- `from_email`
- `from_name`
- `username`
- `secure`

`self-host/secrets.toml` SMTP key under `[smtp]`:

- `password`

## More Docs

- [`docs/self-host.md`](./docs/self-host.md): install, proxy, SMTP, storage, operations, and validation
- [`docs/self-host-runtime-foundation.md`](./docs/self-host-runtime-foundation.md): filesystem and lifecycle contract
- [`docs/README.md`](./docs/README.md): docs index
- [`CONTRIBUTING.md`](./CONTRIBUTING.md): contributor workflow
- [`apps/cli/README.md`](./apps/cli/README.md): CLI workspace and release notes
