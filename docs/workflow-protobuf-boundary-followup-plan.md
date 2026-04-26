# Workflow Protobuf Boundary Follow-Up Plan

This plan starts after `docs/workflow-protobuf-audit-plan.md` lands. The first
plan moves canonical workflow storage from JSON/Zod payloads to protobuf bytes.
This follow-up plan handles larger package-boundary and naming rewrites.

The application is not deployed to users yet, so this plan may use destructive
renames and hard route/package rewrites where they produce a cleaner long-term
shape.

## Design Position

- [ ] Keep `onequery.workflow.v1` separate from RPC/API packages. Workflow
  messages are durable internal commands, events, effects, and replay payloads.
- [ ] Do not merge workflow payloads into `onequery.cli.v1` just because the
  generated TypeScript currently lives under `packages/cli-server`.
- [ ] Treat package names as ownership and compatibility boundaries:
  same process does not mean same protobuf lifecycle.
- [ ] Do not follow one-file-per-entity splitting. Split files by lifecycle,
  owner, dependency weight, and readability.
- [ ] Prefer explicit mapping between packages over shared messages whose
  compatibility requirements are only accidentally aligned.
- [ ] Keep `common.proto` files small. Move a type to common only after two
  contexts need the same semantics and the same evolution rules.

## Boundary Taxonomy

- [ ] `onequery.workflow.v1` owns durable workflow truth.
  - commands accepted by deterministic state machines
  - committed events
  - deferred effects
  - replay-only payloads needed to avoid rerunning effects
  - workflow-owned failure/retry lifecycle values
- [ ] `onequery.cli.v1` owns CLI RPC behavior if the API is intentionally
  CLI-specific.
  - Connect services and RPC method routes
  - request validation shapes
  - CLI presentation response shapes
  - CLI error detail references and CLI problem keys
  - pagination/sanitization/continuation values as exposed to the CLI
- [ ] `onequery.api.v1` should replace or sit above `onequery.cli.v1` only if
  the same RPC contract is meant to be shared by CLI, web, agent, and other
  product clients.
- [ ] `onequery.internal_rpc.v1` is an option only if the transport is an
  implementation detail between internal processes and not a product/client
  contract.

## Decision Points

- [ ] Decide whether `onequery.cli.v1` is a real product boundary or an
  implementation-era name.
- [ ] If the contract is CLI-only, keep `onequery.cli.v1` and avoid broad API
  renaming.
- [ ] If the contract is shared product API, rename to `onequery.api.v1` before
  external clients depend on service paths.
- [ ] If the contract is server-internal transport, consider
  `onequery.internal_rpc.v1` and keep public/client DTOs separate from it.
- [ ] Decide whether workflow packages remain one package:
  `onequery.workflow.v1`.
- [ ] Split workflow into family packages only if query and source-api workflows
  get independent owners, migration cadence, generated outputs, or storage
  compatibility rules.

## Workflow Cleanup

- [ ] Remove CLI API concepts from durable workflow proto messages.
- [ ] Replace `WorkflowCliProblemKey` with workflow-owned failure semantics.
  Prefer storing family failure codes plus domain detail, then mapping those to
  `CliProblemKey` at the Connect boundary.
- [ ] Keep origin metadata such as `WorkflowSurface` only when it is audit truth,
  not as a proxy for response presentation.
- [ ] Keep `WorkflowSourceProvider` and `WorkflowDataSourceStatus` in workflow
  only if they are durable replay facts. Otherwise map from database/domain
  values at encode/decode boundaries.
- [ ] Add narrow conversion helpers for every API-to-workflow and
  workflow-to-API mapping.
- [ ] Add exhaustiveness checks for those conversions so future enum additions
  cannot silently fall through.

## API Package Rewrite

- [ ] Inventory generated proto imports outside `packages/cli-server`.
- [ ] Inventory Connect service paths referenced by tests, CLI code, docs, and
  scripts.
- [ ] If renaming `onequery.cli.v1`, update service package names, generated
  import paths, error domains, route assertions, integration tests, and CLI
  client wiring in one hard rewrite.
- [ ] Do not add compatibility routes unless the API is deployed before this
  rewrite starts.
- [ ] Keep request/response DTOs presentation-shaped; do not make them mirror
  workflow command/event/effect messages.
- [ ] Keep durable replay payloads out of API responses unless they are
  explicitly product-visible.

## File Organization

- [ ] Keep current service/domain files if they remain readable:
  `auth.proto`, `org.proto`, `query.proto`, `source.proto`,
  `source_api.proto`, and `common.proto`.
- [ ] Split `source.proto` only if provider credentials, source metadata, and
  source testing need separate ownership or dependency boundaries.
- [ ] Split `source_api.proto` only if descriptor, preview, execution, and
  continuation shapes begin changing independently.
- [ ] Keep workflow files grouped by family unless generated output size or
  ownership pressure makes finer files worthwhile.
- [ ] Avoid creating a broad cross-package domain proto unless a shared type has
  a stable semantic contract outside both CLI/API and workflow.

## Generation And Ownership

- [ ] Keep generated code under `packages/cli-server/src/connect/gen` while it
  is server-owned implementation code.
- [ ] Move generated API/client code to a shared package only when another
  workspace package needs to import it directly.
- [ ] Consider separate generation outputs for API and workflow only if it
  improves dependency boundaries or publishability.
- [ ] Add a lightweight check that workflow proto files do not import
  `onequery/cli/v1/**`.
- [ ] Add a lightweight check that API proto files do not import
  `onequery/workflow/v1/**`.

## Verification

- [ ] Run `buf format -w proto`.
- [ ] Run `buf lint proto`.
- [ ] Run `bun run proto:generate`.
- [ ] Run `bun lint --format json`.
- [ ] Run `bunx turbo typecheck --json`.
- [ ] Run focused Connect route tests after package or service path renames.
- [ ] Run focused workflow replay tests after any workflow failure-code rewrite.

## Acceptance Criteria

- [ ] Workflow durable bytes do not depend on CLI response DTOs, service names,
  route names, or CLI problem-key presentation.
- [ ] API package names describe the actual client boundary.
- [ ] Every cross-boundary conversion is explicit, narrow, and exhaustively
  checked.
- [ ] File splits are justified by ownership, lifecycle, dependency weight, or
  readability, not by mechanical one-type-per-file rules.
- [ ] Generated-code placement is documented as an implementation detail, not
  confused with protobuf package ownership.
