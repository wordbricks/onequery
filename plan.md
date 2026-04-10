# plan.md

## Status after static review

The main cutover exists: `onequery use` now goes through `source_api`, the new proto exists, and the server has a canonical `packages/server/src/source-api/` domain.

It is **not finished enough to call complete**. The remaining gaps are:
- legacy `/api/data-sources/*/query` routes are still mounted;
- `CliSourceApiFieldPolicy` is still partly stringly-typed (`syntaxes`, `transport_rules`);
- normalized plans are missing policy-ready fields (`host`, `selectorTemplate`, `bodyPaths`, and structured-request `method`);
- the Connect execute handler still bypasses the canonical server `executeSourceApi()` pipeline;
- policy types are still missing from `packages/server/src/source-api/types.ts`;
- some discovery/default strings still describe the old execute shape.

## 1) Remove the legacy HTTP query surface completely

- [x] Delete these files:
  - `packages/server/src/routes/data-sources/amplitude-query.ts`
  - `packages/server/src/routes/data-sources/ga-query.ts`
  - `packages/server/src/routes/data-sources/mixpanel-query.ts`
  - `packages/server/src/routes/data-sources/mongodb-query.ts`
  - `packages/server/src/routes/data-sources/posthog-query.ts`
  - `packages/server/src/routes/data-sources/sentry-query.ts`
  - `packages/server/src/routes/data-sources/build-source-api-route-response.ts`
  - `packages/server/src/routes/data-sources/create-provider-route.ts`
  - `packages/server/src/routes/data-sources/query-validation.ts`
  - `packages/server/src/routes/data-sources/create-provider-route.integration.test.ts`
  - `packages/server/src/routes/data-sources/query-validation.test.ts`
- [x] Update `packages/server/src/routes/data-sources.ts`:
  - remove the deleted imports;
  - remove the deleted `.route("/", ...)` registrations;
  - rewrite the file comment so it no longer mentions relay query routes.
- [x] Remove route-only exports from adapters and make them internal or delete them:
  - `packages/server/src/source-api/adapters/amplitude.ts`
    - `AmplitudeProviderRouteRequest`
    - `parseAmplitudeProviderRouteRequest`
  - `packages/server/src/source-api/adapters/ga.ts`
    - `googleAnalyticsSourceApiOperationSchema` export
    - `isGoogleAnalyticsSourceCredentials` export
  - `packages/server/src/source-api/adapters/mixpanel.ts`
    - `MixpanelSourceApiRequest` export if not needed by tests
    - `parseMixpanelProviderRouteRequest`
  - `packages/server/src/source-api/adapters/mongodb.ts`
    - `MongoDbSourceApiRequest` export if not needed by tests
    - `parseMongoDbProviderRouteRequest`
  - `packages/server/src/source-api/adapters/posthog.ts`
    - `parsePostHogProviderRouteRequest`
  - `packages/server/src/source-api/adapters/sentry.ts`
    - `SentryProviderRouteRequest`
    - `parseSentryProviderRouteRequest`
- [x] Leave `packages/server/src/routes/data-sources/github-repositories.ts` intact. It is not part of the legacy query surface.

**Done when**
- [x] `rg -n 'createProviderRoute|buildSourceApiRouteResponse|/amplitude/query|/ga/query|/mixpanel/query|/mongodb/query|/posthog/query|/sentry/query|query-validation' packages/server/src` returns no source hits.

## 2) Make the descriptor/proto fully machine-readable

- [x] Replace `CliSourceApiFieldPolicy` in `proto/onequery/cli/v1/source_api.proto` with this exact wire shape:

```proto
message CliSourceApiFieldPolicy {
  bool supports_raw_fields = 1;
  bool supports_typed_fields = 2;
  bool supports_nested_paths = 3;
  bool supports_array_paths = 4;
  bool accepts_input = 5;
  CliSourceApiInputMode input_mode = 6;
  bool merge_patches = 7;
}

enum CliSourceApiInputMode {
  CLI_SOURCE_API_INPUT_MODE_UNSPECIFIED = 0;
  CLI_SOURCE_API_INPUT_MODE_NONE = 1;
  CLI_SOURCE_API_INPUT_MODE_REQUEST_OBJECT = 2;
  CLI_SOURCE_API_INPUT_MODE_REQUEST_BODY = 3;
}
```

- [x] Delete `syntaxes` and `transport_rules` from the proto.
- [x] Regenerate protobuf outputs:
  - `bun run proto:generate`
  - commit the regenerated files under `packages/cli-server/src/connect/gen/`
  - rebuild the Rust transport via the existing CLI build script (`apps/cli/crates/onequery-cli/build.rs` handles codegen during Cargo build)
- [x] Update `packages/cli-server/src/connect/service/conversions.ts`:
  - map `SourceApiFieldPolicy` to the new proto fields directly;
  - stop generating human-readable transport strings.
- [x] Update `apps/cli/crates/onequery-cli/src/transport/source_api.rs`:
  - change the Rust `SourceApiFieldPolicy` struct to the new fields;
  - remove `syntaxes` and `transport_rules` decoding.
- [x] Update CLI planning/parsing to use only machine fields:
  - `apps/cli/crates/onequery-cli/src/commands/source_api/field_patch.rs`
    - take `supports_nested_paths` and `supports_array_paths` directly;
    - delete the current string-inference helper path.
  - `apps/cli/crates/onequery-cli/src/commands/source_api/plan.rs`
    - use `accepts_input`, `input_mode`, and `merge_patches` directly;
    - delete the current `transport_rules` inference path.
- [x] Keep user-facing formatting local. If the CLI wants to print examples like `key[subkey]=value`, derive that in render code from booleans instead of shipping those strings over RPC.

