# Protobuf / Buf Cleanup Plan

## Goal

Bring the CLI protobuf / Buf contract to a strict source-of-truth model:

- one schema definition per concept
- protobuf owns the wire contract
- no shadow DTO layer
- no ad hoc projection grammar outside the schema
- no duplicate proto inventories in build tooling

This plan assumes:

- no backward compatibility is required
- cleanup and deletions are welcome
- generated files must not be edited by hand

## Current Assessment

The Buf / Connect toolchain is mostly good already:

- `proto/buf.yaml`
- `proto/buf.gen.yaml`
- `packages/cli-server/src/connect/hono-connect.ts`
- `packages/cli-server/src/connect/service.ts`
- `packages/cli-server/src/connect/routes.ts`

The main problems are contract design problems, not tooling problems:

1. Partial field projection is modeled as a handwritten `fields` string and is lossy over protobuf.
2. Many proto messages duplicate each other and are not the true runtime contract.
3. `source connect` accepts untyped `google.protobuf.Struct` credentials while the real schema lives in Zod.
4. Rust build code keeps a second proto file inventory outside Buf.

## Desired End State

After cleanup, the repo should look like this:

- each RPC uses a single canonical request type and a single canonical response type
- response fields have presence only when presence is semantically meaningful
- the Connect contract does not support ad hoc `"fields"` projection
- `ConnectSourceRequest` uses typed protobuf credentials, not `Struct`
- `GetSourceConnectGuideResponse` no longer ships a hand-maintained JSON-schema-like contract
- Rust generation discovers proto files from the workspace instead of maintaining a hardcoded file list
- CI verifies lint, generation, and breaking checks after the refactor lands

## Recommended Strategy

Do the cleanup in this order:

1. Remove projection.
2. Collapse duplicate proto messages.
3. Replace `Struct` credentials with typed protobuf messages.
4. Delete schema-description messages that duplicate the typed credentials.
5. Remove duplicate build-time proto inventories.
6. Tighten validation and CI after the schema is simplified.

That order keeps the refactor understandable and avoids preserving abstractions that should be deleted.

## Detailed Checklist

### Phase 1: Remove Partial Projection From The Connect Contract

- [x] Delete every `fields` request field from the proto contract:
  - `proto/onequery/cli/v1/auth.proto`
  - `proto/onequery/cli/v1/org.proto`
  - `proto/onequery/cli/v1/query.proto`
  - `proto/onequery/cli/v1/source.proto`
- [x] Remove all field-selection allowlists and projection code from Connect handlers:
  - `packages/cli-server/src/connect/service/auth.ts`
  - `packages/cli-server/src/connect/service/organization.ts`
  - `packages/cli-server/src/connect/service/query.ts`
  - `packages/cli-server/src/connect/service/source.ts`
- [x] Delete Connect-side projection parsing helpers if they become unused:
  - `packages/cli-server/src/connect/service/read-controls.ts`
- [x] Remove CLI transport support for sending field projections over Connect requests:
  - `apps/cli/crates/onequery-cli/src/transport/auth.rs`
  - `apps/cli/crates/onequery-cli/src/transport/org.rs`
  - `apps/cli/crates/onequery-cli/src/transport/query.rs`
  - `apps/cli/crates/onequery-cli/src/transport/source.rs`
- [x] Remove tests that exist only to validate partial projection behavior.
- [x] Remove any output warnings or special handling that only exist because responses may be partial:
  - `apps/cli/crates/onequery-cli/src/output.rs`
- [x] Keep pagination if needed, but only as explicit typed fields such as `limit` and `cursor`.

Recommended simplification:

- return full response messages from Connect RPCs
- let the CLI perform local output projection for presentation if presentation trimming is still useful
- do not rebuild server-side projection using `FieldMask` unless there is a hard requirement for it

Comment:

- Phase 1 is complete once Connect always returns full protobuf responses; the CLI may still keep local `--fields` presentation trimming as a non-transport concern.

### Phase 2: Collapse Duplicate Proto Messages

