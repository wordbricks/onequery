# Source API State Machine SSoT

This document is the top normative source of truth for the `source_api`
rewrite.

It defines:

- the truth model
- the state algebra
- transition ownership
- reducer and effect boundaries
- token semantics
- invalidation and failure rules
- global invariants

It does not define the public wire contract in detail. That projection lives in
[source-api-contract.md](./source-api-contract.md).

## Mission

Rewrite `source_api` as a prepared execution system whose truth is an explicit
state machine, not a pile of transport shapes and convenience helpers.

The rewrite removes the current split where the wire already carries
`google.protobuf.Value` and `google.protobuf.Struct`, but the application then
collapses them into a second custom JSON AST.

## Hard Constraints

- Replace the existing public `source_api.proto` surface in place.
- Do not add a `v2` package or compatibility namespace.
- Remove `NormalizeSourceApi`.
- Remove public `request_fingerprint` and `requestFingerprint`.
- Remove `request_id` from protobuf payloads.
- Keep request IDs in Connect headers or trailers using `x-request-id`.
- Remove `SourceApiJsonValue`.
- Remove recursive protobuf-to-custom-JSON copiers.
- Ban `JSON.parse(JSON.stringify(...))` in the source-api path.
- Keep CLI to server transport on Connect with protobuf binary encoding only.
- Allow JSON parsing only at explicit external edges:
  - CLI stdin and CLI flags into request bodies
  - upstream HTTP response bytes into JSON values
  - CLI rendering and `jq` or `jaq` transforms

## Truth Model

There are only three authoritative truth layers.

### 1. Public Contract Truth

Public request and response truth lives in protobuf messages and Connect
headers or trailers.

What belongs here:

- user-supplied draft input
- dry-run preview output
- prepared execution response payload
- opaque continuation tokens
- transport metadata in headers

What does not belong here:

- request fingerprints
- internal digests
- normalization internals
- token payload internals
- transport-only request IDs in protobuf bodies

### 2. Internal Domain Truth

Internal execution truth lives in a single server-owned prepared state:
`PreparedSourceApi`.

`PreparedSourceApi` is the canonical, fully normalized, authorization-relevant
execution shape. It is the only input accepted by provider adapters for
execution.

The server may derive projections from it:

- a `PreparedSourceApiPreview` for dry-run output
- a signed `prepared_token`
- a signed `next_page_token`

Those projections are not separate sources of truth.

### 3. Runtime JSON Truth

Use one canonical dynamic JSON representation per runtime:

- TypeScript service code: `JsonValue` and `JsonObject` from `@bufbuild/protobuf`
- Rust transport layer: generated `google.protobuf.Value` and `google.protobuf.Struct`
- Rust CLI input and render edges: `serde_json::Value`

No other application-specific JSON tree is allowed in the source-api path.

## Public State Algebra

The public lifecycle is modeled as an explicit state machine.

### States

- `Draft`
  - Raw user intent before normalization.
- `Prepared`
  - Server-issued canonical prepared execution state.
- `ExecutedPage`
  - One successful execution step with a response body and optional
    continuation token.
- `Exhausted`
  - A successful execution step with no continuation token.
- `Rejected`
  - A terminal state for invalid input, authorization denial, malformed tokens,
    or any other rejected transition.
- `Expired`
  - A terminal state for otherwise valid but expired prepared or page tokens.
- `Invalidated`
  - A terminal state for prepared state that no longer matches current server
    truth, such as descriptor drift, source drift, or authz drift.

### Transitions

| Current state | Event | Next state |
| --- | --- | --- |
| `Draft` | `prepare` succeeds | `Prepared` |
| `Draft` | `prepare` fails validation or authorization | `Rejected` |
| `Prepared` | `execute` returns a page and next page token | `ExecutedPage` |
| `Prepared` | `execute` returns a page without next page token | `Exhausted` |
| `Prepared` | token is malformed or tampered | `Rejected` |
| `Prepared` | token is expired | `Expired` |
| `Prepared` | source, descriptor, or authz basis drifted | `Invalidated` |
| `ExecutedPage` | `continue` returns another page | `ExecutedPage` |
| `ExecutedPage` | `continue` returns final page | `Exhausted` |
| `ExecutedPage` | page token is malformed or tampered | `Rejected` |
| `ExecutedPage` | page token is expired | `Expired` |
| `ExecutedPage` | prepared state binding no longer matches | `Invalidated` |

## Internal Domain Algebra

The public states above are backed by three internal domain objects.

### `SourceApiDraft`

`SourceApiDraft` is the raw user request after transport decoding and before
normalization.

It contains:

- `org_slug`
- `source_key`
- `operation`
- optional `selector`
- optional `method_override`
- request headers
- optional `field_patch`
- optional body

It does not contain:

- page tokens
- request fingerprints
- provider-specific normalized metadata

### `PreparedSourceApi`

`PreparedSourceApi` is the canonical server-owned prepared state.

It contains enough information to:

- execute without re-normalizing the draft
- authorize against the normalized request shape
- derive a dry-run preview
- bind continuation state to one prepared request identity

It includes, at minimum:

