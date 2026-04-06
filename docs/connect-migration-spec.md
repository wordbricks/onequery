# CLI transport migration spec: OpenAPI/orval/progenitor → Protobuf + Connect RPC

## Summary

Migrate the internal CLI transport from OpenAPI-generated REST bindings to a Protobuf/Connect RPC contract, using:

- **TypeScript server:** `connect-es` on top of the existing Hono-based CLI server.
- **Rust CLI:** `connect-rust` generated client.
- **Single source of truth:** `proto/` + Buf config, replacing `packages/cli-contract/openapi/**`.

This is a **direct cutover**. There is **no compatibility window**, **no dual stack**, and **no requirement to preserve the current package layout or REST path layout** beyond what is convenient internally.

A Bun runtime experiment is allowed as an early spike, but the migration target remains **Node.js runtime support**, because Connect-ES v2 is documented for Node.js, and Hono+Connect integration relies on Hono’s Node adapter and raw Node request/response access. Bun should be treated as **best-effort only**, not as a success criterion. citeturn897529view0turn201415view0turn973240view1turn550094view12

---

## Current repo impact (repo-specific)

The current OpenAPI contract is not isolated to one generator step. It leaks into several places that must be addressed explicitly:

1. **Contract source and generation**
   - `packages/cli-contract/openapi/source/**`
   - `packages/cli-contract/openapi/generated/cli.openapi.json`
   - `packages/cli-contract/orval.config.ts`
   - `packages/cli-contract/scripts/bundle-openapi.ts`

2. **TypeScript CLI server transport**
   - `packages/cli-server/generated/**`
   - all handler modules under `packages/cli-server/src/transport/handlers/*`
   - `packages/cli-server/src/route.ts`
   - `packages/cli-server/src/contract.test.ts`

3. **Rust CLI transport**
   - `apps/cli/crates/onequery-cli/build.rs`
   - `apps/cli/crates/onequery-cli/src/transport/generated.rs`
   - `apps/cli/crates/onequery-cli/src/transport/{auth,org,source,query,http,use_cmd}.rs`
   - `apps/cli/crates/onequery-cli/src/transport/mod.rs` OpenAPI contract test

4. **Command schema / discovery coupling**
   - `apps/cli/crates/onequery-cli/src/commands/schema/openapi.rs`
   - embedded `cli.openapi.json` in `commands/schema/mod.rs`
   - `schema openapi` command itself
   - derived `x-onequery-*` metadata usage

5. **Bun runtime and packaging**
   - `packages/bun-server/**`
   - `apps/cli/scripts/build-server-executable.js` uses `Bun.build`
   - `apps/cli/scripts/self-host-runtime.js` uses `Bun.spawnSync`
   - root/package scripts and CI jobs use `bun run`

The two non-obvious migration risks are:

- **OpenAPI is also the source for CLI command metadata**, not just HTTP types.
- **self-host packaging currently depends on Bun runtime compilation**, not just Bun as a package manager.

---

## Goals

- Replace the OpenAPI contract with **protobuf definitions** under Buf.
- Replace orval-generated Hono routes with **Connect RPC services**.
- Replace progenitor-generated Rust client with **connect-rust**.
- Keep the existing CLI features and semantics working after cutover.
- Reuse existing domain/workflow logic in `packages/cli-server/src/**` where practical.
- Preserve current internal behavior where it reduces migration risk, but do **not** preserve REST/OpenAPI artifacts for their own sake.

## Non-goals

- No backward-compatible REST layer.
- No dual OpenAPI + Connect generation.
- No rollout period.
- No attempt to keep `schema openapi` as a supported public surface.
- No attempt to preserve the current package names or directory structure unless it makes implementation simpler.
- No streaming RPCs in this migration.

---

## Proposed target architecture

## 1) Source of truth

Create a new protobuf workspace rooted at the repo root:

```text
proto/
  onequery/cli/v1/*.proto
buf.yaml
buf.gen.yaml
```

Recommended proto split:

```text
proto/onequery/cli/v1/
  cli.proto              # service definition
  common.proto           # shared messages/enums/warnings/page/sanitization
  auth.proto
  org.proto
  source.proto
  query.proto
  error_details.proto
```

