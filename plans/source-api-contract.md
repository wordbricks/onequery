# Source API Public Contract

This document defines the public wire projection of the state machine in
[source-api-ssot.md](./source-api-ssot.md).

It owns:

- the public RPC surface
- protobuf message direction
- preview and execute semantics at the contract boundary
- canonical JSON boundary rules

If this document conflicts with the state machine SSoT, the state machine wins.

## Public RPC Surface

The public RPC surface keeps `DescribeSourceApi` and replaces the rest with:

1. `PrepareSourceApi`
2. `ExecutePreparedSourceApi`

### `DescribeSourceApi`

`DescribeSourceApi` remains the capability-discovery RPC.

Its job is to describe:

- supported operations
- selector requirements
- field policies
- request and response conventions

It does not prepare or execute anything.

### `PrepareSourceApi`

`PrepareSourceApi` accepts a `SourceApiDraft` and returns:

- `prepared_token`
- `PreparedSourceApiPreview`

The preview is a projection of prepared state for dry-run output only.

It is allowed to include execution-relevant fields such as:

- operation
- kind
- method
- selector
- host
- URL
- header names
- body kind
- body paths
- pagination policy

It is not allowed to include:

- request fingerprints
- transport request IDs
- token payload internals

### `ExecutePreparedSourceApi`

`ExecutePreparedSourceApi` accepts:

- `prepared_token`
- optional `page_token`

It returns:

- source metadata that is part of the business payload
- operation and optional selector
- status
- business response headers
- content type
- response body
- optional `next_page_token`

## Proto Direction

The target public message shape is approximately:

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
  CliSourceApiOperationKind kind = 5;
  optional string method = 6;
  optional string host = 7;
  optional string url = 8;
  repeated string header_names = 9;
  CliSourceApiBodyKind body_kind = 10;
  repeated string body_paths = 11;
  CliSourceApiPaginationPolicy pagination_policy = 12;
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

## Proto Rules

- Keep enum fields as enums, not ad hoc strings.
- Keep object-only payloads as `google.protobuf.Struct`.
- Keep arbitrary JSON payloads as `google.protobuf.Value`.
- Carry validation with `buf.validate`.
- Reserve removed field numbers and names when deleting old fields.

## Preview and Execute Semantics

### Preview

`PreparedSourceApiPreview` is an informational projection.

It must be derived from prepared state. It must never be the input to execute.

### Execute

`ExecutePreparedSourceApi` must decode the prepared token and execute the
embedded canonical prepared state. It must not rebuild provider input by
normalizing the raw draft again.

Allowed execute-time checks:

- token integrity
- token expiry
- current source existence
- descriptor or source invalidation checks
- current authorization against the prepared authorization view

Disallowed execute-time behavior:

- recomputing provider request shape from user draft
- exposing internal request digests
- returning transport metadata inside business payloads

## Canonical JSON Boundary Rules

### TypeScript

- Convert protobuf WKT values into protobuf-es `JsonValue` or `JsonObject`
  exactly once at the Connect boundary.
- All service, normalization, authorization, pagination, and adapter logic uses
  those canonical types directly.

### Rust

- The transport layer uses generated WKT types directly.
- Convert to `serde_json::Value` only at stdin parsing, renderer output, and
  `jq` or `jaq` plumbing.

### Upstream HTTP

- Parse JSON response bytes once when they enter the shared HTTP helper.
- Do not stringify and parse to clone JSON.
- Do not maintain separate provider-specific JSON trees unless semantics differ.
