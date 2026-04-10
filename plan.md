# Source API Rewrite Plan

## Mission

Rewrite `source_api` as a Connect/protobuf-native system.

This is a hard rewrite, not a migration plan.

- No backward compatibility.
- No feature flags.
- No dual path.
- No compatibility wrappers.
- Delete legacy surfaces instead of preserving them.

Comment: the current stack already uses `google.protobuf.Value` and
`google.protobuf.Struct` on the wire, but immediately collapses them into a
second application-specific JSON AST. The rewrite removes that split.

## Hard Rules

- Replace the existing public `source_api.proto` surface in place. Do not add a
  `v2` package or a compatibility namespace.
- Remove `NormalizeSourceApi`.
- Remove `requestFingerprint` from every public message and every CLI output.
- Remove `request_id` from protobuf payloads. Use Connect response headers for
  transport metadata.
- Remove `SourceApiJsonValue`.
- Remove any recursive copier that translates protobuf JSON into a second custom
  JSON tree.
- Ban `JSON.parse(JSON.stringify(...))`.
- Keep CLI to server transport on Connect with protobuf binary encoding only.
- Allow JSON parsing only at explicit external edges:
  - CLI stdin and CLI flags into request bodies
  - upstream HTTP JSON response bytes into JSON values
  - CLI rendering and `jq` or `jaq` output transforms
- Use one canonical dynamic JSON representation per runtime:
  - TypeScript: `JsonValue` and `JsonObject` from `@bufbuild/protobuf`
  - Rust transport: generated `google.protobuf.Value` and `Struct`
  - Rust CLI render and input edge: `serde_json::Value`

## Reference Directories In `.tmp/`

These directories are the primary external references for the rewrite. Treat
them as read-only.

### Tier 1: Direct Design Inputs

- `.tmp/connect-rust-repo`
  - Reference for Connect-native Rust client and server behavior.
  - Use for:
    - `ClientConfig` defaults
    - protobuf-vs-JSON codec boundaries
    - Connect protocol expectations
    - examples of WKT handling in Rust
- `.tmp/connect-rust-repo/examples/multiservice`
  - Reference for direct usage of `google.protobuf.Struct` and `Value` in real
    Rust service and client code.
  - Use for:
    - arbitrary metadata modeling
    - WKT-first APIs
    - example-level ergonomics for prepared execution payloads
- `.tmp/connect-rust-repo/docs`
  - Reference for protocol intent and runtime semantics.
  - Use for:
    - transport metadata boundaries
    - Connect error and header conventions
    - codegen and runtime expectations
- `.tmp/connect-es-repo`
  - Reference for Connect ES protocol behavior and JSON handling.
  - Use for:
    - parsed JSON request body behavior
    - Connect error JSON shape
    - how Connect keeps protocol concerns out of business payloads
- `.tmp/protobuf-es-repo`
  - Reference for protobuf-es canonical JSON and WKT modeling.
  - Use for:
    - `JsonValue` and `JsonObject`
    - `google.protobuf.Struct` and `Value`
    - `toJson()` and `fromJson()` semantics

### Tier 2: Tooling And Schema Inputs

- `.tmp/buf-repo`
  - Reference for Buf-oriented schema workflow and generated API expectations.
  - Use for:
    - proto evolution discipline during the rewrite
    - generation workflow sanity checks
- `.tmp/hono-connect-example-repo`
  - Optional reference for Connect middleware integration on the TypeScript side.
  - Use only if request parsing or middleware boundaries need clarification.

### Explicit Non-References

Do not spend design time in unrelated `.tmp` directories for this rewrite.
Ignore repositories that are not directly about:

- Connect protocol behavior
- protobuf WKT JSON modeling
- schema and codegen workflow

## Target State

### Public State Machine

The public workflow becomes:

`Draft -> Prepared -> Executed -> Continued`

The CLI must never execute a raw draft directly. It always prepares first.

### Public RPC Surface

Keep `DescribeSourceApi`.

Replace the rest of the public API with:

1. `PrepareSourceApi`
2. `ExecutePreparedSourceApi`

`PrepareSourceApi` accepts a raw draft request and returns:

- an opaque signed prepared token
- a preview object for dry-run output

`ExecutePreparedSourceApi` accepts:

- the prepared token
- an optional opaque page token

`ExecutePreparedSourceApi` returns:

- provider response metadata that is part of the business payload
- response body
- optional next page token

### Token Model

Prepared execution must be an explicit server-issued state, not an implicit
"repeat normalization during execute" behavior.

- `prepared_token` is opaque and signed.
- `prepared_token` encodes the canonical prepared request plus integrity data.
- `next_page_token` is opaque and signed.
- `next_page_token` is bound to the prepared request identity internally.
- No public request fingerprint field exists anywhere.

Internal request digests are allowed, but they stay internal to the server and
opaque tokens. They are not part of the user contract.

### Canonical Dynamic Value Model

For arbitrary JSON:

- object-only values use `google.protobuf.Struct`
- arbitrary JSON values use `google.protobuf.Value`

TypeScript server code must use protobuf-es JSON-native types directly:

- `JsonObject` for object-only fields
- `JsonValue` for arbitrary JSON

Rust CLI transport code must use generated WKT types directly and convert at the
edge only.

## New Public Messages

The exact field names can change during implementation, but the shape should be
close to this:

```proto
message SourceApiDraft {
  string org_slug = 1;
  string source_key = 2;
  string operation = 3;
  optional string selector = 4;
  optional string method_override = 5;
  repeated CliSourceApiHeader headers = 6;
  optional google.protobuf.Struct field_patch = 7;
  oneof body {
    google.protobuf.Value json_body = 8;
    string text_body = 9;
    bytes binary_body = 10;
  }
}

message PrepareSourceApiRequest {
  SourceApiDraft draft = 1;
}

message PreparedSourceApiPreview {
  string source_key = 1;
  string provider = 2;
  string operation = 3;
  optional string selector = 4;
  string kind = 5;
  optional string method = 6;
  optional string host = 7;
  optional string url = 8;
  repeated string header_names = 9;
  string body_kind = 10;
  repeated string body_paths = 11;
  bool paginated = 12;
}

message PrepareSourceApiResponse {
  string prepared_token = 1;
  PreparedSourceApiPreview preview = 2;
}

message ExecutePreparedSourceApiRequest {
  string prepared_token = 1;
  optional string page_token = 2;
}

message ExecutePreparedSourceApiResponse {
  CliSourceApiSource source = 1;
  string operation = 2;
  optional string selector = 3;
  uint32 status = 4;
  repeated CliSourceApiHeader headers = 5;
  string content_type = 6;
  oneof body {
    google.protobuf.Value json = 7;
    string text = 8;
    bytes binary = 9;
  }
  optional string next_page_token = 10;
}
```

Notes:

- `request_id` is intentionally absent.
- `requestFingerprint` is intentionally absent.
- preview fields are execution-relevant only.
- transport metadata stays in Connect headers or trailers, not in business
  payloads.

## Workstreams

### 1. Replace the Proto Contract

- Rewrite `proto/onequery/cli/v1/source_api.proto` around the new prepared
  execution model.
- Rewrite `proto/onequery/cli/v1/cli.proto` to remove `NormalizeSourceApi` and
  add `PrepareSourceApi` plus `ExecutePreparedSourceApi`.
- Regenerate code for TypeScript and Rust.
- Remove every generated reference to the old normalize RPC and old plan
  messages.

Deliverable:

- one stable proto surface with no compatibility layer and no obsolete messages

### 2. Replace the TypeScript Domain Model

- Delete `SourceApiJsonValue` from
  `packages/server/src/source-api/types.ts`.
- Replace `fieldPatch?: Record<string, unknown>` with `fieldPatch?: JsonObject`.
- Replace JSON request and response bodies with `JsonValue`.
- Split the domain into explicit states:
  - `SourceApiDraft`
  - `PreparedSourceApi`
  - `ProviderExecutionResult`
- Keep any request digest internal to `PreparedSourceApi` only if needed for
  token binding.

Deliverable:

- one domain model with no custom JSON AST and no public normalization plan type

### 3. Replace the Connect Service Conversion Layer

- Delete `toSourceApiJsonValue()` from
  `packages/cli-server/src/connect/service/conversions.ts`.
- Convert between protobuf WKT values and protobuf-es `JsonValue` or `JsonObject`
  exactly once at the Connect boundary.
- Move all protobuf-specific conversion helpers into one focused module.
- Ensure the service layer does not perform business normalization during
  execute. Prepare once, execute once.

Deliverable:

- one thin Connect boundary with one conversion step in each direction

### 4. Replace the Provider Adapter Contract

- Change provider adapters so they accept a prepared request, not a raw draft.
- Normalize HTTP helpers so JSON parsing happens exactly once when upstream bytes
  enter the system.
- Remove duplicated JSON response parsers where the shared HTTP helper can own
  the behavior.
- Keep provider-specific parsing only where it changes semantics, such as
  provider-specific sanitization.
- Remove any helper that clones JSON by stringifying and parsing.

Deliverable:

- provider adapters that only implement provider logic, not cross-layer format
  shims

### 5. Replace the Rust CLI Transport Model

- Stop using `serde_json::Value` as the transport model in
  `apps/cli/crates/onequery-cli/src/transport/source_api.rs`.
- Use generated WKT message types for request and response bodies at the
  transport boundary.
- Centralize edge conversion helpers:
  - parse CLI input into WKT values
  - render WKT values into `serde_json::Value`
- Keep `serde_json::Value` only in command parsing, rendering, and `jq` or
  `jaq` plumbing.

Deliverable:

- CLI transport code that matches the protobuf contract directly

### 6. Replace the CLI Command Flow

- New flow for normal execution:
  1. build `SourceApiDraft`
  2. call `PrepareSourceApi`
  3. call `ExecutePreparedSourceApi`
- New flow for `--dry-run`:
  1. build `SourceApiDraft`
  2. call `PrepareSourceApi`
  3. render preview only
- Pagination flow:
  1. reuse `prepared_token`
  2. pass `next_page_token` back to `ExecutePreparedSourceApi`
- Default JSON output remains body-first.
- Verbose output can show preview and provider metadata, but not transport-only
  metadata embedded in payloads.

Deliverable:

- one deterministic CLI state machine with no hidden re-normalization

### 7. Delete Legacy Surfaces

Delete all of the following:

- `NormalizeSourceApi` RPC
- public `CliSourceApiPlan`
- public `request_fingerprint`
- response payload `request_id`
- `SourceApiJsonValue`
- `toSourceApiJsonValue()`
- any `JSON.parse(JSON.stringify(...))` usage in source-api code
- any source-api specific compatibility branch for old plan responses
- any output renderer path that expects `requestFingerprint`

Deliverable:

- zero dead branches and zero compatibility code in the new source-api path

### 8. Verification and Test Bar

- Add TypeScript unit tests for WKT request and response body round-trips using
  real `google.protobuf.Value` and `Struct`.
- Add Rust unit tests for CLI edge conversion helpers:
  - stdin JSON to WKT
  - WKT to rendered JSON
- Add end-to-end tests for:
  - prepare only dry-run preview
  - execute prepared request with JSON response body
  - execute prepared request with text response body
  - paginated execution with tamper-resistant page tokens
- Add negative tests for:
  - modified prepared token
  - page token bound to a different prepared request
  - invalid `Struct` where object-only payload is required
- Add grep-style enforcement in CI for deleted legacy names.

Deliverable:

- green tests with explicit coverage of the new state machine and token model

## Concrete Deletion Targets

These should disappear from the codebase as part of the rewrite:

- `packages/server/src/source-api/types.ts: SourceApiJsonValue`
- `packages/cli-server/src/connect/service/conversions.ts: toSourceApiJsonValue`
- `apps/cli/crates/onequery-cli/src/commands/source_api/*` paths that depend on
  normalize-plan payloads
- `apps/cli/crates/onequery-cli/src/transport/source_api.rs: request_fingerprint`
- `proto/onequery/cli/v1/source_api.proto: CliSourceApiPlan.request_fingerprint`
- any source-api code that writes request IDs into protobuf payloads
- any source-api code that clones JSON through stringify and parse

## Definition of Done

The rewrite is done when all of the following are true:

- there is exactly one public prepare-then-execute flow
- there is no public normalization-plan payload
- there is no public request fingerprint field
- there is no custom application JSON AST in source-api code
- Connect headers carry transport metadata instead of protobuf payload fields
- Rust CLI transport types mirror the protobuf contract directly
- upstream JSON bytes are parsed once at ingress and rendered once at egress
- all source-api tests pass
- grep for `requestFingerprint`, `NormalizeSourceApi`, `SourceApiJsonValue`, and
  `JSON.parse(JSON.stringify` returns nothing in the new source-api path
