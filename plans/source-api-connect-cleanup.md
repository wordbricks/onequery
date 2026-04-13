# Source API Connect Cleanup

This document tracks follow-up cleanup work after the source-api rewrite was
completed.

It does not redefine the public contract or state machine. It removes
transport-layer duplication and sharp edges that are no longer justified now
that the rewrite is complete.

## Progress Board

- [ ] 1. Align the Hono Connect adapter with reference Connect behavior
- [ ] 2. Collapse duplicate Connect error mappings into the canonical problem catalog
- [ ] 3. Remove stale parallel HTTP client scaffolding from the Rust CLI
- [ ] 4. Re-verify the affected Connect and CLI transport paths

## 1. Align the Hono Connect Adapter

Files:

- `packages/cli-server/src/connect/middleware.ts`
- `packages/cli-server/src/connect/middleware.test.ts`

Changes:

- [ ] Set the same default `acceptCompression` behavior used by the reference
  Connect adapters.
- [ ] Keep matched Connect route failures inside the Connect handler path
  instead of rethrowing them through the outer Hono error pipeline.
- [ ] Add focused tests for the updated middleware behavior.

Deliverable:

- a custom Hono adapter that behaves like a thin Connect adapter, not a
  parallel error transport

## 2. Collapse Duplicate Connect Error Mappings

Files:

- `packages/cli-server/src/connect/error.ts`
- `packages/cli-server/src/domain/problems.ts`
- related Connect service helpers and tests

Changes:

- [ ] Derive Connect-facing titles and codes from the canonical CLI problem
  catalog instead of maintaining a second transport-specific truth table.
- [ ] Keep only transport-specific metadata wiring in the Connect error helper.
- [ ] Preserve request ID and retry delay metadata behavior.

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

- [ ] `bun test packages/cli-server/src/connect`
- [ ] `cargo test transport::`
- [ ] `bun lint --format json`
