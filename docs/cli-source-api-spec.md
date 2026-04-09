# Spec: rewrite `onequery use` as the source API client

## Decision summary

- Public command name stays **`onequery use`** in this cutover.
- Internal architecture, modules, and RPC names use **`source_api`**, not `use`.
- This is a **hard cutover**. Do not keep backward compatibility with the current provider-enum / markdown-skill behavior.
- `onequery use` becomes **source-key based**, not provider based.
- Both **describe** and **execute** go through **Connect RPC**. The CLI must not call `/api/data-sources/{provider}/query` directly.
- The server owns the canonical source API registry, validation, normalization, authorization hook, execution, and pagination state.

## Current problems to remove

- `UseSource` and `CliUseSource` duplicate the supported provider list across Rust, proto, and TypeScript.
- `onequery use` mixes two unrelated behaviors: load markdown skill text vs execute raw provider relay JSON.
- `load_use_skill()` uses Connect, but `execute_use_input()` bypasses Connect and posts to `/api/data-sources/{source}/query`.
- `packages/cli-server/src/use/skills.ts` is human documentation, not a canonical API descriptor.
- Provider request schemas live in `packages/server/src/routes/data-sources/*-query.ts`, separate from the CLI skill text.
- Current execution is provider-centric, not source-centric. It cannot cleanly support multiple connected sources of the same provider.
- Current `CommandOutput` is structured for normal CLI commands, not raw API-style status/headers/body output.

## Final command contract

### Usage

```text
onequery use --source <SOURCE_KEY>
onequery use --source <SOURCE_KEY> [<TARGET>] [flags]
onequery use --source <SOURCE_KEY> --op <OPERATION> [<SELECTOR>] [flags]
```

### Resolution rules

- `--source <SOURCE_KEY>` is required and always means the connected source key.
- Authenticated session and resolved org are required for both describe and execute.
- If only `--source` is provided, the command describes the source API surface.
- If `--op` is provided, positional `<TARGET>` is treated as the selector.
- If `--op` is not provided:
  - if `<TARGET>` starts with `/`, `http://`, or `https://`, treat it as a selector and use the descriptor's `default_path_operation`;
  - otherwise treat `<TARGET>` as the operation name.
- If request-construction flags are present but neither an operation nor a selector can be resolved, fail with a local parse error.

### Flags

- `--source <SOURCE_KEY>`: required.
- `--op <OPERATION>`: explicit operation name.
- `-X, --method <METHOD>`: only for `http_request` operations.
- `-H, --header <KEY:VALUE>`: repeated; allowed header names come from the descriptor.
- `-f, --raw-field <KEY=VALUE>`: repeated string field patch.
- `-F, --field <KEY=VALUE>`: repeated typed field patch.
- `--input <PATH|->`: request body input.
- `--paginate`: follow opaque server-issued page tokens.
- `--slurp`: combine paginated bodies into one JSON array before formatting.
- `--max-pages <N>`: hard client-side pagination cap.
- `-i, --include`: include upstream status and allowed response headers.
- `--silent`: suppress body output.
- `-q, --jq <EXPR>`: apply JSON selection after response assembly.
- `--dry-run`: print normalized request plan with redactions; do not execute.

### Request construction rules

- `-f` always writes a string value.
- `-F` parses JSON first; otherwise parses `true`, `false`, `null`, integers, and floats; otherwise uses a string.
- `@path` and `@-` read UTF-8 text before parsing.
- `key[subkey]=value` builds nested objects.
- `key[]=value` appends array items.
- Duplicate writes to the same non-array path are a local error.
- `--input` behavior:
  - for `structured_request`, parse JSON as the initial request object, then merge field patches over it;
  - for `http_request`, treat input as the request body; field patches follow the operation's field policy.

### Output contract

Text mode:
- JSON body: pretty JSON.
- Text body: verbatim.
- Binary body: write raw bytes only when stdout is not a TTY; otherwise fail with a local render error.
- `--include`: print status line, allowed headers, blank line, then body.

JSON mode:
- `onequery use` does **not** use the generic `{ ok, data }` envelope.
- It emits a command-specific API object.

Example JSON-mode shape:

```json
{
  "source": { "key": "github-prod", "provider": "github" },
  "operation": "fetch",
  "selector": "/pulls",
  "status": 200,
  "headers": {
    "content-type": "application/json"
  },
  "contentType": "application/json",
  "body": [{ "id": 1 }],
  "requestId": "rq_123"
}
```

## Transport contract

### Proto changes

- Delete `proto/onequery/cli/v1/use.proto`.
- Add `proto/onequery/cli/v1/source_api.proto`.
- Update `proto/onequery/cli/v1/cli.proto`:
  - remove `import "onequery/cli/v1/use.proto";`
  - remove `rpc Use(UseRequest) returns (UseResponse);`
  - add `rpc DescribeSourceApi(DescribeSourceApiRequest) returns (DescribeSourceApiResponse);`
  - add `rpc ExecuteSourceApi(ExecuteSourceApiRequest) returns (ExecuteSourceApiResponse);`

