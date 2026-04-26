# Workflow Protobuf Audit Plan

This plan tracks the stricter long-term version of the workflow payload cleanup.
The application is not deployed to users yet, so this plan intentionally avoids
backward-compatibility shims and dual-read paths. Existing local audit data can
be discarded or migrated destructively.

## Design Priority

- [ ] Prefer the Connect RPC/protobuf-es native path over generic protobuf
  style rules when they conflict: schema-first `.proto` contracts, generated
  TypeScript messages, Protovalidate at the RPC boundary, binary protobuf as the
  default machine format, and ProtoJSON only as an inspection/debug format.
- [ ] Treat the workflow proto package as an internal durable-message package,
  not a public RPC package. Do not add workflow RPC services unless an internal
  transport boundary is introduced later.
- [ ] Let general Protocol Buffers best practices constrain the internal
  schemas after the Connect shape is chosen: stable tag numbers, reserved
  deleted fields, explicit enum zero values, well-known types for
  time/JSON-shaped values, and no text/JSON format as canonical interchange.
- [ ] The hard rewrite removes current JSON compatibility paths, but it does not
  waive future schema-evolution rules once the new protobuf schemas land.

## Target Shape

- [ ] Treat workflow commands, events, effects, and durable replay payloads as
  internal protobuf contracts, not hand-written JSON/Zod contracts.
- [ ] Keep reducers pure: reducers receive already-decoded command/event values
  and emit already-typed events/effects.
- [ ] Keep effects isolated: effect runners encode their result commands through
  the same internal protobuf boundary used for replay.
- [ ] Keep public Connect RPC messages separate from durable workflow messages.
  Do not store public `ExecuteQueryResponse` or `SourceApiExecutionResult`
  messages directly as audit-log truth.
- [ ] Treat package names as contract lifecycle boundaries, not generated-code
  location. It is acceptable for generated workflow code to live under
  `packages/cli-server` while `onequery.workflow.v1` remains a separate
  durable-message package.
- [ ] After this storage migration lands, continue with
  `docs/workflow-protobuf-boundary-followup-plan.md` before broad API naming or
  package rewrites.
- [ ] Store protobuf binary payloads in audit tables, while retaining scalar
  columns such as `family`, `command_type`, `event_type`, and `effect_type` for
  querying, idempotency, and diagnostics.
- [ ] Keep idempotency, effect keys, diagnostic lookup, and cache/fingerprint
  inputs based on explicit scalar/domain values, not on raw serialized protobuf
  bytes.
- [ ] Remove the duplicate Zod payload schemas from query/source-api workflow
  codecs after protobuf decode/validate covers the durable boundary.

## References

- [x] Use `.tmp/connect-protobuf-es-repo/MANUAL.md` for protobuf-es message
  creation, `toBinary`, `fromBinary`, `toJson`, and `fromJson` conventions.
- [x] Use `.tmp/connect-protobuf-es-repo/packages/protoc-gen-es/README.md` for
  `json_types=true`, `valid_types=protovalidate_required`, and generation
  option tradeoffs.
- [x] Use `.tmp/connect-connectrpc.com-repo/docs/node/interceptors.md` as the
  reference for keeping public RPC validation at the Connect interceptor layer.
- [x] Use `.tmp/connect-connectrpc.com-repo/docs/go/serialization-and-compression.md`
  for the schema-first JSON/binary separation in Connect.
- [x] Use `.tmp/connect-es-repo/README.md` for the local Connect-ES example of
  schema-first service implementation and Protovalidate wiring.
- [x] Use
  `.tmp/connect-protocolbuffers.github.io-repo/content/best-practices/dos-donts.md`
  for tag reservation, binary interchange, enum zero values, well-known types,
  and byte-serialization stability caveats.
- [x] Use
  `.tmp/connect-protocolbuffers.github.io-repo/content/best-practices/no-cargo-cults.md`
  and `.tmp/connect-protocolbuffers.github.io-repo/content/programming-guides/style.md`
  to avoid unexplained edition features and keep schema naming conventional.

## Proto Schema

- [x] Add an internal proto package under `proto/onequery/workflow/v1/`.
- [x] Keep `onequery/workflow/v1/**` independent from `onequery/cli/v1/**`.
  Workflow proto files must not import CLI API proto files; duplicate or map
  small shapes at the boundary when the lifecycles differ.
  Verified with scoped searches over `proto/onequery/workflow/v1` and generated
  workflow TypeScript; no `onequery/cli/v1` imports or generated package
  references are present.
