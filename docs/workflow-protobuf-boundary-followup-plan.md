# Workflow Protobuf Boundary Follow-Up Plan

This plan starts after `docs/workflow-protobuf-audit-plan.md` lands. The first
plan moves canonical workflow storage from JSON/Zod payloads to protobuf bytes.
This follow-up plan handles larger package-boundary and naming rewrites.

The application is not deployed to users yet, so this plan may use destructive
renames and hard route/package rewrites where they produce a cleaner long-term
shape.

## Design Position

- [x] Keep `onequery.workflow.v1` separate from RPC/API packages. Workflow
  messages are durable internal commands, events, effects, and replay payloads.
- [x] Do not merge workflow payloads into `onequery.cli.v1` just because the
  generated TypeScript currently lives under `packages/cli-server`.
- [x] Treat package names as ownership and compatibility boundaries:
  same process does not mean same protobuf lifecycle.
  Enforced by `bun run proto:boundaries` and documented in `proto/README.md`.
- [x] Do not follow one-file-per-entity splitting. Split files by lifecycle,
  owner, dependency weight, and readability.
- [x] Prefer explicit mapping between packages over shared messages whose
  compatibility requirements are only accidentally aligned.
  Current proto files stay grouped by service/domain and workflow family rather
  than by individual message. Cross-package edges use explicit codecs and
  projection helpers instead of broad shared API/workflow messages.
- [x] Keep `common.proto` files small. Move a type to common only after two
  contexts need the same semantics and the same evolution rules.
  Removed unused `WorkflowFamily`, `WorkflowSurface`, and
  `WorkflowActorSnapshot` declarations from workflow `common.proto`; those
  concepts remain TypeScript/DB audit metadata instead of protobuf payloads.

## Boundary Taxonomy

- [x] `onequery.workflow.v1` owns durable workflow truth.
  - commands accepted by deterministic state machines
  - committed events
  - deferred effects
  - replay-only payloads needed to avoid rerunning effects
  - workflow-owned failure/retry lifecycle values
- [x] `onequery.cli.v1` owns CLI RPC behavior if the API is intentionally
  CLI-specific.
  - Connect services and RPC method routes
  - request validation shapes
  - CLI presentation response shapes
  - CLI error detail references and CLI problem keys
  - pagination/sanitization/continuation values as exposed to the CLI
- [x] `onequery.api.v1` should replace or sit above `onequery.cli.v1` only if
  the same RPC contract is meant to be shared by CLI, web, agent, and other
  product clients.
- [x] `onequery.internal_rpc.v1` is an option only if the transport is an
  implementation detail between internal processes and not a product/client
  contract.
  Decision: neither applies now. The current RPC contract is CLI-specific, not a
  shared product API, and it is consumed by the Rust CLI rather than being only
  private server-internal transport.

## Decision Points

- [x] Decide whether `onequery.cli.v1` is a real product boundary or an
  implementation-era name.
- [x] If the contract is CLI-only, keep `onequery.cli.v1` and avoid broad API
  renaming.
  Decision: keep `onequery.cli.v1` for now. The current contract is consumed by
  the Rust CLI, CLI self-host smoke tests, and CLI server tests; no shared web,
  agent, or public product client imports the CLI API package.
- [x] If the contract is shared product API, rename to `onequery.api.v1` before
  external clients depend on service paths.
- [x] If the contract is server-internal transport, consider
  `onequery.internal_rpc.v1` and keep public/client DTOs separate from it.
  Decision: no rename to `onequery.api.v1` or `onequery.internal_rpc.v1` now
  because the current generated API is not shared with web/agent/public product
  clients and is not merely internal process transport.
- [x] Decide whether workflow packages remain one package:
  `onequery.workflow.v1`.
- [x] Split workflow into family packages only if query and source-api workflows
  get independent owners, migration cadence, generated outputs, or storage
  compatibility rules.
  Decision: keep one workflow package. Query and source-api workflows share the
  same durable audit storage and generated ownership path today.