Use **Buf** as the canonical schema/build tool. Connect-ES v2 no longer needs its own code generator plugin, so the TypeScript side can generate from Buf + `protoc-gen-es`. citeturn897529view1turn172310view2

## 2) Service shape

Use **one service** initially:

```proto
service CliService {
  rpc Use(UseRequest) returns (UseResponse);
  rpc GetSession(GetSessionRequest) returns (GetSessionResponse);
  rpc RefreshSession(RefreshSessionRequest) returns (RefreshSessionResponse);
  rpc StartDeviceAuthorization(StartDeviceAuthorizationRequest) returns (StartDeviceAuthorizationResponse);
  rpc PollDeviceAuthorization(PollDeviceAuthorizationRequest) returns (PollDeviceAuthorizationResponse);
  rpc ListOrganizations(ListOrganizationsRequest) returns (ListOrganizationsResponse);
  rpc GetOrganization(GetOrganizationRequest) returns (GetOrganizationResponse);
  rpc ListSources(ListSourcesRequest) returns (ListSourcesResponse);
  rpc GetSourceConnectGuide(GetSourceConnectGuideRequest) returns (GetSourceConnectGuideResponse);
  rpc ConnectSource(ConnectSourceRequest) returns (ConnectSourceResponse);
  rpc GetSource(GetSourceRequest) returns (GetSourceResponse);
  rpc ValidateQuery(ValidateQueryRequest) returns (ValidateQueryResponse);
  rpc ExecuteQuery(ExecuteQueryRequest) returns (ExecuteQueryResponse);
}
```

Rationale:

- It mirrors the current Rust `ApiClient` shape, which already wraps a single generated client.
- It avoids artificial domain splitting during a transport migration.
- It reduces service registration and client wrapper churn.

Do **not** add an RPC equivalent of `GET /openapi.json`.

If an equivalent discovery surface is still needed later, define it explicitly as a separate protobuf service or as a local CLI-only schema source; do not drag OpenAPI forward just to preserve that endpoint.

## 3) Request/response modeling

Model current REST semantics in protobuf as follows:

- **path/query/header inputs** → normal request message fields
- **`oneOf` REST responses** → protobuf `oneof`
- **pagination/read controls** → explicit request/response fields
- **arbitrary JSON objects** → `google.protobuf.Struct` / `google.protobuf.Value`
- **error payloads** → Connect error + typed protobuf detail

Examples:

- `orgSlug`, `sourceKey`, `limit`, `cursor`, `fields`, and `source` all become request fields.
- `x-onequery-org-slug` for `/use` should become `optional string org_slug` in `UseRequest` rather than stay a custom header.
- `CliSourceConnectRequest.credentials` should become `google.protobuf.Struct`.
- current device-auth poll result should become a `oneof` instead of a JSON `oneOf` envelope.

### Response envelope policy

Do **not** spend migration effort on “cleaning up” response envelopes unless it clearly simplifies code.

Recommended approach for this repo:

- keep response messages close to today’s success payloads if that reduces refactor risk;
- remove only wrappers that are purely HTTP-shaped and add no value.

In practice, that means it is acceptable to keep `request_id`, `warnings`, `page`, and `sanitization` as response fields if that lets the Rust transport migration stay mechanical.

## 4) Error model

Define a protobuf error detail message, for example:

```proto
message CliProblemDetail {
  string code = 1;
  string stage = 2;
  string request_id = 3;
  bool retryable = 4;
  optional string hint = 5;
  optional uint32 retry_after_ms = 6;
  repeated ValidationIssue errors = 7;
}
```

Map current HTTP/OpenAPI problem semantics into Connect’s error model:

- transport-meaningful failures use Connect codes (`invalid_argument`, `unauthenticated`, `permission_denied`, `not_found`, `unavailable`, etc.)
- current stable OneQuery error code remains in `CliProblemDetail.code`
- request ID remains available to the CLI via error detail and/or metadata

Connect errors support a code, metadata, and strongly typed protobuf error details, so `CliProblem` should migrate naturally into a typed error detail instead of a normal response schema. citeturn865552search0turn865552search2turn865552search3

## 5) Validation strategy

Replace OpenAPI/orval-generated validation with a combination of:

- protobuf field types/enums
- `buf.validate` custom options where practical
- server-side domain validation for cross-field/business checks

On the TypeScript server, wire in Connect validation via `createValidateInterceptor()` for protobuf-declared constraints. Connect’s docs explicitly recommend Protovalidate in server examples, and Connect-ES v2 / Protobuf-ES v2 support custom options. citeturn548872search2turn548872search3turn897529view0

Do **not** try to preserve the current generated zod file layout.

## 6) TS server runtime model

Keep Hono, but stop using orval-generated Hono routes.

Instead, add a thin bridge layer under something like:

```text
packages/cli-server/src/connect/
  gen/...
  service.ts
  context.ts
  hono-connect.ts
```

The bridge should:

1. build Connect routes from the generated service descriptor;
2. convert Hono Node adapter `incoming` / `outgoing` to Connect universal requests/responses;
3. pass Hono `Context` into Connect `ContextValues` so service methods can access request-scoped state.

This follows the known Hono integration pattern: the Hono+Connect article uses Hono’s Node adapter, converts raw Node request/response objects with Connect’s universal bridge, and passes Hono context via a custom context key. Hono’s Node adapter also exposes raw Node APIs at `c.env.incoming` / `c.env.outgoing`. citeturn973240view1turn973240view0turn550094view12

## 7) Runtime target

Target **Node.js runtime** for the final implementation.

Reasons:

- Connect-ES v2 requires at least Node.js 18.14.1. citeturn897529view0
- Hono’s Node adapter also targets Node 18.14.1+ and exposes the raw Node APIs needed for the bridge. citeturn550094view11turn550094view12
- Connect’s own repo documents Node.js first and treats Bun as an “other platform” rather than a first-class target. citeturn201415view0

### Bun policy

A Bun spike is allowed before the Node migration, but it is explicitly **non-blocking**:

- if the exact Hono bridge works on Bun unchanged, that is a bonus;
- if it fails, do **not** spend migration time inventing a Bun-specific adapter;
- proceed with Node.

## 8) HTTP protocol choice

Use **unary RPCs only** in this migration.

Start with **Connect protocol over HTTP/1.1** unless there is a concrete need for gRPC or streaming during the migration. This repo’s current CLI surface is entirely unary, and Connect’s Node docs note that HTTP/2 is what unlocks full gRPC and all streaming variants, while HTTP/1.1 is the constrained mode. citeturn548872search3turn865552search6

## 9) Rust code generation strategy

Recommended default for this repo:

- **TS:** checked-in generated code from Buf
- **Rust:** generate in `build.rs` with `connectrpc-build`

Why this split:

- TS generation is straightforward with Buf + `protoc-gen-es`. citeturn172310view2turn897529view1
- `connect-rust` supports two workflows; `buf generate` is recommended for checked-in Rust code, but the Buf remote plugin is still planned, so checked-in Rust generation currently requires local plugin binaries. `build.rs` avoids that extra setup. citeturn928713view1turn550094view14turn928713view2

If the team strongly prefers checked-in Rust generated code diffs, that is a valid alternative. For initial migration, `build.rs` is the lower-friction choice.

---

## Detailed migration plan

## Phase 0 — lock the migration decisions

### Deliverables

- short ADR or PR description recording the choices below

### Decisions to lock

- protobuf + Buf is the new single source of truth
- direct cutover; no compatibility layer
- one `CliService` for now
- no `/openapi.json` replacement
- `schema openapi` is removed
- `schema commands` is either:
  - kept but decoupled from wire contract, or
  - temporarily removed, then rebuilt later
- final runtime target is Node.js
- keep Bun package manager **optional** and separate from runtime migration

### Checklist

- [ ] Confirm protobuf/Buf as the only contract source going forward.
- [ ] Confirm `schema openapi` will be removed.
- [ ] Confirm whether `schema commands` must survive this migration.
- [ ] Confirm whether self-host packaged server remains required after Bun runtime removal.
- [ ] Confirm `/api/cli` remains as internal route prefix for Connect handlers.

---

## Phase 1 — introduce protobuf contract

### Work

Create Buf workspace and author the initial `.proto` files to cover all current public CLI operations except `/openapi.json`.

