# CLI transport migration spec: OpenAPI/orval/progenitor -> Protobuf + Connect RPC

<!-- Comment: the previous draft mixed a Connect-native migration with REST-era Problem Details, response-envelope preservation, and a Bun-to-Node runtime detour. This revision removes those mismatches on purpose. -->

## Summary

Migrate the internal CLI transport from OpenAPI-generated REST bindings to a
Protobuf/Connect RPC contract, using:

- **TypeScript server:** `connect-es` on top of the existing Hono-based CLI
  server, with Connect owning the RPC layer.
- **Rust CLI:** `connect-rust`.
- **TanStack/web consumers:** `connect-query-es` over a standard Connect web
  transport.
- **Single source of truth:** `proto/` + Buf config, replacing
  `packages/cli-contract/openapi/**`.

This is a **direct cutover**:

- no compatibility window
- no dual stack
- no REST/OpenAPI preservation work
- no generic Problem Details shim
- no typed error-detail rollout in the initial cutover
- no obligation to preserve current REST paths, headers, or envelopes unless
  they still represent real CLI/domain semantics
- no Bun-to-Node runtime migration as part of this transport spec

The migration should be **Connect-native**, not "REST translated into Connect".
Keep the business behavior. Drop the HTTP-era transport shapes.

Target the repo's existing **Bun + Hono** runtime directly. Do not introduce a
Node-only adapter layer just to mount Connect.

---

## Current repo impact (repo-specific)

The current OpenAPI contract is not isolated to one generator step. It leaks
into several places that must be addressed explicitly:

1. **Contract source and generation**
   - `packages/cli-contract/openapi/source/**`
   - `packages/cli-contract/openapi/generated/cli.openapi.json`
   - `packages/cli-contract/orval.config.ts`
   - `packages/cli-contract/scripts/bundle-openapi.ts`

2. **TypeScript CLI server transport**
   - `packages/cli-server/generated/**`
   - handler modules under `packages/cli-server/src/transport/handlers/*`
   - `packages/cli-server/src/route.ts`
   - `packages/cli-server/src/contract.test.ts`

3. **Rust CLI transport**
   - `apps/cli/crates/onequery-cli/build.rs`
   - `apps/cli/crates/onequery-cli/src/transport/generated.rs`
   - `apps/cli/crates/onequery-cli/src/transport/{auth,org,source,query,http,use_cmd}.rs`
   - `apps/cli/crates/onequery-cli/src/transport/mod.rs`

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
- **self-host packaging currently depends on Bun runtime compilation**, not
  just Bun as a package manager.

---

## Goals

- Replace the OpenAPI contract with **protobuf definitions** under Buf.
- Replace orval-generated Hono routes with **Connect RPC services**.
- Replace progenitor-generated Rust client code with **connect-rust**.
- Use **connect-query-es** for TanStack consumers of the new API.
- Keep current CLI features and workflows working after cutover.
- Reuse existing domain/workflow logic in `packages/cli-server/src/**` where
  practical.
- Simplify the wire contract to **Connect-native unary RPCs** instead of
  translating REST shapes mechanically.
- Decouple command-schema/discovery from the transport contract.

## Non-goals

- No backward-compatible REST layer.
- No dual OpenAPI + Connect generation.
- No rollout period.
- No attempt to preserve `schema openapi`.
- No attempt to preserve REST paths, headers, or response envelopes just
  because they exist today.
- No streaming RPCs in this migration.
- No REST-specific client wrappers layered on top of Connect for web consumers.

---

## Proposed target architecture

## 1) Source of truth

Create a protobuf workspace rooted at the repo root:

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
  common.proto           # shared messages/enums used by multiple RPCs
  auth.proto
  org.proto
  source.proto
  query.proto
