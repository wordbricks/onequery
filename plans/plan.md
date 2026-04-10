# Source API Rewrite Plan

This directory is the split plan for the `source_api` rewrite.

Read in this order:

1. [source-api-ssot.md](./source-api-ssot.md)
2. [source-api-implementation.md](./source-api-implementation.md)

## Document Roles

- [source-api-ssot.md](./source-api-ssot.md) is the normative document.
  It defines the public contract, the state algebra, token semantics, failure
  model, and the invariants that make the rewrite a single source of truth.
- [source-api-implementation.md](./source-api-implementation.md) is the
  execution document.
  It maps the SSoT onto repository workstreams, concrete file targets,
  verification, and completion tracking.

If the two documents disagree, the SSoT wins and the implementation document
must be updated.

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