- source identity
- provider identity
- descriptor version used for preparation
- normalized operation kind
- normalized selector and selector template when applicable
- normalized method and target URL or structured request payload
- normalized request headers
- normalized request body
- derived policy-relevant metadata such as header names and body paths
- issuance time and expiry time
- internal integrity binding for tokens

`PreparedSourceApi` is not a public API payload.

### `ProviderExecutionResult`

`ProviderExecutionResult` is the provider-owned effect result before transport
projection.

It contains:

- source projection for output
- operation and selector
- provider response headers that are part of the business payload
- content type
- one response body variant
- optional next continuation state

## Transition Ownership

Each transition owns one slice of truth production.

### Prepare Owns

- draft validation
- descriptor and source resolution for normalization
- normalization and defaulting
- derivation of policy-relevant metadata
- derivation of preview data
- issuance of `prepared_token`

Prepare must finish with either:

- a canonical `PreparedSourceApi`
- a projection derived from it
- or a terminal rejection

### Execute Owns

- decoding and validating `prepared_token`
- checking token version and expiry
- checking current descriptor, source, and authz validity against prepared
  basis
- executing the provider request from `PreparedSourceApi`
- issuing `next_page_token` when continuation exists

Execute must not:

- rebuild provider request shape from raw user draft
- silently re-prepare
- infer missing prepared fields from transport payload convenience fields

### Continue Owns

- decoding and validating `page_token`
- checking that the page token is bound to the same prepared execution identity
- executing the next provider continuation step
- issuing the next continuation token or exhausting the stream

Continue must not:

- accept a page token from another prepared request
- downgrade invalidation into implicit re-prepare

## Reducer and Effect Boundary

This rewrite is correct only if truth-changing logic remains pure and effects
stay explicit.

### Pure Domain Steps

- `prepare` reduces `SourceApiDraft` plus resolved server context into either
  `PreparedSourceApi` or a terminal rejection
- `execute` reduces `PreparedSourceApi` plus continuation input and current
  validity checks into either an execution-ready input or a terminal failure
- preview derivation is a pure projection from `PreparedSourceApi`
- token payload construction is a pure projection from canonical state

### Deferred Effects

- loading source and descriptor inputs
- loading current authz inputs
- signing and verifying tokens
- provider I/O
- parsing upstream response bytes
- writing request metadata to headers or trailers

Effects may supply inputs to the pure steps above, but they may not redefine
prepared truth once it exists.

Comment: if execution code still performs `describe -> normalize -> authorize`
inside execute, then the reducer and effect boundary is still wrong even if the
RPC names have been changed.

## Token Semantics

### Prepared Token

`prepared_token` is:

- opaque to the client
- signed by the server
- versioned
- time-bounded
- bound to one canonical `PreparedSourceApi`

The server may encode the prepared state directly in the token or encode a
server-owned handle, but only one model may exist in the implementation.

For this rewrite, the preferred model is:

- self-contained signed token carrying the prepared state snapshot and integrity
  metadata

The token must be sufficient to execute without requiring the original draft.

### Page Token

`next_page_token` is:

- opaque to the client
- signed by the server
- time-bounded
- bound to one prepared execution identity
- bound to one continuation state snapshot

It must never be valid across different prepared requests, even if the public
draft looks identical.

### No Public Fingerprints

Internal digests are allowed only as token-binding internals.

They must not appear in:

- protobuf payloads
- CLI render output
- verbose output
- user-facing logs

## Invalidation Rules

Prepared execution is valid only while all of the following remain true:

- token signature is valid
- token version is understood by the server
- token is not expired
- the source still exists
- the source still resolves to the same prepared source identity
- the descriptor basis used by preparation is still acceptable
- the current actor is still authorized for the prepared request

If any of those conditions fail, execute must reject with `Rejected`,
`Expired`, or `Invalidated`, not silently re-prepare.

## Failure Model

Failure is part of the state machine, not an exceptional side channel.

### Prepare Failures

- invalid draft input -> `Rejected`
- unsupported operation or selector misuse -> `Rejected`
- descriptor mismatch at prepare time -> `Rejected`
- authz denial -> `Rejected`

### Execute Failures

- malformed or tampered prepared token -> `Rejected`
- malformed or tampered page token -> `Rejected`
- expired prepared or page token -> `Expired`
- descriptor, source, or authz drift -> `Invalidated`
- provider call failure after successful preparation -> execution failure of the
  `Prepared` request, not a re-prepare event

Connect status codes should reflect the failure family, but the domain meaning
is the lifecycle state above.

## Global Invariants

The rewrite is correct only if all of the following remain true:

- there is exactly one public prepare-then-execute flow
- the CLI never executes a raw draft directly
- dry-run is prepare-only
- execute never re-normalizes raw user input
- one canonical prepared state exists per request
- one canonical dynamic JSON representation exists per runtime
- request IDs stay in Connect headers or trailers
- request fingerprints stay internal or do not exist
- page tokens are bound to prepared execution identity
- preview is a projection, not a source of truth

For the public wire projection, see
[source-api-contract.md](./source-api-contract.md).

For repository workstreams, see
[source-api-implementation.md](./source-api-implementation.md).

For proof obligations and completion criteria, see
[source-api-quality-bar.md](./source-api-quality-bar.md).