Start by mirroring current request/response shapes closely enough that the TS and Rust migrations remain mechanical.

### Mapping from current REST operations

- `GET /use` → `Use`
- `GET /session` → `GetSession`
- `POST /session:refresh` → `RefreshSession`
- `POST /auth/device-authorizations` → `StartDeviceAuthorization`
- `POST /auth/device-authorizations:poll` → `PollDeviceAuthorization`
- `GET /organizations` → `ListOrganizations`
- `GET /organizations/{orgSlug}` → `GetOrganization`
- `GET /organizations/{orgSlug}/sources` → `ListSources`
- `GET /organizations/{orgSlug}/sources:connect` → `GetSourceConnectGuide`
- `POST /organizations/{orgSlug}/sources:connect` → `ConnectSource`
- `GET /organizations/{orgSlug}/sources/{sourceKey}` → `GetSource`
- `POST /organizations/{orgSlug}/sources/{sourceKey}/queries:validate` → `ValidateQuery`
- `POST /organizations/{orgSlug}/sources/{sourceKey}/queries:execute` → `ExecuteQuery`

### Checklist

- [x] Add `buf.yaml` and `buf.gen.yaml` at repo root.
- [x] Add `proto/onequery/cli/v1/*.proto`.
- [x] Model current enums/messages/read controls/pages/warnings/sanitization in proto.
- [x] Convert current `oneOf` response states to protobuf `oneof`.
- [x] Convert ad hoc headers/query/path params to message fields.
- [x] Model arbitrary JSON payloads with `google.protobuf.Struct`/`Value` where required.
- [x] Add `CliProblemDetail` protobuf message for typed error details.
- [x] Add `buf.validate` options for current transport-level validation rules that are worth preserving.
- [x] Add `buf lint` and make it pass.

---

## Phase 2 — generate TypeScript code

### Work

Generate TypeScript protobuf/service code from Buf into a new generated location owned by the CLI server package.

Recommended output:

```text
packages/cli-server/src/connect/gen/**
```

### Checklist

- [x] Add TS generation config using Buf + `@bufbuild/protoc-gen-es`.
- [x] Add root script such as `proto:generate`.
- [x] Check generated TS into the repo.
- [ ] Remove `orval` from `packages/cli-contract` usage path.
- [ ] Remove `openapi:cli:generate` / `openapi:cli:check` scripts or replace them with proto equivalents.

---

## Phase 3 — implement Connect service in the TS server

### Work

Implement the service methods on top of existing domain logic in `packages/cli-server/src/**`.

Do **not** port generated Hono handler structure 1:1.

Instead:

- keep reusable domain/workflow/effect modules;
- create one Connect service implementation file;
- factor request normalization / response projection helpers as needed;
- move cross-cutting transport concerns into Connect interceptors or shared helpers.

### Server-side context policy

The current Hono app already injects request ID, runtime config, storage, session, DB, and authorized org context through middleware and `c.var`.

The Connect implementation should keep the same conceptual state, but surface it through Connect `ContextValues` and service helpers instead of route-specific orval middleware. Connect context values are designed for this request-scoped data flow. citeturn550094view8

### Checklist

- [ ] Create `packages/cli-server/src/connect/service.ts` implementing `CliService`.
- [ ] Create `packages/cli-server/src/connect/context.ts` for Connect context keys.
- [ ] Create `packages/cli-server/src/connect/hono-connect.ts` bridge middleware.
- [ ] Pass Hono `Context` into Connect `ContextValues`.
- [ ] Preserve current request ID generation/logging middleware behavior.
- [ ] Add Connect validation interceptor.
- [ ] Port auth/session/org-resolution middleware behavior into interceptors/helpers.
- [ ] Reuse existing business logic modules instead of rewriting them.
- [ ] Mount Connect handlers under `/api/cli`.
- [ ] Remove `packages/cli-server/generated/**` from the runtime path.
- [ ] Delete `packages/cli-server/src/transport/handlers/cliOpenapiDocument.ts`.
- [ ] Delete or rewrite `packages/cli-server/src/route.ts` to export Connect/Hono bridge instead of orval route.

---

## Phase 4 — migrate the Rust CLI transport to connect-rust

### Work

