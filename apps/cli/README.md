# onequery

Query any connected data source from your terminal.

## Install

```sh
brew install wordbricks/tap/onequery
```

```sh
npm install -g @onequery/cli
```

Or run directly:

```sh
npx @onequery/cli --help
```

## Usage

```sh
onequery auth login
onequery org use <org>
onequery source list
onequery source update sentry://<key> --input credentials-patch.json
onequery source delete sentry://<key> --yes
onequery query exec --source postgres://<key> --sql "SELECT * FROM users LIMIT 10"
```

Source updates accept a partial credential document such as
`{"credentials":{"organizationSlug":"wordbricks"}}`. OneQuery retains omitted
secrets, validates and tests the merged credentials, and persists them only when
the connection test succeeds. Source deletion requires `--yes`.

## Profiles

OneQuery stores the default CLI auth session and config in `~/.onequery/auth.json`
and `~/.onequery/config.toml`, or under `ONEQUERY_HOME` when it is set. Named
profiles keep separate local auth/config state under
`~/.onequery/profiles/<profile>/`.

```sh
onequery --profile work auth login
ONEQUERY_PROFILE=work onequery auth whoami
```

`--profile` takes precedence over `ONEQUERY_PROFILE`. `ONEQUERY_ACCESS_TOKEN`
remains invocation-only and takes precedence over the selected profile's stored
auth session without implicitly writing to it.

## Self-host

```sh
onequery gateway start
```

## Upgrade

```sh
onequery upgrade
```

## Platforms

macOS, Linux (glibc and musl), Windows.

## License

[Apache-2.0](../../LICENSE)