```

Use **Buf** as the canonical schema/build tool. On the TypeScript side, generate
from Buf with `protoc-gen-es`. On the Rust side, use either `build.rs` or
checked-in generation, with the initial preference documented below.

Do **not** create a generic `error_details.proto` up front. Add a focused error
detail message later only if a specific client behavior genuinely needs it.

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

- it matches the current Rust `ApiClient` mental model
- it keeps the migration mechanical where that helps
- it avoids service-splitting churn during a transport replacement

Do **not** add an RPC equivalent of `GET /openapi.json`.

## 3) Request/response modeling

Model the contract in protobuf directly:

- **path/query/header inputs** -> request message fields
- **JSON `oneOf` states** -> protobuf `oneof`
- **pagination/read controls** -> explicit request or response fields
- **arbitrary JSON payloads** -> `google.protobuf.Struct` /
  `google.protobuf.Value` only where the shape is genuinely dynamic

Examples:

- `orgSlug`, `sourceKey`, `limit`, `cursor`, `fields`, and `source` become
  request fields.
- `x-onequery-org-slug` for `/use` becomes `optional string org_slug` in
  `UseRequest`.
- device authorization poll state becomes a protobuf `oneof`.

### Response policy

Prefer **plain RPC result messages**, not HTTP-style envelopes.

Recommended policy for this repo:

- keep `warnings` only where they are part of the actual user-visible result
- keep `page` only for list RPCs that really paginate
- keep `sanitization` only where the RPC needs to explain a modified or
  normalized query/result
- move `request_id` out of response bodies and into metadata/logging
- delete wrappers that only existed to satisfy REST or OpenAPI conventions

The migration should not preserve `request_id`, `ok`, `error`, `data`, or
similar envelope fields unless they still carry domain meaning after the move
to Connect.

## 4) Error model

For the initial cutover, the error contract should stay as close as possible to
**Connect's native error model**:

- **code** for the failure class
- **message** for the human-readable summary
- **metadata** for small out-of-band values like request ID or retry hints

Do **not** define or carry forward a generic `CliProblemDetail` message.

Do **not** translate current HTTP problem payloads into a Connect-shaped clone.

Do **not** make typed protobuf error details part of the migration baseline.
Start with `code` + `message` + minimal metadata. Only add a focused typed
detail later if a real caller behavior needs it.

### Default mapping guidance

- invalid inputs -> `InvalidArgument`
- missing or expired auth -> `Unauthenticated`
- forbidden org/source access -> `PermissionDenied`
- missing resources -> `NotFound`
- state/precondition failures -> `FailedPrecondition`
- conflicts or race-style write failures -> `Aborted` or `AlreadyExists`,
  whichever is semantically correct
- rate limiting or temporary upstream failure -> `ResourceExhausted` or
  `Unavailable`
- unexpected server failure -> `Internal`

### Metadata guidance

Use Connect metadata for things like:

- request ID
- retry hints such as retry-after
- operational correlation values that are not part of the business response

Do **not** use metadata to rebuild a REST-style error document. Specifically,
do not treat metadata as a place to preserve RFC 9457 fields, status mirrors,
or a transport-level clone of the current problem catalog.

<!-- Comment: the existing internal problem catalog can remain as a server-side
mapping helper during the refactor, but it should not define the public Connect
error contract after cutover. -->

### Typed detail deferral

If the CLI later needs to branch on structured error information, add one small
focused detail message for that case only. A catch-all "problem" container is
explicitly out of scope for this migration.

Rust should consume errors via `connect-rust`'s `ConnectError` directly:

1. inspect `code`
2. inspect metadata if needed
3. do not assume typed details exist in the initial cutover

## 5) Validation strategy

Replace OpenAPI/orval-generated validation with a combination of:

- protobuf field types and enums
- `buf.validate` options where practical
- server-side domain validation for cross-field and workflow checks

On the TypeScript server, use `createValidateInterceptor()` so protobuf-declared
constraints are enforced in the Connect layer.

Do **not** preserve the current generated zod file layout.

## 6) TS server runtime model

Keep Hono, but let **Connect own RPC dispatch**.

Recommended structure:

```text
packages/cli-server/src/connect/
  gen/...
  context.ts
  error.ts
  middleware.ts
  routes.ts
  service.ts
  service/