Replace progenitor client generation and REST/OpenAPI-specific transport code with a generated Connect client plus a small compatibility wrapper.

Keep the existing `ApiClient` abstraction if it still provides value for:

- base URL normalization
- auth token attachment
- request timeout configuration
- request ID propagation
- user-facing error mapping

### Recommended generation approach

Use `connectrpc-build` in `apps/cli/crates/onequery-cli/build.rs` for the first migration. `connect-rust` explicitly supports this build-time workflow, and it avoids requiring local plugin binaries during the migration. citeturn928713view2

### Checklist

- [ ] Remove `progenitor` and `progenitor-client` dependencies from Cargo manifests.
- [ ] Add `connectrpc-build` build dependency.
- [ ] Add `connectrpc` runtime dependency with needed features.
- [ ] Point `build.rs` at the new `proto/` definitions.
- [ ] Replace `src/transport/generated.rs` include path with Connect-generated output.
- [ ] Rewrite `src/transport/client.rs` around the Connect client.
- [ ] Preserve auth token, timeout, and request ID behavior in the wrapper.
- [ ] Rewrite transport modules (`auth`, `org`, `source`, `query`, `use_cmd`) to call Connect RPCs.
- [ ] Replace OpenAPI/HTTP problem parsing with Connect error → CLI error mapping.
- [ ] Decode typed `CliProblemDetail` from Connect errors.
- [ ] Remove the checked-in OpenAPI contract assertion test from `transport/mod.rs`.

---

## Phase 5 — deal with command schema / discovery coupling

### Work

This is the largest hidden non-transport dependency.

Current state:

- Rust CLI embeds the checked-in OpenAPI JSON.
- `schema openapi` exposes that document.
- `schema commands` derives public command metadata from OpenAPI `x-onequery-*` extensions.

### Recommended decision

For this migration, **decouple command schema export from the transport contract**.

That means:

- remove `schema openapi`;
- stop deriving `schema commands` from the wire contract;
- keep command metadata in a dedicated local registry (Rust-side or checked-in JSON) if the command is still needed.

Do **not** block the Connect migration on recreating the entire `x-onequery-*` metadata model inside protobuf custom options.

Custom protobuf options can be revisited later if you want to colocate command metadata with the transport schema. Connect-ES v2 / Protobuf-ES v2 now support custom options, but introducing a second round of descriptor/reflection work is unnecessary for the initial cutover. citeturn897529view0

### Checklist

- [ ] Remove `SchemaSubcommand::Openapi` and related command wiring if no longer needed.
- [ ] Remove embedded `cli.openapi.json` include in `commands/schema/mod.rs`.
- [ ] Delete `commands/schema/openapi.rs`.
- [ ] Keep or replace `schema commands` with a dedicated non-OpenAPI registry.
- [ ] Update snapshots/tests for command-schema output.
- [ ] Remove any `x-onequery-*` assumptions from the transport migration path.

---

## Phase 6 — Bun runtime removal and Node runtime adoption

### Work

Replace `packages/bun-server` with a Node runtime package, for example:

```text
packages/node-server/**
```

Use Hono’s Node adapter and mount the Connect/Hono bridge plus the rest of the existing server routes.

### Important scope split

Treat these as **separate concerns**:

1. **server runtime migration off `Bun.*` APIs** — in scope
2. **package manager migration away from `bun run`** — optional / can be deferred

There is no hard requirement to switch package manager just because the runtime target becomes Node.js.

### Checklist

- [ ] Replace `Bun.serve` entrypoint with Node/Hono entrypoint.
- [ ] Create `packages/node-server/src/index.ts` using `@hono/node-server`.
- [ ] Mount Connect CLI handlers under `/api/cli`.
- [ ] Port remaining non-CLI routes from `packages/bun-server`.
- [ ] Remove `Bun.*` APIs from runtime code paths.
- [ ] Keep Bun compatibility spike isolated and non-blocking.
- [ ] Decide whether root `packageManager` stays Bun for now or moves later.

---

## Phase 7 — self-host packaging updates

### Work

Current self-host packaging relies on compiling the server into a Bun executable. That cannot survive unchanged after runtime migration.

This needs an explicit replacement plan.

### Recommended order

Do not invent the final packaging approach before the transport works.

