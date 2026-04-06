# Proto workspace

`proto/` owns the internal CLI protobuf/Connect contract.

This directory contains:

- `buf.yaml`, `buf.gen.yaml`, and `buf.lock`
- the schema source of truth under `onequery/cli/v1/*.proto`

Supported entrypoints:

- canonical entrypoint: `bun run proto:lint`, `bun run proto:generate`, `bun run proto:check`
- low-level Buf usage from the repo root: `buf lint proto`, `buf generate --template proto/buf.gen.yaml proto`

`buf generate` is intentionally run from the repo root because the generated
TypeScript output lives outside `proto/`, under
`packages/cli-server/src/connect/gen`.

The Rust CLI build consumes this workspace for descriptor generation.