- [x] Create `proto/onequery/workflow/v1/query_action.proto`.
- [x] Create `proto/onequery/workflow/v1/source_api_action.proto`.
- [x] Create a shared file if useful, for example
  `proto/onequery/workflow/v1/common.proto`, for actor snapshots, workflow
  family enums, source descriptors, problem keys, and JSON body wrappers.
- [x] Use `edition = "2023";` to match the existing `proto/onequery/cli/v1/*`
  files.
- [x] Do not add edition feature overrides unless a specific workflow contract
  requires one and the reason is documented near the file option.
- [x] Import `buf/validate/validate.proto` and add Protovalidate constraints to
  all production fields.
- [x] Model command payloads as one `oneof` per workflow family:
  `QueryActionCommandPayload` and `SourceApiActionCommandPayload`.
- [x] Model events as one `oneof` per workflow family:
  `QueryActionEventPayload` and `SourceApiActionEventPayload`.
- [x] Model effects as one `oneof` per workflow family:
  `QueryActionEffectPayload` and `SourceApiActionEffectPayload`.
- [x] Mark command/event/effect payload oneofs with
  `(buf.validate.oneof).required = true` so an empty wrapper is rejected before
  domain conversion.
- [ ] Keep the scalar type column and protobuf oneof case redundant by design:
  the scalar column supports database lookup, and decode must reject rows where
  the scalar type disagrees with the oneof case.
- [x] Model query execution replay data as an internal message, for example
  `QueryActionRecordQueryExecutionCommand`, containing the full rows/columns
  response needed by replay.
- [x] Model source-api page replay data as an internal message, including binary
  response bodies as `bytes`, not base64 strings.
- [x] Use `bytes` for arbitrary provider response/request bodies and other
  non-UTF-8 payloads. Use `google.protobuf.Value` only for JSON-shaped provider
  state that is already semantically JSON.
- [x] Use `google.protobuf.Timestamp` and `google.protobuf.Duration` for time
  points and spans if they enter durable protobuf payloads.
- [x] Avoid `google.protobuf.Any`; use explicit oneofs or typed internal
  messages for all known workflow payload variants.
- [x] Keep nullable domain concepts explicit with optional message fields or
  oneofs rather than sentinel strings.
- [x] Avoid reusing public CLI API response messages for storage unless the
  field is truly part of the durable workflow truth.
- [x] Replace `WorkflowCliProblemKey` with workflow-owned failure semantics, or
  prove that each value is durable workflow truth rather than CLI presentation.
  Prefer mapping workflow/domain failure codes to `CliProblemKey` at the Connect
  boundary.
  Decision: durable source-api failure payloads keep `SourceApiActionFailureCode`
  only; CLI problem keys are derived at the Connect boundary. Removed pre-deploy
  fields were not reserved.
- [x] Add comments to fields whose retention exists for deterministic replay
  rather than UI presentation.
- [ ] Add enum `UNSPECIFIED = 0` values and reject them at decode/validation
  boundaries before reducers see them.
- [x] Use dense enum numbering for new enums, reserve removed enum numbers and
  names, and never recycle enum names for a different meaning.
- [ ] Never reuse field numbers. If a field is removed after the new schema is
  merged, reserve both the number and name. Do not change field type or
  repeatedness in place.

## Code Generation

- [x] Update `proto/buf.gen.yaml` to keep generating TypeScript into
  `packages/cli-server/src/connect/gen`.
  Existing template output already covered the new internal workflow package.
- [x] Consider enabling `json_types=true` for generated internal protobuf types
  only if audit inspection tools need typed ProtoJSON output. ProtoJSON must
  remain derived/debug output, not canonical workflow storage.
  Decision: defer until an audit inspection/debug surface needs typed ProtoJSON.
- [x] Enable or evaluate `valid_types=protovalidate_required` so required
  fields are reflected in generated TypeScript shapes where practical. Treat it
  as an ergonomics improvement, not the correctness boundary; runtime
  Protovalidate checks still own stored-byte acceptance.
  Decision: defer for the first schema commit to avoid broad generated type
  churn before the codec boundary lands.
- [x] Verify `proto/buf.gen.yaml` uses protoc-gen-es option spelling accepted by
  the current generator; prefer documented options when generated output is
  unchanged.
