# Proto workspace

`proto/` owns the CLI protobuf/Connect contract and internal workflow
protobuf contracts.

This directory contains:

- `buf.yaml`, `buf.gen.yaml`, and `buf.lock`
- the CLI RPC schema source of truth under `onequery/cli/v1/*.proto`
- the durable workflow schema source of truth under
  `onequery/workflow/v1/*.proto`

Supported entrypoints:

- canonical entrypoint: `bun run proto:lint`, `bun run proto:boundaries`,
  `bun run proto:generate`, `bun run proto:check`
- low-level Buf usage from the repo root: `buf lint proto`, `buf generate --template proto/buf.gen.yaml proto`

`buf generate` is intentionally run from the repo root because the generated
TypeScript output lives outside `proto/`.

- `packages/cli-server/src/connect/gen` is the full server-owned generated
  implementation output.
- `packages/contracts/src/connect/gen` is a narrow generated subset for
  workflow payloads imported by other workspace packages.

The generated output location is an implementation detail. Protobuf package
names remain the ownership and compatibility boundary: `onequery.workflow.v1`
must not import `onequery.cli.v1`, and CLI/API proto files must not import
`onequery.workflow.v1`. `bun run proto:boundaries` enforces those import edges
directly on source `.proto` files before generated TypeScript mirrors them.

The Rust CLI build consumes this workspace for descriptor generation.
