# Source API Connect Cleanup

This document tracks follow-up cleanup work after the source-api rewrite was
completed.

It does not redefine the public contract or state machine. It removes
transport-layer duplication and sharp edges that are no longer justified now
that the rewrite is complete.

## Progress Board

- [x] 1. Align the Hono Connect adapter with reference Connect behavior
- [x] 2. Collapse duplicate Connect error mappings into the canonical problem catalog
- [ ] 3. Remove stale parallel HTTP client scaffolding from the Rust CLI
- [ ] 4. Re-verify the affected Connect and CLI transport paths

## 1. Align the Hono Connect Adapter

Files:

- `packages/hono-connect/src/index.ts`
- `packages/hono-connect/src/index.test.ts`
- `packages/hono-connect/package.json`
- `packages/cli-server/src/connect/route.ts`

Changes:

- [x] Set the same default `acceptCompression` behavior used by the reference
  Connect adapters.
- [x] Keep matched Connect route failures inside the Connect handler path
  instead of rethrowing them through the outer Hono error pipeline.
- [x] Extract the generic Hono adapter into `@onequery/hono-connect` so
  `packages/cli-server` only owns CLI-specific context and interceptor wiring.
- [x] Add focused tests for the updated middleware behavior.
- [x] Narrow the extracted adapter contract around the current Node.js runtime,
  leaving Cloudflare Workers as a follow-up transport instead of a mixed
  adapter.

Deliverable:

- a custom Node/Hono adapter that behaves like a thin Connect adapter, not a
  parallel error transport

## 2. Collapse Duplicate Connect Error Mappings

Files:

- `packages/cli-server/src/connect/error.ts`
- `packages/cli-server/src/domain/problems.ts`
- related Connect service helpers and tests

Changes:

- [x] Derive Connect-facing titles and codes from the canonical CLI problem
  catalog instead of maintaining a second transport-specific truth table.
- [x] Keep only transport-specific metadata wiring in the Connect error helper.
- [x] Preserve request ID and retry delay metadata behavior.

Deliverable:

- one canonical problem catalog, with Connect projection layered on top

## 3. Remove Stale Parallel HTTP Client Scaffolding

Files:

- `apps/cli/crates/onequery-cli/src/transport/client.rs`
- related Rust transport tests

Changes:

- [ ] Remove the unused plain `reqwest::Client` field from the CLI transport
  wrapper if it is no longer required by production code.
- [ ] Remove unused helper APIs that only support that parallel HTTP path.
- [ ] Keep the generated Connect client as the only CLI transport truth for
  Connect RPCs.

Deliverable:

- one Rust CLI transport client that configures the generated Connect client
  directly, without dead parallel request machinery

## 4. Verification

- [x] `bunx turbo test --filter=@onequery/hono-connect --filter=@onequery/cli-server --json`
- [x] `bunx turbo test --filter=@onequery/self-host-runtime --json`
- [x] `bun test packages/cli-server/src/connect/error.test.ts packages/cli-server/src/domain/domain.test.ts`
- [x] `bunx turbo typecheck --filter=@onequery/cli-server --json`
- [x] `bunx turbo typecheck --filter=@onequery/hono-connect --filter=@onequery/cli-server --filter=@onequery/self-host-runtime --json`
- [ ] `cargo test transport::`
- [x] `bun lint --format json`
- [x] `bun lint --format json packages/cli-server/src/connect/error.ts packages/cli-server/src/connect/error.test.ts packages/cli-server/src/domain/problems.ts`