### Proto shape

Use `google.protobuf.Struct` / `google.protobuf.Value` for dynamic JSON only where needed.

```proto
message DescribeSourceApiRequest {
  string org_slug = 1;
  string source_key = 2;
}

message DescribeSourceApiResponse {
  CliSourceApiSource source = 1;
  string descriptor_version = 2;
  optional string default_path_operation = 3;
  repeated CliSourceApiOperation operations = 4;
  repeated CliSourceApiExample examples = 5;
  repeated string notes = 6;
}

message ExecuteSourceApiRequest {
  string org_slug = 1;
  string source_key = 2;
  optional string descriptor_version = 3;
  string operation = 4;
  optional string selector = 5;
  optional string method_override = 6;
  repeated CliSourceApiHeader headers = 7;
  optional google.protobuf.Struct field_patch = 8;
  oneof body {
    google.protobuf.Value json_body = 9;
    string text_body = 10;
    bytes binary_body = 11;
  }
  optional string page_token = 12;
}

message ExecuteSourceApiResponse {
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
  optional string request_id = 10;
  optional string next_page_token = 11;
}
```

Required descriptor fields:

- `CliSourceApiSource`: `key`, `provider`, optional `display_name`.
- `CliSourceApiOperation`:
  - `name`
  - `kind`: `HTTP_REQUEST | STRUCTURED_REQUEST`
  - `summary`
  - `description`
  - `selector_kind`: `NONE | PATH | IDENTIFIER`
  - `selector_label`
  - `method_policy`: default + allowed methods
  - `field_policy`: raw field support, typed field support, syntax, transport rules
  - `header_policy`: allowed request header names
  - `pagination_policy`: `NONE | OPAQUE_TOKEN`
  - repeated examples and notes

### RPC rules

- `DescribeSourceApi` must validate org access and source access.
- `ExecuteSourceApi` must validate org access, source access, operation validity, and permission hooks before execution.
- Pagination tokens are opaque, short-lived, and bound to source key, operation, normalized request fingerprint, and descriptor version.
- The CLI never invents or decodes page tokens.

## Server architecture

### Canonical domain

Add a single canonical source API domain under `packages/server/src/source-api/`:

```text
packages/server/src/source-api/
  types.ts
  registry.ts
  describe.ts
  normalize.ts
  authorize.ts
  execute.ts
  policy.ts
  adapters/
    github.ts
    ga.ts
    mongodb.ts
    amplitude.ts
    mixpanel.ts
    posthog.ts
    sentry.ts
  helpers/
    http-rest.ts
    structured.ts
    pagination.ts
```

### Adapter contract

Each provider adapter implements:

```ts
type SourceApiAdapter = {
  provider: ProviderType;
  describe(input: { source: ConnectedSource; actor: ActorContext }): Promise<SourceApiDescriptor>;
  normalize(input: {
    source: ConnectedSource;
    actor: ActorContext;
    descriptor: SourceApiDescriptor;
    request: ExecuteSourceApiRequest;
  }): Promise<NormalizedExecutionPlan>;
  execute(input: {
    source: ConnectedSource;
    actor: ActorContext;
    plan: NormalizedExecutionPlan;
  }): Promise<ExecuteSourceApiResponse>;
};
```

### Required pipeline

All execution must follow this order:

```text
describe -> normalize -> authorize -> execute
```

Do not authorize or execute directly from raw CLI args or raw RPC payloads.

### Normalized plan

`normalize.ts` must produce a canonical plan that is stable enough for later fine-grained permissions.

```ts
type NormalizedExecutionPlan = {
  sourceId: string;
  sourceKey: string;
  provider: ProviderType;
  operation: string;
  kind: "http_request" | "structured_request";
  method?: string;
  selector?: string;
  selectorTemplate?: string;
  host?: string;
  headerNames: string[];
  bodyKind: "none" | "json" | "text" | "binary";
  bodyPaths?: string[];
  requestFingerprint: string;
  descriptorVersion?: string;
};
```

### Adapter families

Start with two helper families:

- `http-rest.ts`: GitHub, Sentry, Amplitude, Mixpanel fallback REST, PostHog fallback REST.
- `structured.ts`: GA, MongoDB, other operation-driven providers.

New providers should be added as descriptor + adapter code on top of one of these helpers whenever possible.

### Route migration

Current provider route logic must move into adapters:

- `packages/server/src/routes/data-sources/github-query.ts` -> `packages/server/src/source-api/adapters/github.ts`
- `packages/server/src/routes/data-sources/ga-query.ts` -> `packages/server/src/source-api/adapters/ga.ts`
- `packages/server/src/routes/data-sources/mongodb-query.ts` -> `packages/server/src/source-api/adapters/mongodb.ts`
- same pattern for amplitude, mixpanel, posthog, sentry

If `/api/data-sources/*/query` routes remain for non-CLI callers, they must become thin wrappers over the same source-api domain. They are not the CLI contract anymore.

## CLI server architecture

### Connect service

Replace the `use` service handler with a source-api transport wrapper:

```text
packages/cli-server/src/connect/service/source_api.ts
```

Responsibilities:
- resolve session and authorized org context;
- load source by `source_key`;
- call `packages/server/src/source-api/*`;
- map domain objects to generated Connect messages;
- never carry provider lists or markdown skills.

### Required repo changes

- Delete `packages/cli-server/src/use/skills.ts`.
- Delete `packages/cli-server/src/connect/service/use.ts`.
- Remove `CliUseSource` conversion helpers from `packages/cli-server/src/connect/service/conversions.ts`.
- Update `packages/cli-server/src/connect/service.ts` to register `describeSourceApi` and `executeSourceApi`.
- Regenerate `packages/cli-server/src/connect/gen/**` from proto.

## Rust CLI architecture

### Args

Replace the current `UseArgs` with a source-key based request builder.

```rust
pub(crate) struct UseArgs {
    pub source: String,
    pub op: Option<String>,
    pub target: Option<String>,
    pub method: Option<String>,
    pub headers: Vec<String>,
    pub raw_fields: Vec<String>,
    pub fields: Vec<String>,
    pub input: Option<String>,
    pub paginate: bool,
    pub slurp: bool,
    pub max_pages: Option<u32>,
    pub include: bool,
    pub silent: bool,
    pub jq: Option<String>,
    pub dry_run: bool,
}
```

### Modules

Add:

```text
apps/cli/crates/onequery-cli/src/commands/source_api/
  mod.rs
  args.rs
  intent.rs
  field_patch.rs
  plan.rs
  workflow.rs
  render.rs
  format.rs
  tests.rs

apps/cli/crates/onequery-cli/src/transport/source_api.rs
```

Remove:

- `apps/cli/crates/onequery-cli/src/transport/use_source.rs`
- `apps/cli/crates/onequery-cli/src/transport/use_cmd.rs`
- current `apps/cli/crates/onequery-cli/src/commands/use_cmd.rs`

`commands/use_cmd.rs` may remain only as a tiny compatibility-free delegate to `commands::source_api::execute()` if that keeps command registration simpler.

### CLI rules

- Clap must parse `--source` as a plain string, not `ValueEnum`.
- All describe/execute behavior must depend on the server descriptor, not Rust enums.
- The CLI must load the descriptor before it decides how to interpret fields, headers, pagination, selector shape, or output formatting.

### Output

`CommandOutput` must support an API response mode.

Required design:

```rust
enum OutputPayload {
    Structured { data: Value },
    Api {
        status: Option<u16>,
        headers: Vec<(String, String)>,
        body: ApiBody,
        request_id: Option<String>,
    },
}
```

`onequery use` must render through `OutputPayload::Api`, not the generic structured JSON envelope.

## Authorization design

### Coarse actions

Add two explicit CLI actions:

- `source_api.describe`
- `source_api.execute`

Do not overload `source.list` or `query.execute` for the new command.

### Fine-grained hook

Do not ship endpoint/method rules in this cutover, but the hook must exist now.

Required server function:

```ts
authorizeSourceApi(plan: NormalizedExecutionPlan, actor: ActorContext): Promise<void>
```

The initial implementation may only enforce coarse capability checks, but it must receive the normalized plan so method/selector-specific rules can be added later without changing the execution pipeline.

## Implementation checklists

### 1) Proto and generation

- [x] Add `proto/onequery/cli/v1/source_api.proto`.
- [ ] Delete `proto/onequery/cli/v1/use.proto`.
- [ ] Update `proto/onequery/cli/v1/cli.proto` imports and RPCs.
- [ ] Add generated TS and Rust code for the new RPCs and messages.
- [ ] Remove generated `use_pb` references from TS and Rust.

### 2) Server source-api domain

- [ ] Add `packages/server/src/source-api/types.ts` with canonical descriptor, plan, response, and policy types.
- [ ] Add `packages/server/src/source-api/registry.ts`.
- [ ] Add `describe.ts`, `normalize.ts`, `authorize.ts`, and `execute.ts`.
- [ ] Add `helpers/http-rest.ts`.
- [ ] Add `helpers/structured.ts`.
- [ ] Add opaque pagination token helper in `helpers/pagination.ts`.
- [ ] Export the new domain from `@onequery/server` if needed by `@onequery/cli-server`.

### 3) Provider migration

