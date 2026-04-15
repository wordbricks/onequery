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
onequery query exec --source <key> --sql "SELECT * FROM users LIMIT 10"
```

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
