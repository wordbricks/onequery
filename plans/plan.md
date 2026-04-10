# Source API Rewrite Plan

This directory is the split plan for the `source_api` rewrite.

Read in this order:

1. [source-api-ssot.md](./source-api-ssot.md)
2. [source-api-contract.md](./source-api-contract.md)
3. [source-api-implementation.md](./source-api-implementation.md)
4. [source-api-quality-bar.md](./source-api-quality-bar.md)

## Document Roles

- [source-api-ssot.md](./source-api-ssot.md) is the normative document.
  It defines the truth model, the state algebra, transition ownership, token
  semantics, failure model, and the invariants that make the rewrite a single
  source of truth.
- [source-api-contract.md](./source-api-contract.md) is the public boundary
  document.
  It defines the protobuf and Connect surface, preview and execute semantics,
  and canonical JSON boundary rules.
- [source-api-implementation.md](./source-api-implementation.md) is the
  execution document.
  It maps the SSoT and contract onto repository workstreams, concrete file
  targets, and completion tracking.
- [source-api-quality-bar.md](./source-api-quality-bar.md) is the proof
  document.
  It defines the Jane Street bar, verification obligations, and the final
  definition of done.

If the documents disagree:

- the state machine SSoT wins on lifecycle and domain truth
- the contract document wins on public wire shape, subject to the SSoT
- the implementation and quality documents must be updated to match

## Scope

This is a hard rewrite of the public `source_api` surface.

- No backward compatibility layer
- No feature flags
- No `v2` package or dual namespace
- No compatibility wrappers
- Delete legacy surfaces instead of preserving them

## Intended Outcome

The rewrite replaces the current `describe -> normalize -> execute` public
shape with one deterministic `describe -> prepare -> execute` model whose
truth is:

- a protobuf contract for public inputs and outputs
- a single prepared execution state on the server
- opaque signed tokens for continuation, not public fingerprints or plan dumps

The rest of the work is defined in the linked documents above.

Progress is tracked in
[source-api-implementation.md](./source-api-implementation.md).

Completion is judged by
[source-api-quality-bar.md](./source-api-quality-bar.md).

## Helpful `.tmp` References

Treat `.tmp/` as readonly reference material.

- [../.tmp/connect-es-repo/README.md](../.tmp/connect-es-repo/README.md),
  [../.tmp/connect-es-repo/packages/connect/README.md](../.tmp/connect-es-repo/packages/connect/README.md),
  and
  [../.tmp/connect-es-repo/packages/connect-node/README.md](../.tmp/connect-es-repo/packages/connect-node/README.md)
  for Connect RPC semantics on the TypeScript side, including service and
  client wiring, Node transports, and metadata handling patterns.
- [../.tmp/connect-rust-repo/README.md](../.tmp/connect-rust-repo/README.md),
  [../.tmp/connect-rust-repo/docs/guide.md](../.tmp/connect-rust-repo/docs/guide.md),
  and
  [../.tmp/connect-rust-repo/examples/middleware/README.md](../.tmp/connect-rust-repo/examples/middleware/README.md)
  for Rust transport structure, generated client and server expectations, and
  header or trailer flow through middleware and request context.
- [../.tmp/protobuf-es-repo/MANUAL.md](../.tmp/protobuf-es-repo/MANUAL.md),
  [../.tmp/protobuf-es-repo/packages/protobuf/README.md](../.tmp/protobuf-es-repo/packages/protobuf/README.md),
  and
  [../.tmp/protobuf-es-repo/packages/protoc-gen-es/README.md](../.tmp/protobuf-es-repo/packages/protoc-gen-es/README.md)
  for protobuf-es runtime behavior, WKT and canonical JSON expectations, and
  `protoc-gen-es` generation details.
- [../.tmp/buf-repo/README.md](../.tmp/buf-repo/README.md) for schema-driven
  workflow guidance around `buf generate`, linting, breaking checks, and
  general protobuf hygiene.
- [../.tmp/hono-connect-example-repo/README.md](../.tmp/hono-connect-example-repo/README.md)
  for a compact Hono plus Connect example that is relevant to the current
  `packages/cli-server` integration style.
