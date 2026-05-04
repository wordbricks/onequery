# Proto workspace

`proto/` owns the CLI protobuf/Connect contract, the private runtime control
contract, and internal workflow protobuf contracts.

This directory contains:

- `buf.yaml`, `buf.gen.yaml`, and `buf.lock`
- the CLI RPC schema source of truth under `onequery/cli/v1/*.proto`
- the private self-host runtime control schema under
  `onequery/runtime/v1/*.proto`
- the durable workflow schema source of truth under
  `onequery/workflow/v1/*.proto`

Supported entrypoints:

- canonical entrypoint: `bun run proto:lint`, `bun run proto:boundaries`,
  `bun run proto:generate`, `bun run proto:check`
- Rust CLI entrypoint from `apps/cli`: `just regen-proto`, `just check-proto`
- low-level Buf usage from the repo root: `buf lint proto`,
  `buf generate proto --template proto/buf.gen.yaml --path proto/onequery/cli/v1 -o packages/proto-cli`,
  `buf generate proto --template proto/buf.gen.yaml --path proto/onequery/runtime/v1 -o packages/proto-runtime`,
  and
  `buf generate proto --template proto/buf.gen.yaml --path proto/onequery/workflow/v1 -o packages/proto-workflow`

`buf.gen.yaml` is a shared TypeScript generator template. `buf generate` is
intentionally run from the repo root with `--path` and `-o` because the
generated TypeScript output lives outside `proto/` and is split into three
workspace packages.

- `packages/proto-cli/src` is generated from `onequery/cli/v1`.
- `packages/proto-runtime/src` is generated from `onequery/runtime/v1`.
- `packages/proto-workflow/src` is generated from `onequery/workflow/v1`.
- `apps/cli/crates/proto-cli/src/generated` is generated from
  `onequery/cli/v1` for Rust Connect clients.
- `apps/cli/crates/proto-runtime/src/generated` is generated from
  `onequery/runtime/v1` for Rust Connect clients and servers.
- `packages/audit-contracts/src` contains handwritten Zod/read-model
  contracts and is not generated from protobuf.

The generated output location is an implementation detail. Protobuf package
names remain the ownership and compatibility boundary: `onequery.workflow.v1`,
`onequery.runtime.v1`, and `onequery.cli.v1` must not import each other. Run
`bun run proto:boundaries` to enforce those import edges directly on source
`.proto` files before generated TypeScript mirrors them.

The Rust CLI generated proto crates check in their generated Rust output so
ordinary `cargo check` does not run Connect codegen.

Don't follow 1-1-1 principle since it's too verbose.
