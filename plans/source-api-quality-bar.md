# Source API Quality Bar

This document defines the proof obligations for calling the rewrite done.

It does not restate the state machine or the public contract. It defines how to
prove that the implementation actually obeys them.

## Quality Progress

- [ ] 1. Pass the Jane Street bar checklist
- [ ] 2. Pass transition and token verification
- [ ] 3. Pass TypeScript and Rust boundary verification
- [ ] 4. Pass end-to-end verification
- [ ] 5. Satisfy definition of done

## Jane Street Bar

The rewrite is only "Jane Street level" for this subsystem if all of the
following are true at the same time.

- [ ] `PreparedSourceApi` is the only execution input accepted by the domain and
  provider adapter path.
- [ ] No code path can execute a raw draft without first producing prepared
  state.
- [ ] The lifecycle is represented as a closed set of explicit states, not
  spread across exceptions, nullable branches, or transport-only conventions.
- [ ] Transition ownership is fixed:
  `prepare` normalizes, `execute` validates and runs, `continue` advances only
  continuation state.
- [ ] Reducers and pure projections are pure.
- [ ] Effects are isolated to explicit boundaries such as token verification,
  descriptor loading, authz loading, provider I/O, and header or trailer
  emission.
- [ ] Preview is a projection from prepared state, never an execution input.
- [ ] Tokens are opaque capability carriers, not user-visible plan dumps.
- [ ] Request IDs stay in Connect metadata and never re-enter business payload
  truth.
- [ ] No legacy bypass or compatibility path can reconstruct source-api truth in
  parallel to the new state machine.

## Transition and Token Verification

- [ ] Prepare succeeds only from `Draft` and produces `Prepared`.
- [ ] Prepare rejection cases land in `Rejected`, not ad hoc error-only paths.
- [ ] Execute from a valid `Prepared` yields either `ExecutedPage` or
  `Exhausted`.
- [ ] Continue from `ExecutedPage` yields either another `ExecutedPage` or
  `Exhausted`.
- [ ] Tampered prepared tokens land in `Rejected`.
- [ ] Tampered page tokens land in `Rejected`.
- [ ] Expired prepared or page tokens land in `Expired`.
- [ ] Descriptor, source, or authz drift lands in `Invalidated`.
- [ ] Page tokens are rejected when bound to another prepared execution
  identity.
- [ ] Execute never silently re-prepares.

## TypeScript and Rust Boundary Verification

### TypeScript

- [ ] Unit tests for WKT request and response round-trips using real
  `google.protobuf.Value` and `Struct`.
- [ ] Unit tests for prepared token encoding, decoding, expiry, and tamper
  rejection.
- [ ] Unit tests for page token binding to prepared execution identity.
- [ ] Tests confirming no custom application JSON AST remains in the source-api
  path.

### Rust

- [ ] Unit tests for CLI input edge conversion into WKT.
- [ ] Unit tests for WKT rendering back into `serde_json::Value`.
- [ ] Transport tests confirming request IDs are read from headers, not
  payloads.
- [ ] Transport tests confirming generated WKT types remain the transport truth.

## End-To-End Verification

- [ ] Prepare-only dry run.
- [ ] Execute prepared request with JSON response body.
- [ ] Execute prepared request with text response body.
- [ ] Execute prepared request with binary response body.
- [ ] Paginated execution with a stable `prepared_token`.
- [ ] Rejection for modified prepared token.
- [ ] Rejection for page token bound to a different prepared request.
- [ ] Rejection for invalid `Struct` in object-only fields.
- [ ] Invalidation when prepared basis is no longer acceptable.

## Definition of Done

The rewrite is done only when all of the following are true:

- [ ] The repository matches the invariants in
  [source-api-ssot.md](./source-api-ssot.md).
- [ ] The repository matches the public boundary rules in
  [source-api-contract.md](./source-api-contract.md).
- [ ] There is exactly one public `prepare -> execute` flow.
- [ ] Dry-run uses prepare only.
- [ ] Execute accepts prepared state and continuation state only.
- [ ] No source-api payload carries `request_id`.
- [ ] No source-api payload carries request fingerprints.
- [ ] No custom application JSON AST remains in the source-api path.
- [ ] TypeScript uses protobuf-es JSON types directly in the service path.
- [ ] Rust transport mirrors the protobuf contract directly.
- [ ] All source-api tests pass.
- [ ] Legacy source-api surfaces listed in
  [source-api-implementation.md](./source-api-implementation.md) are removed.
