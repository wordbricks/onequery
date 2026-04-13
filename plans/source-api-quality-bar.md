# Source API Quality Bar

This document defines the proof obligations for calling the rewrite done.

It does not restate the state machine or the public contract. It defines how to
prove that the implementation actually obeys them.

## Quality Progress

- [x] 1. Pass the Jane Street bar checklist
- [x] 2. Pass transition and token verification
- [x] 3. Pass TypeScript and Rust boundary verification
- [x] 4. Pass end-to-end verification
- [x] 5. Satisfy definition of done

## Jane Street Bar

The rewrite is only "Jane Street level" for this subsystem if all of the
following are true at the same time.

- [x] `PreparedSourceApi` is the only execution input accepted by the domain and
  provider adapter path.
- [x] No code path can execute a raw draft without first producing prepared
  state.
- [x] The lifecycle is represented as a closed set of explicit states, not
  spread across exceptions, nullable branches, or transport-only conventions.
- [x] Transition ownership is fixed:
  `prepare` normalizes, `execute` validates and runs, `continue` advances only
  continuation state.
- [x] Reducers and pure projections are pure.
- [x] Effects are isolated to explicit boundaries such as token verification,
  descriptor loading, authz loading, provider I/O, and header or trailer
  emission.
- [x] Preview is a projection from prepared state, never an execution input.
- [x] Tokens are opaque capability carriers, not user-visible plan dumps.
- [x] Request IDs stay in Connect metadata and never re-enter business payload
  truth.
- [x] No legacy bypass or compatibility path can reconstruct source-api truth in
  parallel to the new state machine.

## Transition and Token Verification

- [x] Prepare succeeds only from `Draft` and produces `Prepared`.
- [x] Prepare rejection cases land in `Rejected`, not ad hoc error-only paths.
- [x] Execute from a valid `Prepared` yields either `ExecutedPage` or
  `Exhausted`.
- [x] Continue from `ExecutedPage` yields either another `ExecutedPage` or
  `Exhausted`.
- [x] Tampered prepared tokens land in `Rejected`.
- [x] Tampered page tokens land in `Rejected`.
- [x] Expired prepared or page tokens land in `Expired`.
- [x] Descriptor, source, or authz drift lands in `Invalidated`.
- [x] Page tokens are rejected when bound to another prepared execution
  identity.
- [x] Execute never silently re-prepares.

## TypeScript and Rust Boundary Verification

### TypeScript

- [x] Unit tests for WKT request and response round-trips using real
  `google.protobuf.Value` and `Struct`.
- [x] Unit tests for prepared token encoding, decoding, expiry, and tamper
  rejection.
- [x] Unit tests for page token binding to prepared execution identity.
- [x] Tests confirming no custom application JSON AST remains in the source-api
  path.

### Rust

- [x] Unit tests for CLI input edge conversion into WKT.
- [x] Unit tests for WKT rendering back into `serde_json::Value`.
- [x] Transport tests confirming request IDs are read from headers, not
  payloads.
- [x] Transport tests confirming generated WKT types remain the transport truth.

## End-To-End Verification

- [x] Prepare-only dry run.
- [x] Execute prepared request with JSON response body.
- [x] Execute prepared request with text response body.
- [x] Execute prepared request with binary response body.
- [x] Paginated execution with a stable `prepared_token`.
- [x] Rejection for modified prepared token.
- [x] Rejection for page token bound to a different prepared request.
- [x] Rejection for invalid `Struct` in object-only fields.
- [x] Invalidation when prepared basis is no longer acceptable.

## Definition of Done

The rewrite is done only when all of the following are true:

- [x] The repository matches the invariants in
  [source-api-ssot.md](./source-api-ssot.md).
- [x] The repository matches the public boundary rules in
  [source-api-contract.md](./source-api-contract.md).
- [x] There is exactly one public `prepare -> execute` flow.
- [x] Dry-run uses prepare only.
- [x] Execute accepts prepared state and continuation state only.
- [x] No source-api payload carries `request_id`.
- [x] No source-api payload carries request fingerprints.
- [x] No custom application JSON AST remains in the source-api path.
- [x] TypeScript uses protobuf-es JSON types directly in the service path.
- [x] Rust transport mirrors the protobuf contract directly.
- [x] All source-api tests pass.
- [x] Legacy source-api surfaces listed in
  [source-api-implementation.md](./source-api-implementation.md) are removed.