**Done when**
- [x] `rg -n 'transport_rules|syntaxes|supports --input|does not support --input' proto packages/cli-server/src/connect/service apps/cli/crates/onequery-cli/src/commands/source_api apps/cli/crates/onequery-cli/src/transport/source_api.rs` returns no hits.

## 3) Finish the normalized plan so it is policy-ready

- [x] Add missing policy types to `packages/server/src/source-api/types.ts`:
  - `SourceApiPolicyRule`
  - `SourceApiPolicyDecision`
  - keep them minimal and server-only for now.
- [x] Ensure **every** normalized plan has an explicit method:
  - all `structured_request` adapters must return `method: "POST"`.
- [x] Populate `host` for every `http_request` plan from the finalized request URL host.
- [x] Populate `selectorTemplate` for every operation:
  - raw HTTP endpoint operations: use `"/{path}"`;
  - repo-scoped/raw-provider variants: use the most stable template the adapter can guarantee;
  - identifier selectors: use explicit templates such as `"properties/{propertyId}"` when applicable.
- [x] Populate `bodyPaths` from the **normalized** request payload, not from raw CLI flags:
  - for `structured_request`, derive paths from `plan.request`;
  - for `http_request` with JSON body, derive paths from `plan.body` when `body.kind === "json"`;
  - for text/binary/none bodies, use `[]`.
- [x] Add one shared helper in `packages/server/src/source-api/` for JSON path extraction so adapters do not reimplement it.
- [x] Update adapter normalize tests to assert these fields for each provider.
- [x] Update `packages/server/src/source-api/normalize.test.ts` so the redacted plan contract checks `method`, `host`, `selector`, `selectorTemplate`, `headerNames`, `bodyKind`, and `bodyPaths`.

**Done when**
- [x] `rg -n 'selectorTemplate|bodyPaths|host:' packages/server/src/source-api` shows real production code, not only types/tests.
- [x] `rg -n 'kind: "structured_request"' packages/server/src/source-api/adapters -A12 | rg 'method:'` shows explicit `method: "POST"` assignments.

## 4) Make the Connect handler a thin wrapper over the canonical domain

- [ ] Update `packages/cli-server/src/connect/service/source_api.ts` so `handleExecuteSourceApi` no longer calls `getSourceApiAdapter(...).execute(...)` directly.
- [ ] Use the canonical server domain as the only execution orchestrator:
  - either call existing `packages/server/src/source-api/execute.ts::executeSourceApi()`;
  - or add one domain entrypoint that returns both `{ plan, response }` if you need plan data for logging.
- [ ] Keep source loading / credential preparation in the Connect layer, but move describe → normalize → authorize → execute sequencing behind one server-domain function.
- [ ] Add explicit execute-error mapping in the Connect layer:
  - normalization errors -> `InvalidArgument` / `FailedPrecondition`;
  - authorization errors -> `PermissionDenied`;
  - provider execution failures -> explicit `ConnectError` mapping instead of uncaught generic throws.
- [ ] Add one test in `packages/cli-server/src/connect/service/source_api.test.ts` where adapter execution throws and the handler returns the expected `ConnectError`.

**Done when**
- [ ] `rg -n 'getSourceApiAdapter\(|\.execute\({' packages/cli-server/src/connect/service/source_api.ts` does not show direct adapter execution from the Connect service.

## 5) Fix CLI discovery/default strings to match the new command shape

- [ ] Update `packages/cli-server/src/cli-defaults.ts`:
  - keep inspect example: `onequery use --source <source-key>`
  - replace the old execute example with one of these:
    - raw HTTP example: `onequery use --source <source-key> /path`
    - structured example: `onequery use --source <source-key> --op <operation> --input '<json>'`
- [ ] Update `packages/cli-server/src/cli-defaults.test.ts` to match the new canonical examples.
- [ ] Search for provider-as-source wording in source-api-related tests/comments and rewrite it to source-key wording where the command is `onequery use`.

**Done when**
- [ ] `packages/cli-server/src/cli-defaults.ts` no longer treats `onequery use --source <source> --input '<json>'` as the generic execute example.

## 6) Final repository cleanup

- [ ] Delete the empty directory `packages/cli-server/src/use/`.
- [ ] Remove committed local tool/build artifacts:
  - `apps/cli/crates/onequery-config/src/target`
  - `apps/cli/crates/onequery-cli-core/src/target`
  - `apps/cli/crates/onequery-cli/src/target`
  - `apps/cli/crates/onequery-cli/src/transport/target`
  - `apps/cli/crates/onequery-cli/src/commands/auth/target`
  - `proto/node_modules`
- [ ] Update ignore rules if needed so these paths do not come back.

**Done when**
- [ ] `find apps/cli proto -type d \( -name target -o -name node_modules \)` does not report committed source-tree artifacts.

## 7) Verification pass

Run these after the code changes:

- [ ] `bun run proto:check`
- [ ] `bun run --cwd packages/server test`
- [ ] `bun run --cwd packages/cli-server test`
- [ ] `cd apps/cli && cargo test -p onequery-cli`
- [ ] `cd apps/cli && cargo test -p onequery-cli source_api`

Ship only when all of these are true:
- [ ] `onequery use --source <SOURCE_KEY>` describes the live source API surface.
- [ ] `onequery use --source <SOURCE_KEY> /path` executes through Connect only.
- [ ] `onequery use --source <SOURCE_KEY> --dry-run ...` prints a redacted normalized plan with `method`, `host`, `selector`, `selectorTemplate`, `headerNames`, `bodyKind`, and `bodyPaths`.
- [ ] no legacy `/api/data-sources/*/query` routes remain.
