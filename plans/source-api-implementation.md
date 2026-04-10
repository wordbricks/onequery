# Source API Rewrite Implementation Plan

This document executes the normative design in
[source-api-ssot.md](./source-api-ssot.md) and
[source-api-contract.md](./source-api-contract.md).

It does not redefine the state machine or the public contract.

## Progress Board

- [x] 1. Replace the proto contract and regenerate bindings
- [ ] 2. Replace the TypeScript domain model with prepared execution truth
- [ ] 3. Replace the Connect boundary and service handlers
- [ ] 4. Replace provider adapter execution and pagination binding
- [ ] 5. Replace the Rust transport layer
- [ ] 6. Replace the CLI command flow and rendering
- [ ] 7. Delete legacy surfaces from the source-api path
- [ ] 8. Pass the quality bar and completion checks

## Current Shape To Remove

Today the public surface is still:

- `DescribeSourceApi`
- `NormalizeSourceApi`
- `ExecuteSourceApi`

and the implementation still spreads truth across:

- protobuf messages
- a custom TypeScript JSON AST
- Connect conversion helpers that rebuild JSON trees
- Rust transport structs serialized through `serde_json::Value`

Comment: the current execute path still performs describe and normalize during
execute, which means the prepared state is not yet first-class.

Comment: the current CLI dry-run path already strips `requestFingerprint` from
rendered output after receiving it, which is a good sign that the field should
never have been public.

## Workstream Order

Implement in this order:

1. proto contract and generated code
2. TypeScript domain model
3. Connect boundary and service handlers
4. provider adapters and pagination helpers
5. Rust transport layer
6. CLI command flow and rendering
7. legacy cleanup
8. quality bar verification

## 1. Replace the Proto Contract

Files:

- `proto/onequery/cli/v1/source_api.proto`
- `proto/onequery/cli/v1/cli.proto`

Changes:

- [x] Remove `NormalizeSourceApiRequest`, `NormalizeSourceApiResponse`, and
  `CliSourceApiPlan`.
- [x] Replace `ExecuteSourceApiRequest` with
  `ExecutePreparedSourceApiRequest`.
- [x] Replace `ExecuteSourceApiResponse` with
  `ExecutePreparedSourceApiResponse`.
- [x] Add `SourceApiDraft`, `PrepareSourceApiRequest`,
  `PrepareSourceApiResponse`, and `PreparedSourceApiPreview`.
- [x] Remove `request_id` from protobuf payloads.
- [x] Reserve deleted field numbers and names where required by schema hygiene.

Generation:

- [x] Regenerate TypeScript and Rust bindings after the schema rewrite.

Deliverable:

- one public proto surface with no compatibility messages and no public plan
  type

## 2. Replace the TypeScript Domain Model

Files:

- `packages/server/src/source-api/types.ts`
- `packages/server/src/source-api/normalize.ts`
- `packages/server/src/source-api/execute.ts`
- `packages/server/src/source-api/policy.ts`
- `packages/server/src/source-api/helpers/pagination.ts`

Changes:

- [ ] Delete `SourceApiJsonValue`.
- [ ] Replace `SourceApiExecuteRequest` with a `SourceApiDraft`-shaped domain
  input.
- [ ] Add an explicit `PreparedSourceApi` domain type.
- [ ] Add a `PreparedSourceApiPreview` projection type if the service layer
  needs a concrete return value before transport projection.
- [ ] Make provider execution operate on `PreparedSourceApi`, not on a
  normalized plan derived inside execute.
- [ ] Replace request and response JSON fields with protobuf-es `JsonValue`.
- [ ] Replace object-only patches with `JsonObject`.
- [ ] Replace pagination token payloads so they bind to prepared execution
  identity, not public request fingerprints.

Deliverable:

- one domain model whose execution truth is `PreparedSourceApi`

## 3. Replace the Connect Boundary and Service Handlers

Files:

- `packages/cli-server/src/connect/service.ts`
- `packages/cli-server/src/connect/service/source_api.ts`
- `packages/cli-server/src/connect/service/conversions.ts`

Changes:

- [ ] Remove `handleNormalizeSourceApi`.
- [ ] Add `handlePrepareSourceApi`.
- [ ] Add `handleExecutePreparedSourceApi`.
- [ ] Remove `fromCliNormalizeSourceApiRequest()` and
  `toCliNormalizeSourceApiResponse()`.
