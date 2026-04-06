# Proto workspace

`proto/` owns the internal CLI protobuf/Connect contract.

This directory contains:

- `buf.yaml`, `buf.gen.yaml`, and `buf.lock`
- the schema source of truth under `onequery/cli/v1/*.proto`

Supported entrypoints:

- canonical local entrypoint: `bun run --cwd proto lint`, `bun run --cwd proto generate`, `bun run --cwd proto check`
- root delegates: `bun run proto:lint`, `bun run proto:generate`, `bun run proto:check`

The generation template writes TypeScript output back into
`packages/cli-server/src/connect/gen`, and the Rust CLI build consumes this
workspace for descriptor generation.