- [x] Delete duplicate wrapper messages that mirror RPC response payloads and are not needed as separate wire concepts.
- [x] Remove dead response-wrapper messages from:
  - `proto/onequery/cli/v1/auth.proto`
    - `CliAuthSession`
    - `CliRefreshSession`
    - `CliDeviceAuthorizationStart`
  - `proto/onequery/cli/v1/org.proto`
    - `CliOrganizationList`
    - `CliOrganizationDetails`
  - `proto/onequery/cli/v1/query.proto`
    - `CliValidatedQuery`
    - `CliQuerySuccess`
  - `proto/onequery/cli/v1/source.proto`
    - `CliSourceList`
    - `CliSourceConnectGuide`
    - `CliConnectedSource`
  - `proto/onequery/cli/v1/use.proto`
    - `CliUseContent`
- [x] Collapse the remaining auth user-message split by replacing `CliAuthSessionProjectedUser` and `CliAuthSessionUser` with the canonical `CliAuthUser` message.
- [x] Regenerate TS code and confirm that removed messages had no remaining non-generated consumers.
- [x] Rename the surviving auth user message so the wire contract reflects the actual concept instead of historical DTO naming.

Rule for this phase:

- if a message exists only because code once wanted a second in-memory view, delete it from proto
- protobuf should describe the wire contract, not every intermediate application shape

### Phase 3: Make `source connect` Typed And Proto-Owned

- [ ] Replace `google.protobuf.Struct credentials` in `ConnectSourceRequest` with a typed protobuf message hierarchy.
- [ ] Add a canonical credential union in proto, for example:
  - `message ConnectSourceCredentials`
  - `oneof kind { ... }`
- [ ] Add concrete credential messages that mirror the real persisted credential schema from `packages/db/src/credentials.ts`.
- [ ] Model variant unions explicitly in proto where the Zod schema currently uses unions, for example OAuth vs service account variants.
- [ ] Remove provider / credential mismatches from runtime glue wherever possible by making invalid combinations unrepresentable in the proto shape.
- [ ] Update Connect handler decoding in:
  - `packages/cli-server/src/connect/service/source.ts`
- [ ] Replace `CreateDataSourceSchema.safeParse()` as the primary transport-shape authority with conversion from typed protobuf into the domain model.
- [ ] Keep Zod validation only for domain invariants that are not already enforced by protobuf and protovalidate.

Recommended design direction:

- make provider-specific credential messages first-class proto types
- use `oneof` for alternative auth modes
- avoid carrying a free-form `type` string inside a blob when the wire format can model the variants directly

### Phase 4: Remove Hand-Maintained Schema Description Messages

- [ ] Delete JSON-schema-like guide messages if they are not required by a real machine consumer:
  - `CliSourceConnectInputSchema`
  - `CliSourceConnectInputSchemaProperties`
  - `CliSourceConnectSchemaField`
- [ ] Remove `input_schema` from `GetSourceConnectGuideResponse` unless a concrete consumer still depends on it.
- [ ] If guide metadata is still useful, keep only human-facing material:
  - title
  - description
  - content
  - command
  - optional typed examples
- [ ] Remove or simplify `CliSourceConnectProviderGuide` fields that duplicate the canonical typed credential schema.
- [ ] Refactor guide-building code in:
  - `packages/cli-server/src/source/connect.ts`
  - `packages/cli-server/src/connect/service/source.ts`
- [ ] Stop manually maintaining parallel lists like `requiredCredentialFields` and `optionalCredentialFields` if the same information already exists in typed proto definitions or domain validators.

Preferred cleanup path:

- keep the guide as documentation
- stop pretending it is the schema
- the schema should be the typed request message itself

### Phase 5: Remove Duplicate Proto Inventories In Rust Build Tooling

- [ ] Replace the hardcoded `PROTO_FILES` array in `apps/cli/crates/onequery-cli/build.rs`.
- [ ] Discover proto files from `proto/onequery/cli/v1/*.proto` at build time, sort them deterministically, and use that discovered list everywhere the current code uses `PROTO_FILES`.
- [ ] Use the discovered list for:
  - rerun triggers
  - descriptor generation `--path` flags, if still needed
  - Rust code generation inputs