- [ ] Delete `toSourceApiJsonValue()`.
- [ ] Convert WKT values into protobuf-es `JsonValue` or `JsonObject` exactly
  once at the Connect boundary.
- [ ] Keep `x-request-id` in headers and trailers only.
- [ ] Make execute decode the prepared token and route the canonical prepared
  state to the domain, rather than rebuilding it from a raw invocation.

Deliverable:

- one thin Connect boundary with one conversion step in each direction

## 4. Replace the Provider Adapter Contract

Files:

- `packages/server/src/source-api/registry.ts`
- `packages/server/src/source-api/adapters/*`
- `packages/server/src/source-api/helpers/http-rest.ts`
- `packages/server/src/source-api/helpers/structured.ts`
- `packages/server/src/source-api/helpers/pagination.ts`

Changes:

- [ ] Change adapter execution input from normalized plan to
  `PreparedSourceApi`.
- [ ] Keep provider adapters responsible only for provider semantics.
- [ ] Move generic HTTP normalization and JSON parsing into shared helpers.
- [ ] Parse upstream JSON bytes once at ingress.
- [ ] Remove duplicated parsers where shared helpers can own the behavior.
- [ ] Bind continuation tokens to prepared execution identity and continuation
  state.

Deliverable:

- provider adapters that consume prepared state and do not own cross-layer
  format shims

## 5. Replace the Rust Transport Layer

Files:

- `apps/cli/crates/onequery-cli/src/transport/source_api.rs`
- `apps/cli/crates/onequery-cli/src/transport/http.rs`

Changes:

- [ ] Remove transport-owned serde structs for source-api payload truth where
  generated protobuf types can be used directly.
- [ ] Stop using `serde_json::Value` as the transport model for request and
  response bodies.
- [ ] Use generated WKT message types directly at the transport boundary.
- [ ] Keep `response_request_id()` and request ID handling in header metadata.
- [ ] Add narrow conversion helpers for CLI input into generated WKT values.
- [ ] Add narrow conversion helpers for generated WKT values into renderable
  `serde_json::Value`.

Deliverable:

- Rust transport that mirrors the protobuf contract directly

## 6. Replace the CLI Command Flow

Files:

- `apps/cli/crates/onequery-cli/src/commands/source_api/mod.rs`
- `apps/cli/crates/onequery-cli/src/commands/source_api/plan.rs`
- `apps/cli/crates/onequery-cli/src/commands/source_api/render.rs`
- `apps/cli/crates/onequery-cli/src/commands/source_api/intent.rs`

Command behavior:

- normal execution:
  1. build `SourceApiDraft`
  2. call `PrepareSourceApi`
  3. call `ExecutePreparedSourceApi`
- `--dry-run`:
  1. build `SourceApiDraft`
  2. call `PrepareSourceApi`
  3. render preview only
- pagination:
  1. retain `prepared_token`
  2. pass the latest `next_page_token` back to `ExecutePreparedSourceApi`

Changes:

- [ ] Remove normalize-specific transport and presentation code.
- [ ] Render preview output from `PreparedSourceApiPreview`.
- [ ] Stop expecting `requestFingerprint` anywhere.
- [ ] Keep request ID presentation sourced from header metadata, not payload
  fields.
- [ ] Keep default output body-first.
- [ ] Allow verbose output to show preview and business metadata without
  exposing token internals.

Deliverable:

- one deterministic CLI state machine with no hidden re-normalization

## 7. Delete Legacy Surfaces

These names and shapes must disappear from the new source-api path:

- [ ] `NormalizeSourceApi`
- [ ] `CliSourceApiPlan`
- [ ] `ExecuteSourceApiRequest`
- [ ] `ExecuteSourceApiResponse.request_id`
- [ ] `SourceApiJsonValue`
- [ ] `toSourceApiJsonValue()`
- [ ] public `request_fingerprint`
- [ ] public `requestFingerprint`
- [ ] source-api compatibility branches for normalized plan responses
- [ ] source-api code that clones JSON through `JSON.parse(JSON.stringify(...))`

## 8. Quality Bar Verification

Completion checks, verification requirements, and the "Jane Street level"
quality bar live in
[source-api-quality-bar.md](./source-api-quality-bar.md).

Do not mark the final progress item done until that document is fully checked.