## Workflow Cleanup

- [x] Remove CLI API concepts from durable workflow proto messages.
- [x] Replace `WorkflowCliProblemKey` with workflow-owned failure semantics.
  Prefer storing family failure codes plus domain detail, then mapping those to
  `CliProblemKey` at the Connect boundary.
  Source-api workflow commands/events now retain only workflow failure codes and
  detail. `packages/cli-server/src/connect/service/source-api/workflow-failures.ts`
  maps those codes to CLI problem keys during Connect result projection.
- [x] Keep origin metadata such as `WorkflowSurface` only when it is audit truth,
  not as a proxy for response presentation.
- [x] Keep `WorkflowSourceProvider` and `WorkflowDataSourceStatus` in workflow
  only if they are durable replay facts. Otherwise map from database/domain
  values at encode/decode boundaries.
  `WorkflowSurface` is stored as command/audit-feed metadata, not in workflow
  payload bytes. Provider and status enums remain because replayed query/source
  descriptors and source-api descriptors/results need the provider/status facts
  without reloading source records.
- [x] Add narrow conversion helpers for every API-to-workflow and
  workflow-to-API mapping.
- [x] Add exhaustiveness checks for those conversions so future enum additions
  cannot silently fall through.
  Source-api workflow failure projection uses narrow per-phase helpers with
  `never` exhaustiveness checks and focused mapping tests.
  Connect query/source-api replay projections, CLI response codecs, source
  provider conversion, and server audit-feed workflow protobuf projection now
  use typed conversion helpers with `assertNever` checks for TypeScript unions
  and explicit unknown-value errors for decoded protobuf enums.

## API Package Rewrite

- [x] Inventory generated proto imports outside `packages/cli-server`.
  Findings:
  - `apps/cli/scripts/self-host-smoke.integration.test.ts` directly imports
    generated `onequery/cli/v1/*_pb.js` files from
    `packages/cli-server/src/connect/gen` for smoke-test requests.
  - `packages/server/src/audit/feed.ts` imports workflow generated messages via
    `@onequery/contracts/workflow/v1/*_pb` for runtime audit-feed decoding.
  - `packages/server/src/routes/organizations.integration.test.ts` imports the
    same workflow contracts package in tests.
  - No production package outside `packages/cli-server` directly imports
    generated `onequery/cli/v1` TypeScript.
- [x] Inventory Connect service paths referenced by tests, CLI code, docs, and
  scripts.
  Findings:
  - CLI server route and logging tests assert
    `/onequery.cli.v1.*`, `/api/cli/onequery.cli.v1.*`, and
    `/connectrpc/onequery.cli.v1.*` paths.
  - `packages/self-host-runtime/src/app.test.ts` asserts forwarding to
    `/api/cli/onequery.cli.v1.CliAuthService/GetSession`.
  - Rust CLI auth tests and session code reference
    `/api/cli/onequery.cli.v1.CliAuthService/*`.
  - Rust and TypeScript CLI error handling use the `onequery.cli.v1`
    `google.rpc.ErrorInfo` domain.
- [x] If renaming `onequery.cli.v1`, update service package names, generated
  import paths, error domains, route assertions, integration tests, and CLI
  client wiring in one hard rewrite.
- [x] Do not add compatibility routes unless the API is deployed before this
  rewrite starts.
- [x] Keep request/response DTOs presentation-shaped; do not make them mirror
  workflow command/event/effect messages.
- [x] Keep durable replay payloads out of API responses unless they are
  explicitly product-visible.
  Decision: no package rename is happening in this pass, so no compatibility
  routes were added. CLI request/response protos remain presentation-shaped, and
  workflow replay payloads stay behind explicit projection/mapping code.

## File Organization

- [x] Keep current service/domain files if they remain readable:
  `auth.proto`, `org.proto`, `query.proto`, `source.proto`,
  `source_api.proto`, and `common.proto`.