- [ ] Move GitHub relay behavior from `routes/data-sources/github-query.ts` into `source-api/adapters/github.ts`.
- [ ] Move GA relay behavior from `routes/data-sources/ga-query.ts` into `source-api/adapters/ga.ts`.
- [ ] Move MongoDB relay behavior from `routes/data-sources/mongodb-query.ts` into `source-api/adapters/mongodb.ts`.
- [ ] Move Amplitude, Mixpanel, PostHog, and Sentry relay behavior into corresponding adapters.
- [ ] Keep request validation next to the adapter definition; do not leave runtime schema in the old route file.
- [ ] Remove markdown skill content as a source of truth.

### 4) CLI server transport

- [ ] Add `packages/cli-server/src/connect/service/source_api.ts`.
- [ ] Replace `handleUse` registration in `packages/cli-server/src/connect/service.ts`.
- [ ] Remove `packages/cli-server/src/use/skills.ts`.
- [ ] Remove `fromCliUseSource` / `toCliUseSourceEnum` from `packages/cli-server/src/connect/service/conversions.ts`.
- [ ] Add conversions for source-api descriptor and execute response messages.
- [ ] Update tests to call `DescribeSourceApi` and `ExecuteSourceApi`.

### 5) Rust CLI parser and transport

- [ ] Replace `UseArgs` in `apps/cli/crates/onequery-cli/src/cli/args.rs`.
- [ ] Remove `UseSource` enum usage from `cli/mod.rs`, `labels.rs`, and any snapshots.
- [ ] Add `commands/source_api/*` modules.
- [ ] Add `transport/source_api.rs`.
- [ ] Delete `transport/use_source.rs` and `transport/use_cmd.rs`.
- [ ] Replace `commands/use_cmd.rs` implementation.
- [ ] Update help text and usage snapshots for `onequery use`.

### 6) Output and formatting

- [ ] Extend `apps/cli/crates/onequery-cli/src/output.rs` with API output mode.
- [ ] Ensure JSON mode for `onequery use` bypasses the generic `{ ok, data }` envelope.
- [ ] Support `--include`, `--silent`, `--paginate`, `--slurp`, and `--jq` in the source-api renderer.
- [ ] Reject binary-to-TTY output with a clear render error.

### 7) Authorization hook

- [ ] Add `source_api.describe` and `source_api.execute` to `packages/cli-server/src/authorization.ts` and underlying org permission wiring.
- [ ] Add `authorizeSourceApi(plan, actor)` to the server source-api domain.
- [ ] Call the authorization hook after normalization and before execution.
- [ ] Ensure the plan includes method, selector, headers, and body kind even before fine-grained policy rules ship.

### 8) Remove current `use` architecture

- [ ] Delete all `CliUseSource` references from proto, TS, and Rust.
- [ ] Delete markdown skill registry behavior.
- [ ] Delete direct CLI HTTP calls to `/api/data-sources/{provider}/query`.
- [ ] Delete provider-specific retry/help text that assumes `--source` is a provider enum.

## Test checklist

### Rust CLI

- [ ] Parse `-f`, `-F`, nested object syntax, array syntax, and `@file` input.
- [ ] Resolve describe vs execute intent correctly.
- [ ] Resolve `TARGET` as operation vs selector correctly.
- [ ] Render JSON/text/binary responses correctly.
- [ ] Render `--include`, `--paginate`, `--slurp`, and `--jq` correctly.

### CLI server / proto

- [ ] `DescribeSourceApi` rejects missing org/source access.
- [ ] `ExecuteSourceApi` rejects unsupported operations and invalid headers.
- [ ] `descriptor_version` mismatch returns a deterministic invalid-request or failed-precondition error.
- [ ] pagination tokens round-trip only for the same normalized request.

### Source-api domain

- [ ] Every descriptor example parses and normalizes successfully.
- [ ] Every described operation is executable by its adapter.
- [ ] Header allowlists are enforced.
- [ ] Normalized plan is stable for the same logical request.
- [ ] Authorization hook receives the normalized plan before execution.

### Extensibility

- [ ] Adding a new operation to an existing provider requires no Rust enum changes.
- [ ] Adding a new provider adapter requires no proto enum changes.
- [ ] Adding a new provider adapter requires no CLI parsing changes unless new generic flags are introduced.

## Acceptance criteria

- [ ] `onequery use --source <SOURCE_KEY>` describes the live source API surface for that connected source.
- [ ] `onequery use --source <SOURCE_KEY> /path ...` executes through Connect only.
- [ ] No part of the CLI depends on a hard-coded provider list for `use`.
- [ ] No part of the source API surface is documented only in markdown.
- [ ] The server owns source API descriptors, normalization, authorization hooks, execution, and pagination state.
- [ ] The command is ready for later endpoint/method-specific permissions without changing the high-level pipeline.