- [x] Keep `@bufbuild/protobuf`, `@bufbuild/protoc-gen-es`, and generated code
  versions aligned through the workspace catalog.
- [x] Run `bun run proto:generate` after adding proto files.
- [x] Confirm generated files remain under
  `packages/cli-server/src/connect/gen/**` and are not manually edited.
- [x] Run `buf format -w proto` and `buf lint proto`.

## Storage Model

- [ ] Replace `workflow_commands.command_payload_json` with a protobuf binary
  payload column, for example `command_payload_bytes`.
- [ ] Replace `query_action_events.payload_json` with `payload_bytes`.
- [ ] Replace `source_api_action_events.payload_json` with `payload_bytes`.
- [ ] Replace `workflow_effect_dispatches.payload_json` with `payload_bytes`.
- [ ] Keep `workflow_commands.command_type`, event tables' `event_type`, and
  `workflow_effect_dispatches.effect_type` as indexed scalar columns.
- [ ] Keep JSON projection columns only where they are first-class read models,
  not as the canonical workflow payload store.
- [ ] Do not store ProtoJSON/text-format payloads as canonical workflow truth.
  If a UI/debug feed needs JSON, derive it from decoded protobuf/domain values.
- [ ] Do not compare or hash raw serialized protobuf bytes for idempotency,
  effect keys, or replay legality. Protobuf serialization is not a stable
  cross-build identity format.
- [ ] Generate a destructive Drizzle migration for the column rewrite. Do not
  edit `packages/db/src/migrations/**` manually.
- [ ] Update PGlite test setup and fixtures so fresh schemas are enough; no
  compatibility migration fixtures are required.
- [ ] Remove `WorkflowJson` usage from canonical workflow payload columns after
  the binary columns land.

## Codec Boundary

- [ ] Add a small codec module per workflow family near the audit family code,
  for example `query-action-family/protobuf-codec.ts`.
- [ ] Encode command payloads with `create(Schema, init)` and
  `toBinary(Schema, message)`.
- [ ] Decode command payloads with `fromBinary(Schema, bytes)`.
- [ ] Validate decoded internal messages with `@bufbuild/protovalidate` before
  converting to domain unions.
- [ ] Convert generated protobuf oneofs to the existing domain ADTs at one
  boundary only.
- [ ] Convert domain ADTs to generated protobuf oneofs at one boundary only.
- [ ] Return typed corruption errors on decode/validation failure, preserving
  the current distinction between corrupt audit state and normal domain failure.
- [ ] Keep protobuf enum conversion helpers narrow and exhaustive.
- [ ] Reject unknown, unspecified, or unsupported enum values before converting
  generated messages to domain commands/events/effects.
- [ ] Reject mismatches between stored scalar type columns and decoded protobuf
  oneof cases as audit corruption.
- [ ] Avoid byte-equality assertions or canonical-byte assumptions in codec
  logic; decode bytes, validate, then compare semantic/domain values.
- [ ] Add compile-time exhaustiveness checks for every oneof-to-domain switch.

## Query Workflow Cleanup

- [ ] Replace `QueryActionCommandPayload` hand-written union ownership with the
  protobuf codec boundary.
- [ ] Remove `StoredQueryValidationResultPayloadSchema` from
  `packages/cli-server/src/connect/service/query/workflow-codec.ts`.
- [ ] Remove `StoredQueryExecutionResultPayloadSchema` from
  `packages/cli-server/src/connect/service/query/workflow-codec.ts`.
- [ ] Keep `toStoredQueryExecutionResult` or rename it to a pure projector that
  accepts an already-decoded `record_query_execution` command payload.
- [ ] Move command-payload validation into stored command loading, not replay
  projection.
- [ ] Make `loadStoredAcceptedQueryActionResultCommand` return decoded command
  payloads.
- [ ] Keep event replay functions based on committed events where events contain
  the full truth, for example source lookup and credentials load.
- [ ] Keep query execution replay based on the stored result command because
  committed query execution events intentionally store only summary data.

## Source API Workflow Cleanup

- [ ] Replace source-api stored execution result JSON/base64 encoding with the
  internal protobuf `bytes` body representation.
- [ ] Remove duplicate Zod payload schemas from
  `packages/cli-server/src/connect/service/source-api/workflow-codec.ts` after
  protobuf decode/validation covers stored commands.
- [ ] Keep source-api descriptor and request-preparation replay projections pure
  and typed.