- [x] Split `source.proto` only if provider credentials, source metadata, and
  source testing need separate ownership or dependency boundaries.
- [x] Split `source_api.proto` only if descriptor, preview, execution, and
  continuation shapes begin changing independently.
- [x] Keep workflow files grouped by family unless generated output size or
  ownership pressure makes finer files worthwhile.
- [x] Avoid creating a broad cross-package domain proto unless a shared type has
  a stable semantic contract outside both CLI/API and workflow.
  Decision: keep the current grouping. `source.proto` and `source_api.proto`
  are the largest CLI files, but their message sets still share service
  lifecycle and client ownership. Workflow protos remain grouped by action
  family, and no broad shared domain proto is justified by current ownership.

## Generation And Ownership

- [x] Keep generated code under `packages/cli-server/src/connect/gen` while it
  is server-owned implementation code.
  Full server-owned generated output remains there. The additional
  `packages/contracts/src/connect/gen` output is a narrow workflow payload
  subset for workspace imports, not a change to protobuf package ownership.
- [x] Move generated API/client code to a shared package only when another
  workspace package needs to import it directly.
- [x] Consider separate generation outputs for API and workflow only if it
  improves dependency boundaries or publishability.
  Decision: no shared generated CLI API package now. The only direct
  `onequery.cli.v1` generated import outside `packages/cli-server` is a
  CLI-owned smoke test, while production workspace imports use the narrow
  workflow contracts output. The current full server output plus workflow
  contracts output is the right split until a production client needs generated
  CLI/API code directly.
- [x] Add a lightweight check that workflow proto files do not import
  `onequery/cli/v1/**`.
- [x] Add a lightweight check that API proto files do not import
  `onequery/workflow/v1/**`.
  `bun run proto:boundaries` scans source `.proto` imports for workflow ->
  CLI and CLI/API -> workflow edges, and `bun run proto:check` now runs it.

## Verification

- [x] Run `buf format -w proto`.
  Ran as `bunx buf format -w proto`.
- [x] Run `buf lint proto`.
  Ran as `bun run proto:lint`.
- [x] Run `bun run proto:generate`.
  Generated output was already current.
- [x] Run `bun lint --format json`.
- [x] Run `bun run lint --type-aware --type-check`.
- [x] Run focused Connect route tests after package or service path renames.
  Not applicable in this pass because `onequery.cli.v1` service/package paths
  were intentionally retained and no compatibility routes were added.
- [x] Run focused workflow replay tests after any workflow failure-code rewrite.
  Ran source-api workflow replay/integration coverage and focused workflow
  projection tests after tightening failure-code and API projection mappings.

## Acceptance Criteria

- [x] Workflow durable bytes do not depend on CLI response DTOs, service names,
  route names, or CLI problem-key presentation.
  Workflow protos are import-separated from CLI protos, and source-api durable
  failure payloads now store workflow failure codes instead of CLI problem keys.
- [x] API package names describe the actual client boundary.
  `onequery.cli.v1` is retained because current RPC consumers are CLI-specific.
- [x] Every cross-boundary conversion is explicit, narrow, and exhaustively
  checked.
  Durable protobuf codecs, Connect replay projections, CLI API response
  projections, source provider mapping, and server audit-feed protobuf
  projection now use narrow helpers or typed projections with exhaustive
  TypeScript union checks and explicit decoded-enum failure paths.
- [x] File splits are justified by ownership, lifecycle, dependency weight, or
  readability, not by mechanical one-type-per-file rules.
  Current file grouping follows service/domain ownership and workflow-family
  lifecycle. No new file split was made without ownership, lifecycle,
  dependency, or readability pressure.
- [x] Generated-code placement is documented as an implementation detail, not
  confused with protobuf package ownership.
  `proto/README.md` documents the full server-owned output, the narrow
  contracts output, and the source `.proto` boundary check.