- [ ] If `connectrpc_build` can compile from only `cli.proto` plus imports, simplify to that single entrypoint instead of listing every file.
- [ ] Keep deterministic ordering in the discovered file list so generated output is stable.

Success condition for this phase:

- adding or removing a proto file in `proto/onequery/cli/v1/` should not require hand-editing Rust build metadata

### Phase 6: Tighten Validation Rules

- [ ] For request enums that must reject unknown numeric values, add both:
  - `(buf.validate.field).enum.not_in = 0`
  - `(buf.validate.field).enum.defined_only = true`
- [ ] Review every request enum field in:
  - `proto/onequery/cli/v1/use.proto`
  - `proto/onequery/cli/v1/query.proto`
  - `proto/onequery/cli/v1/source.proto`
- [ ] Re-check whether other scalar request fields should gain clearer validation once projection and `Struct` blobs are removed.
- [ ] Keep validation in proto close to transport concerns and avoid re-encoding identical rules in multiple server layers.

### Phase 7: Clean Up Server And CLI Code That Exists Only For The Old Contract

- [ ] Delete transport adapters that only exist to map partial / duplicate protobuf shapes into local presentation structs.
- [ ] Remove dead conversion helpers after the proto cleanup settles.
- [ ] Revisit naming in:
  - `packages/cli-server/src/connect/service/*`
  - `apps/cli/crates/onequery-cli/src/transport/*`
- [ ] Prefer a direct mapping:
  - protobuf request -> domain input
  - domain result -> protobuf response
- [ ] Remove stale tests that lock in the old projection behavior or duplicate message naming.
- [ ] Run dead-code detection after the refactor if needed.

Comment:

- the current codebase has several places where the protobuf layer and domain layer both describe the same thing in different forms; cleanup should bias toward deleting translation code, not preserving it

### Phase 8: Add Post-Refactor Guardrails

- [ ] Add a breaking-check command after the refactor stabilizes, for example a `proto:breaking` script.
- [ ] Decide what the baseline is:
  - current branch after cleanup
  - or the main branch once the cleanup lands
- [ ] Wire that breaking check into CI after the contract is in its cleaned-up state.
- [ ] Keep:
  - `bun run proto:lint`
  - `bun run proto:generate`
  - generated-code diff checks

## Suggested Execution Order By File

Start here:

1. `proto/onequery/cli/v1/*.proto`
2. `packages/cli-server/src/connect/service/*.ts`
3. `packages/cli-server/src/source/connect.ts`
4. `packages/db/src/credentials.ts`
5. `apps/cli/crates/onequery-cli/src/transport/*.rs`
6. `apps/cli/crates/onequery-cli/build.rs`

Do not start in generated code.

## Verification Checklist

Run these after each major phase:

- [x] `bun run proto:lint`
- [x] `bun run proto:generate`
- [x] `bun run proto:check`
- [x] relevant package tests for Connect handlers and CLI transport
- [x] Rust CLI tests affected by transport decoding

Run these before considering the refactor done:

- [ ] search for remaining duplicate proto message names and confirm they are either deleted or still intentionally canonical
- [x] search for `fields` request members and confirm they no longer exist in proto or Connect request builders
- [ ] search for `google.protobuf.Struct credentials` and confirm it has been removed from the transport contract
- [ ] search for `PROTO_FILES` and confirm the hardcoded inventory is gone
- [ ] review `packages/cli-server/src/connect/gen/**` only after regeneration, never by manual edits

## Definition Of Done

- proto messages are canonical and non-duplicated
- Connect responses do not rely on omitted proto3 scalars to represent absence
- `source connect` wire inputs are typed protobuf messages
- the guide endpoint no longer hand-maintains a fake schema beside the real schema
- Rust build tooling no longer hardcodes the proto file inventory
- CI checks protect the cleaned-up contract