- [ ] Make page-fetch replay decode a typed protobuf result command before
  projecting to runtime `PageFetchResult`.
- [ ] Confirm continuation state remains a protobuf-supported JSON value
  boundary, for example `google.protobuf.Value`, and is not cast with `as never`.

## Reducers And State Machines

- [ ] Keep `decideQueryAction` and `decideSourceApiAction` accepting domain
  commands, not raw protobuf messages.
- [ ] Keep reducers accepting domain events, not raw protobuf messages.
- [ ] Ensure every reducer transition still defines truth and no effect runner
  updates state directly.
- [ ] Remove any reducer-level shape guards made redundant by protobuf boundary
  decoding.
- [ ] Keep normal failure/retry lifecycle states modeled as command/event
  transitions, not thrown exceptions.

## Audit Feed And Projections

- [ ] Update audit feed projection code to consume decoded protobuf payloads.
- [ ] Keep read models separate from canonical workflow payloads.
- [ ] If audit feed needs JSON for UI/debugging, derive it from decoded
  protobuf/domain values instead of reading JSON payload columns.
- [ ] Update corruption diagnostics to include family, command id, action id,
  and payload type, without logging raw row/result bodies unnecessarily.

## Tests

- [ ] Add unit tests for command/event/effect protobuf encode/decode round trips.
- [ ] Add tests for invalid protobuf payload bytes producing typed corruption
  failures.
- [ ] Add tests for Protovalidate failures producing typed corruption failures.
- [ ] Add tests for enum `UNSPECIFIED` or unknown values being rejected before
  reducers.
- [ ] Add tests for scalar type column/protobuf oneof case mismatches producing
  typed corruption failures.
- [ ] Add tests proving idempotency/effect keys do not depend on serialized
  protobuf byte equality.
- [ ] Update query workflow integration tests for replay after stored result
  command persistence.
- [ ] Update source-api workflow integration tests for replay with binary
  response bodies.
- [ ] Update storage integration tests for binary payload columns.
- [ ] Add a regression test proving the local Zod schemas are gone from replay
  paths and stored command loading owns decode/validation.

## Removal Tasks

- [ ] Delete obsolete workflow payload Zod schemas once protobuf decode is in
  place.
- [ ] Delete JSON/base64 source-api storage helpers that only existed to make
  JSONB persistence possible.
- [ ] Delete old `WorkflowJson` payload plumbing from canonical workflow storage.
- [ ] Remove no-longer-needed casts around source-api JSON bodies.
- [ ] Remove any temporary migration scripts after the destructive migration is
  checked in.

## Verification

- [x] Run `bun run proto:generate`.
- [x] Run `buf format -w proto`.
- [x] Run `buf lint proto`.
- [x] Run `bun lint --format json`.
- [ ] Run `bun lint --format json --type-aware` if generated/internal codec
  typing changes are non-trivial.
- [x] Run `bunx turbo typecheck --json`.
- [ ] Run `bunx turbo test --json`.
- [ ] Run focused workflow tests first while iterating:
  `bun test packages/cli-server/src/audit/storage.integration.test.ts`.
- [ ] Run focused query workflow tests while iterating:
  `bun test packages/cli-server/src/connect/service/query/workflow.integration.test.ts`.
- [ ] Run focused source-api workflow tests while iterating:
  `bun test packages/cli-server/src/connect/service/source-api/workflow.integration.test.ts`.

## Acceptance Criteria

- [x] Durable workflow payload schemas are defined in proto files.
- [ ] Durable workflow payloads are stored as protobuf bytes.
- [x] Public Connect RPC schemas remain separate from internal audit schemas.
- [ ] Workflow proto files do not import `onequery/cli/v1/**`, and workflow
  storage codecs do not persist CLI/API response messages as canonical truth.
- [ ] Stored command/effect/event loading performs protobuf decode and
  Protovalidate validation at the boundary.
- [ ] Stored scalar type columns and protobuf oneof cases are cross-checked at
  decode time.
- [ ] Reducers and replay projectors do not parse Zod schemas.
- [ ] Query execution replay still returns rows/columns from the stored result
  command without rerunning SQL.
- [ ] Source-api replay still returns binary/json/text/empty bodies without
  lossy conversions.
- [ ] No workflow identity, idempotency, or legality check relies on serialized
  protobuf byte stability.
- [ ] Corrupt stored bytes are reported as audit corruption, not normal user
  errors.
- [ ] No backward-compatible JSON payload read path remains.