```

Use a small `honoConnectMiddleware()` in the style of
`.tmp/hono-connect-example-repo` for the actual RPC mounting and keep the Hono
glue thin. Hono should mount the middleware under `/api/cli*`; Connect should
still own RPC dispatch.

### Integration guidance

- register `CliService` through Connect's router
- expose route registration via a `routes(router)` function
- mount the Connect middleware at the Hono edge instead of building a custom
  fetch-to-Node bridge
- use `ContextValues` / context keys for request-scoped state that service
  methods need
- if existing Hono middleware already resolves useful state, passing the
  request-scoped `Hono.Context` through a Connect context key is acceptable
  so long as it stays request-bound
- do **not** build a REST-shaped compatibility layer inside that middleware

Do **not** build a Node adapter just to re-enter Hono. The middleware should
only do path matching, context extraction, and handoff to Connect handlers.

## 7) Runtime target

Target **Bun + Hono** for the final implementation.

Reasoning:

- the deployed server runtime in this repo is already Bun-based
- Hono middleware keeps Connect routing standard without a Node-only adapter
- this avoids adding an unnecessary bridge layer just for RPC mounting

## 8) HTTP protocol choice

Use **unary RPCs only** in this migration.

Start with the **Connect protocol over HTTP/1.1**:

- the current CLI surface is unary
- Connect over HTTP/1.1 is sufficient
- this keeps the server/client setup simple for both `connect-es` and
  `connect-rust`

Do not introduce gRPC or streaming unless a real migration blocker appears.

## 9) Code generation strategy

Recommended default for this repo:

- **TS:** checked-in generated code from Buf
- **Rust:** generate in `build.rs` with `connectrpc-build`

Why this split:

- TS generation with Buf + `protoc-gen-es` is straightforward and repo-friendly
- `connect-rust` supports `build.rs` cleanly
- `build.rs` avoids requiring local Rust codegen plugin binaries during the
  initial migration

If the team later prefers checked-in Rust generated code diffs, that remains a
valid follow-up choice.

---

## Detailed migration plan

## Phase 0 - lock the migration decisions

### Deliverables

- short ADR or PR description recording the choices below

### Decisions to lock

- protobuf + Buf is the only transport source of truth
- direct cutover; no compatibility layer
- one `CliService` for now
- no `/openapi.json` replacement
- `schema openapi` is removed
- command-schema export is decoupled from the wire contract
- Connect error is the primary error contract
- no generic Problem Details message
- no typed error details in the initial cutover
- request IDs move to metadata/logging instead of response bodies
- final runtime target stays Bun + Hono
- no Bun-to-Node runtime migration in this spec

### Checklist

- [ ] Confirm protobuf/Buf as the only contract source going forward.
- [ ] Confirm `schema openapi` will be removed.
- [x] Confirm `schema commands` will be removed.
- [ ] Confirm whether self-host packaged server behavior needs any Connect-specific packaging changes.
- [ ] Confirm `/api/cli` remains the Connect handler prefix.

---

## Phase 1 - introduce protobuf contract

### Work

Create the Buf workspace and author `.proto` files for all current CLI
operations except `/openapi.json`.

Start from **business semantics**, not from current REST wrappers.

### Mapping from current REST operations

- `GET /use` -> `Use`
- `GET /session` -> `GetSession`
- `POST /session:refresh` -> `RefreshSession`
- `POST /auth/device-authorizations` -> `StartDeviceAuthorization`
- `POST /auth/device-authorizations:poll` -> `PollDeviceAuthorization`
- `GET /organizations` -> `ListOrganizations`
- `GET /organizations/{orgSlug}` -> `GetOrganization`
- `GET /organizations/{orgSlug}/sources` -> `ListSources`
- `GET /organizations/{orgSlug}/sources:connect` -> `GetSourceConnectGuide`
- `POST /organizations/{orgSlug}/sources:connect` -> `ConnectSource`
- `GET /organizations/{orgSlug}/sources/{sourceKey}` -> `GetSource`
- `POST /organizations/{orgSlug}/sources/{sourceKey}/queries:validate` -> `ValidateQuery`
- `POST /organizations/{orgSlug}/sources/{sourceKey}/queries:execute` -> `ExecuteQuery`

### Checklist

- [x] Add `buf.yaml` and `buf.gen.yaml` at repo root.
- [x] Add `proto/onequery/cli/v1/*.proto`.
- [x] Model shared enums/messages/read controls in proto.
- [x] Convert current `oneOf` response states to protobuf `oneof`.
- [x] Convert ad hoc headers/query/path params to message fields.
- [x] Model arbitrary JSON payloads with `google.protobuf.Struct`/`Value` only where needed.
- [x] Remove HTTP-only response envelopes from the schema design.
- [x] Do **not** add a generic `CliProblemDetail` message.
- [x] Add `buf.validate` options for transport-level validation worth keeping.
- [x] Add `buf lint` and make it pass.

---

## Phase 2 - generate TypeScript code

### Work

Generate TypeScript protobuf/service code from Buf into a generated location
owned by the CLI server package.

Recommended output:

```text
packages/cli-server/src/connect/gen/**
```

### Checklist

- [x] Add TS generation config using Buf + `@bufbuild/protoc-gen-es`.
- [x] Add a root script such as `proto:generate`.
- [x] Check generated TS into the repo.
- [x] Remove `orval` from the CLI contract path.
- [x] Remove `openapi:cli:generate` / `openapi:cli:check` scripts or replace them with proto equivalents.

---

## Phase 3 - implement Connect service in the TS server

### Work

Implement the service methods on top of existing domain logic in
`packages/cli-server/src/**`.

Do **not** port the generated Hono handlers 1:1.

Instead:

- keep reusable domain/workflow/effect modules
- create one Connect service implementation
- move cross-cutting transport concerns into Connect interceptors/helpers
- keep Hono's role limited to mounting the Connect handler and sharing common
  app/runtime integration

### Server-side context policy

The current Hono app already injects request ID, runtime config, storage,
session, DB, and authorized org context through middleware and `c.var`.

The Connect implementation should expose the needed request-scoped values
through Connect context keys and `ContextValues`, not through route-specific
OpenAPI middleware. If reusing existing Hono middleware is cheaper, extract only
the resolved values that Connect methods need instead of threading full
`Hono.Context` through the service layer.

### Checklist

- [x] Create `packages/cli-server/src/connect/service.ts` implementing `CliService`.
- [x] Create `packages/cli-server/src/connect/context.ts` for Connect context keys.
- [x] Create `packages/cli-server/src/connect/error.ts` for Connect-native error helpers.
- [x] Create `packages/cli-server/src/connect/middleware.ts` for Hono Connect mounting.
- [x] Create `packages/cli-server/src/connect/routes.ts` for route registration.
- [x] Add Connect validation interceptor.
- [ ] Port request ID, auth/session, and org-resolution behavior into Connect interceptors/helpers.
- [ ] Reuse existing business logic modules instead of rewriting them.
- [x] Mount Connect middleware under `/api/cli*`.
- [x] Remove `packages/cli-server/generated/**` from the runtime path.
- [x] Delete `packages/cli-server/src/transport/handlers/cliOpenapiDocument.ts`.
- [x] Delete or rewrite `packages/cli-server/src/route.ts` to mount the Connect handler instead of the orval route tree.

---

## Phase 4 - migrate the Rust CLI transport to connect-rust

### Work

Replace progenitor client generation and REST/OpenAPI-specific transport code
with a generated Connect client plus a thin wrapper where that wrapper still
provides value for:

- base URL normalization
- auth token attachment
- request timeout configuration
- request metadata capture
- user-facing error mapping

TanStack-side consumers should use `connect-query-es` with a standard
`createConnectTransport()` setup instead of reintroducing REST-specific fetch
helpers.

### Recommended generation approach

Use `connectrpc-build` in `apps/cli/crates/onequery-cli/build.rs` for the first
migration.

### Checklist

- [x] Remove `progenitor` and `progenitor-client` dependencies from Cargo manifests.
- [x] Add `connectrpc-build` as a build dependency.
- [x] Add `connectrpc` as a runtime dependency with the needed features.
- [x] Point `build.rs` at the new `proto/` definitions.
- [x] Replace `src/transport/generated.rs` include path with Connect-generated output.
- [x] Rewrite `src/transport/client.rs` around the Connect client.
- [x] Preserve auth token and timeout behavior in the wrapper.
- [ ] Rewrite transport modules (`auth`, `org`, `source`, `query`, `use_cmd`) to call Connect RPCs.
- [x] Replace HTTP status/problem parsing with direct `ConnectError` mapping.
- [x] Map `ConnectError.code` first, then metadata only where the CLI actually needs it.
- [x] Do not depend on typed error details in the first cutover.
- [x] Stop storing RFC 9457 problem types in the shared CLI error model and presentation layer.
- [x] Remove the checked-in OpenAPI contract assertion test from `transport/mod.rs`.

---

## Phase 5 - deal with command schema / discovery coupling

### Work

This is the largest hidden non-transport dependency.

Current state:

- Rust CLI embeds the checked-in OpenAPI JSON.
- `schema openapi` exposes that document.
- `schema commands` derives public command metadata from OpenAPI
  `x-onequery-*` extensions.

### Recommended decision

For this migration, **decouple command schema export from the transport
contract**.

That means:

- remove `schema openapi`
- remove `schema commands`

Do **not** block the Connect migration on recreating the full `x-onequery-*`
metadata model inside protobuf custom options.

### Checklist

- [x] Remove `SchemaSubcommand::Openapi` and related command wiring.
- [x] Remove embedded `cli.openapi.json` include in `commands/schema/mod.rs`.
- [x] Delete `commands/schema/openapi.rs`.
- [x] Remove `schema commands` and `schema command`.
- [x] Update snapshots/tests for command-schema output.
- [x] Remove any `x-onequery-*` assumptions from the transport migration path.

---

## Phase 6 - Bun runtime and self-host verification

### Work

Keep the existing **Bun + Hono** runtime.

Mount the Connect handler inside the current Bun server path and verify the
existing self-host flow still works after the transport cutover.

Do **not** expand this spec into a Bun-to-Node runtime migration.

### Checklist

- [ ] Keep `packages/bun-server` as the runtime package for this migration.
- [ ] Mount Connect CLI handlers under `/api/cli`.
- [ ] Verify the existing non-CLI routes still work with the Connect mount in place.
- [ ] Verify self-host mode still boots and serves the Connect-backed CLI API.
- [ ] Update any Bun packaging/smoke tests only where the Connect route mount changes behavior.

---

## Phase 7 - CI, scripts, and docs cleanup

### Work

Replace OpenAPI-specific checks with protobuf/Connect-specific checks.

### Checklist

- [x] Remove OpenAPI generation/check steps from CI.
- [x] Add `buf lint` to CI.
- [x] Add TS proto generation diff checks.
- [x] Ensure Rust build/test covers `connectrpc-build` generation.
- [x] Remove `packages/cli-contract` from Turbo inputs if the package is deleted.
- [x] Add `proto/**` and Buf config files to Turbo inputs where needed.
- [x] Update `apps/cli/justfile` to use proto generation/check commands.
- [x] Update `apps/cli/README.md` and any docs that still reference OpenAPI as the source of truth.
- [x] Remove or archive `packages/cli-contract/**` once migration is complete.

### Buf breaking checks

Because this CLI/server pair is internal and updated together, `buf breaking`
should **not** be a hard migration gate. Add a breaking-compatibility gate only
after the protobuf contract is stable enough to justify it.

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

---

## Acceptance criteria

The migration is complete when all of the following are true:

- [x] There is no OpenAPI JSON artifact used as transport source of truth anywhere in the repo.
- [x] `orval` is no longer used for the CLI API.
- [x] `progenitor` is no longer used by the Rust CLI.
- [ ] The CLI server exposes the internal CLI API via Connect RPC under Hono.
- [ ] The Rust CLI talks to the server via `connect-rust`.
- [ ] TanStack/web consumers use `connect-query-es` against the same proto-based API.
- [ ] All current CLI operations except `schema openapi` work end-to-end.
- [ ] Existing auth, org selection, read controls, and query flows still work.
- [ ] Request IDs are available through metadata/logging instead of a legacy REST envelope.
- [x] OpenAPI-derived command-schema code is removed or intentionally replaced.
- [x] CI no longer regenerates or checks OpenAPI artifacts.
- [x] CI validates the protobuf contract and generated code path.
- [x] There is no generic Problem Details compatibility shim in the new transport.
- [x] The initial transport cutover relies on Connect `code`/`message`/metadata without a custom typed error-detail layer.

---

## Nice-to-have follow-ups after cutover

- [ ] Revisit focused typed error details if the CLI later benefits from them.
- [ ] Move command metadata into protobuf custom options only if the team actually wants contract-colocated discovery again.
- [ ] Revisit checked-in Rust generation if plugin installation becomes easier.
- [ ] Split `CliService` into smaller domain services only after the transport stabilizes.
- [ ] Add `buf breaking` once the protobuf contract is considered stable.

---

## Recommended implementation order

1. lock decisions
2. write the proto schema
3. generate TS code
4. implement the TS Connect service and handler mount
5. migrate the Rust client
6. remove OpenAPI command-schema dependency
7. verify Bun self-host/runtime behavior
8. clean CI and docs

This order keeps the hidden dependencies visible early while avoiding packaging
work before the transport itself is proven.