First, make the Node runtime work in development and tests. Then choose one of:

- ship the server as a normal Node app in self-host mode;
- package Node separately with the runtime bundle;
- use a Node single-executable/bundling strategy later.

### Checklist

- [ ] Remove `Bun.build` dependency from `apps/cli/scripts/build-server-executable.js` or replace the script entirely.
- [ ] Remove `Bun.spawnSync` from `apps/cli/scripts/self-host-runtime.js`.
- [ ] Decide whether self-host still requires a single executable server artifact.
- [ ] Update runtime bundle staging logic for the Node runtime layout.
- [ ] Update smoke tests for self-host mode.

---

## Phase 8 — CI, scripts, and docs cleanup

### Work

Replace OpenAPI-specific checks with protobuf/Connect-specific checks.

### Checklist

- [ ] Remove OpenAPI generation/check steps from CI.
- [ ] Add `buf lint` to CI.
- [ ] Add TS proto generation diff check.
- [ ] Ensure Rust build/test covers `connectrpc-build` generation.
- [ ] Remove `packages/cli-contract` from Turbo inputs if the package is deleted.
- [ ] Add `proto/**` and Buf config files to Turbo inputs where needed.
- [ ] Update `apps/cli/justfile` to use proto generation/check commands.
- [ ] Update `apps/cli/README.md` and any docs referencing OpenAPI as the source of truth.
- [ ] Remove or archive `packages/cli-contract/**` once migration is complete.

### Buf breaking checks

Because this CLI/server pair is internal and updated together, do **not** make `buf breaking` a hard gate in the migration branch. Buf’s own docs note that if you control your clients and can update them easily, breaking schema changes may be perfectly acceptable. You can add breaking checks later once the schema stabilizes. citeturn756401search0turn756401search2

---

## File-level retirement list

These paths should disappear or be fully repurposed by the end:

- `packages/cli-contract/**`
- `packages/cli-server/generated/**`
- `packages/cli-server/src/transport/handlers/cliOpenapiDocument.ts`
- `packages/cli-server/src/contract.test.ts`
- `apps/cli/crates/onequery-cli/src/commands/schema/openapi.rs`
- `apps/cli/crates/onequery-cli` OpenAPI embed/include code
- `apps/cli/crates/onequery-cli` progenitor build and deps
- `packages/bun-server/**` (replaced by Node runtime package)

---

## Acceptance criteria

The migration is complete when all of the following are true:

- [ ] There is no OpenAPI JSON artifact used as transport source of truth anywhere in the repo.
- [ ] `orval` is no longer used for the CLI API.
- [ ] `progenitor` is no longer used by the Rust CLI.
- [ ] The CLI server exposes the internal CLI API via Connect RPC under Hono.
- [ ] The Rust CLI talks to the server via `connect-rust`.
- [ ] All current CLI operations except `schema openapi` work end-to-end.
- [ ] Existing auth, org selection, read controls, and query flows still work.
- [ ] Current request ID / warning / pagination / sanitization behavior is preserved at the CLI UX layer.
- [ ] OpenAPI-derived command-schema code is removed or intentionally replaced.
- [ ] Bun runtime APIs are gone from the server runtime path.
- [ ] CI no longer regenerates or checks OpenAPI artifacts.
- [ ] CI validates the protobuf contract and generated code path.

---

## Nice-to-have follow-ups after cutover

- [ ] Move command metadata into protobuf custom options if you want contract-colocated discovery again.
- [ ] Revisit checked-in Rust generation if plugin installation becomes easier.
- [ ] Consider splitting `CliService` into smaller domain services only after the transport stabilizes.
- [ ] Consider `buf breaking` once the protobuf contract is considered stable.
- [ ] Consider moving request IDs fully into metadata if that later simplifies payload schemas.

---

## Recommended implementation order

1. lock decisions
2. write proto schema
3. generate TS code
4. implement TS Connect service + Hono bridge
5. migrate Rust client
6. remove OpenAPI command-schema dependency
7. switch runtime from Bun server to Node server
8. fix self-host packaging
9. clean CI/docs

This order keeps the hardest hidden dependencies visible early, while avoiding a packaging rewrite before the transport itself is proven.
