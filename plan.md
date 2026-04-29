# Supervisor-Owned Lifecycle RPC Rewrite Plan

## Goal

Hard-rewrite self-host lifecycle control so `apps/cli/crates/gateway` supervisor owns the lifecycle control plane as a Connect RPC server, and `packages/self-host-runtime` participates as a Connect RPC client.

Do not preserve backward compatibility shims for the current runtime-owned `RuntimeControlService`. Remove the runtime control server path once the supervisor-owned protocol is complete.

## Current Shape To Replace

- Runtime starts a Connect server in `packages/self-host-runtime/src/self-host/runtime-control/server.ts`.
- Gateway supervisor connects as a Rust Connect client from `apps/cli/crates/gateway/src/runtime/control.rs`.
- Startup readiness is inferred by supervisor polling/watching runtime `WatchStatus`.
- `gateway stop` sends a signal to the supervisor, then waits for runtime records to disappear.
- Supervisor writes supervisor lifecycle records; runtime writes runtime lease/status records; supervisor writes terminal runtime status when the child exits unexpectedly.

This plan moves active control to the supervisor:

- Supervisor serves Connect RPC.
- Runtime opens a client session to supervisor.
- Runtime reports lifecycle events through the session.
- Supervisor issues stop commands through the session.
- CLI stop/status/watch uses supervisor RPC instead of process signals where possible.

## Reference Material In `.tmp`

Use these references directly during implementation:

- `.tmp/connect-rust-repo/docs/guide.md`
  - Rust service trait implementation.
  - `Context`, error handling, server streaming and bidirectional streaming shapes.
  - Standalone server examples using `connectrpc::server::Server`.
- `.tmp/connect-rust-repo/conformance/src/bin/server.rs`
  - `Server::bind(...)`, `local_addr()`, `ConnectRpcService::new(...)`, `serve_with_service(...)`.
  - Message size limit wiring with `Limits`.
- `.tmp/connect-rust-repo/connectrpc/src/server.rs`
  - Built-in server graceful shutdown APIs, especially `serve_with_service_and_shutdown`.
- `.tmp/connect-rust-repo/connectrpc/src/client/http2.rs`
  - Existing Unix-socket client path via `Http2Connection::connect_unix`.
- `.tmp/connect-rust-repo/tests/streaming/src/lib.rs`
  - Server streaming and bidi streaming test patterns.
- `.tmp/connect-rust-repo/connectrpc-codegen/src/codegen.rs`
  - Generated Rust service trait/client/server names and handler signatures.
- `.tmp/connect-es-repo/packages/connect-node/src/connect-transport.ts`
  - `createConnectTransport(...)` options for Node clients.
- `.tmp/connect-es-repo/packages/connect-node/src/node-transport-options.ts`
  - `nodeOptions` shape for HTTP/2 custom connection/session options.
- `.tmp/connect-examples-es-repo/vanilla-node/client.ts`
  - Minimal `createClient(...)` + `createConnectTransport(...)` client shape.
- `.tmp/connect-examples-es-repo/vanilla-node/client.test.ts`
  - Node test-server/client patterns with `connectNodeAdapter` and `createConnectTransport`.

Do not search all of `.tmp`; keep searches scoped to the files above or to `connect-*` directories named in `AGENTS.md`.

## Target Protocol

Create a new proto file:

- `proto/onequery/runtime/v1/supervisor.proto`

Keep shared lifecycle messages in `common.proto` where they are genuinely shared. Avoid overloading `control.proto`; that file describes the old runtime-owned API and should be deleted or reduced during the rewrite.

Recommended service:

```proto
service SupervisorLifecycleService {
  rpc OpenRuntimeSession(stream RuntimeSessionEvent) returns (stream SupervisorSessionCommand);

  rpc GetStatus(GetSupervisorStatusRequest) returns (GetSupervisorStatusResponse) {
    option idempotency_level = NO_SIDE_EFFECTS;
  }

  rpc Stop(StopSupervisorRuntimeRequest) returns (StopSupervisorRuntimeResponse);

  rpc WatchStatus(WatchSupervisorStatusRequest) returns (stream WatchSupervisorStatusResponse) {
    option idempotency_level = NO_SIDE_EFFECTS;
  }
}
```

Core message model:

- `RuntimeSessionEvent`
  - `hello`
  - `heartbeat`
  - `runtime_transition`
  - `runtime_ready`
  - `shutdown_started`
  - `shutdown_finished`
  - `shutdown_failed`
  - `runtime_exiting`
- `SupervisorSessionCommand`
  - `stop`
  - `close`
  - `ping`
- `RuntimeSessionHello`
  - `launch_id`
  - `data_dir`
  - `runtime_pid`
  - `supervisor`
  - `runtime_sequence`
  - `started_at`
- `SupervisorStopCommand`
  - `operation_id`
  - `reason`
  - `completion`
  - `grace_timeout`
  - `target`
- `SupervisorStatus`
  - `supervisor`
  - `launch`
  - `phase`
  - `supervisor_sequence`
  - `runtime`
  - `runtime_phase`
  - `runtime_sequence`
  - `updated_at`
  - `failure`
  - `active_session`
- `WatchSupervisorStatusResponse`
  - snapshot or transition.

Every externally supplied identity field needs `buf.validate` constraints. Keep field presence explicit where zero is meaningful.

## Transport Contract

Rename the launch config concept from runtime control to supervisor control.

Target TS config:

- `supervisorControl.transport.kind = "unix"`
- `supervisorControl.transport.socketPath`

Future transport kinds can stay in schema if desired, but the hard rewrite should only implement Unix first. If non-Unix shapes remain, make them rejected by validation until they are implemented.

Target Rust launch config:

- Replace `runtimeControl` emission with `supervisorControl`.
- The supervisor owns the socket path and starts listening before spawning runtime.
- The launch config passed to runtime contains `supervisorControl`, `runtimePaths`, `launchId`, and `supervisor`.

Security:

- UDS parent directory mode `0700`.
- Socket mode `0600`.
- Request/session fencing validates `launch_id`, `data_dir`, `runtime_pid`, `supervisor_id`, `supervisor_pid`, and `supervisor_generation`.
- Reject sessions from stale launches or mismatched supervisors.

## Rust Gateway Work

### 1. Proto Runtime Crate

Update `apps/cli/crates/proto-runtime`:

- Include new `supervisor.proto` in descriptor generation.
- Enable `connectrpc` server support:
  - `connectrpc = { workspace = true, features = ["client", "server"] }`
- Keep client feature if CLI still uses generated clients internally.
- Regenerate both TS and Rust proto outputs.

### 2. Supervisor Server Module

Add a new Rust module set under `apps/cli/crates/gateway/src/runtime/supervisor_control/`:

- `server.rs`
  - Bind/connectrpc server lifecycle.
  - UDS listener path setup, stale socket cleanup, permissions.
  - Graceful shutdown when supervisor exits.
- `service.rs`
  - Implements generated `SupervisorLifecycleService`.
  - Owns active runtime session registration.
- `actor.rs`
  - Single-threaded async coordinator for session events, CLI RPC commands, and child process monitor events.
  - Owns the in-memory supervisor state used by status/watch.
- `transport.rs`
  - Socket path and authority helpers.
- `errors.rs`
  - Connect errors with `google.rpc.ErrorInfo`, `BadRequest`, `PreconditionFailure`, `ResourceInfo`, `RetryInfo`.

Use `.tmp/connect-rust-repo/conformance/src/bin/server.rs` as the concrete server reference and `.tmp/connect-rust-repo/docs/guide.md` for handler signatures.

### 3. Supervisor State Machine Integration

Keep `supervisor_machine.rs` as the deterministic reducer, but route effects through the supervisor control actor:

- `RuntimeSessionOpened` maps to handshake observed.
- Runtime `ready` event maps to `WatchReady`.
- CLI `Stop` RPC maps to `StopIntentReceived`.
- Accepted stop command is sent on the active runtime session command stream.
- Runtime `shutdown_finished`/session close plus child exit determines expected exit.
- No active session during stop falls back to platform termination if child pid is alive.

Remove direct `RuntimeControlService` client calls from:

- `apps/cli/crates/gateway/src/runtime/control.rs`
- `apps/cli/crates/gateway/src/runtime/supervisor_startup.rs`
- `apps/cli/crates/gateway/src/runtime/supervisor_monitor.rs`
- `apps/cli/crates/gateway/src/runtime/supervisor_effects.rs`
- `apps/cli/crates/gateway/src/runtime/shutdown.rs`

Delete or replace `runtime_control.rs` after all call sites move.

### 4. Startup Flow

Change launch order in `run_supervised_runtime_to_exit`:

1. Allocate supervisor generation and identity.
2. Start supervisor Connect server on `supervisorControl` socket.
3. Write launch config with supervisor endpoint.
4. Spawn runtime process.
5. Wait for runtime session hello and ready event.
6. Mark supervisor ready.
7. Monitor child process and session concurrently.

Startup failure cases:

- Runtime exits before session hello: failed startup.
- Session hello identity mismatch: reject session and fail startup.
- Ready timeout: supervisor failed, terminate child.
- Server bind failure: fail before spawning child.

### 5. CLI Stop/Status/Watch

Replace signal-first stop:

- `gateway stop` discovers active supervisor identity from durable records.
- Connects to supervisor RPC.
- Calls `Stop`.
- Watches supervisor/runtime status until stopped or failed.
- Platform signal becomes fallback only when supervisor RPC is unavailable but supervisor pid is known.

Status:

- Prefer supervisor `GetStatus`.
- Fall back to durable records if supervisor RPC is unavailable.

Watch:

- Prefer supervisor `WatchStatus`.
- Fall back only if necessary for diagnostics.

## TypeScript Runtime Work

### 1. Remove Runtime-Owned Server

Delete the active runtime-control server path:

- `packages/self-host-runtime/src/self-host/runtime-control/server.ts`
- Runtime startup dependency on `serveRuntimeControl`.
- Runtime control socket startup/cleanup.

Keep only reducer/logic that still makes sense, or rename it into lifecycle/session modules.

### 2. Add Supervisor Client

Create `packages/self-host-runtime/src/self-host/supervisor-client/`:

- `client.ts`
  - `createClient(SupervisorLifecycleService, createConnectTransport(...))`
  - UDS HTTP/2 connection through `nodeOptions`.
  - Follow the pattern already used by the current runtime-control socket probe:
    `createConnectTransport({ baseUrl: "http://onequery-supervisor", httpVersion: "2", nodeOptions: { createConnection: () => net.connect(socketPath) } })`
- `session.ts`
  - Maintains `OpenRuntimeSession`.
  - Sends hello, lifecycle transitions, heartbeats, shutdown outcomes.
  - Receives commands and dispatches stop to the shutdown controller.
- `errors.ts`
  - Normalize Connect errors for runtime startup failures.

Use `.tmp/connect-examples-es-repo/vanilla-node/client.ts` for basic client shape and `.tmp/connect-es-repo/packages/connect-node/src/node-transport-options.ts` for custom Node transport options.

### 3. Runtime Lifecycle Integration

In `packages/self-host-runtime/src/index.ts`:

- Load `supervisorControl` instead of `runtimeControl`.
- Acquire runtime lifecycle lease as today.
- Start main HTTP server.
- Attach graceful shutdown handlers.
- Open supervisor session.
- Send `ready` only after app server, storage, shutdown handlers, and session are ready.
- On supervisor stop command:
  - Invoke `GracefulShutdownController.shutdown(...)`.
  - Report `shutdown_started`.
  - Report `shutdown_finished` or `shutdown_failed`.
  - Let normal cleanup release lease and exit if requested.

The runtime should remain the owner of actual application shutdown sequencing because only it can safely close HTTP server, runtime storage, and checkpoint resources.

## Durable Records And Ownership

Keep the existing writer split for the first rewrite:

- Runtime writes runtime lease/status records while it is alive.
- Supervisor writes supervisor status and transition records.
- Supervisor writes terminal runtime status when the child exits unexpectedly or must be killed.

Add explicit rules:

- Runtime events received over session update supervisor in-memory state and may append supervisor transition records.
- Runtime durable status remains source of truth for runtime recovery while process is alive.
- Supervisor terminal records dominate recovery after child exit.
- Never let both runtime and supervisor write the same non-terminal runtime snapshot for the same transition.

If a later pass moves all runtime status writes to the supervisor, define a separate folding contract first.

## Files To Change Or Delete

Proto:

- Add `proto/onequery/runtime/v1/supervisor.proto`.
- Update or delete `proto/onequery/runtime/v1/control.proto`.
- Update `proto/onequery/runtime/v1/common.proto` only for genuinely shared messages.
- Regenerate `packages/proto-runtime/src/**`.

Config:

- `packages/config/src/server-launch.ts`
- `packages/config/src/testing.ts`
- `packages/config/src/server-launch.test.ts`
- Rust launch config in `apps/cli/crates/gateway/src/self_host/launch_config.rs`

Rust gateway:

- Add `apps/cli/crates/gateway/src/runtime/supervisor_control/**`.
- Rewrite `apps/cli/crates/gateway/src/runtime/supervisor.rs`.
- Rewrite `apps/cli/crates/gateway/src/runtime/supervisor_startup.rs`.
- Rewrite `apps/cli/crates/gateway/src/runtime/supervisor_monitor.rs`.
- Rewrite `apps/cli/crates/gateway/src/runtime/supervisor_effects.rs`.
- Rewrite `apps/cli/crates/gateway/src/runtime/shutdown.rs`.
- Delete or replace `apps/cli/crates/gateway/src/runtime/control.rs`.
- Delete or replace `apps/cli/crates/gateway/src/runtime_control.rs`.
- Update tests under `apps/cli/crates/gateway/tests/**`.

TypeScript runtime:

- Add `packages/self-host-runtime/src/self-host/supervisor-client/**`.
- Rewrite `packages/self-host-runtime/src/index.ts`.
- Delete or replace `packages/self-host-runtime/src/self-host/runtime-control/**`.
- Update tests in `packages/self-host-runtime/src/**/*.test.ts`.
- Update fixtures in `apps/cli/crates/gateway/tests/fixtures/**`.

## Implementation Phases

### Phase 1: Contract And Codegen

- [x] Add `supervisor.proto`.
- [x] Update validation constraints.
- [x] Update Rust proto-runtime codegen to include server support.
- [x] Regenerate TS proto runtime package.
- [x] Verify:
  - `bunx buf format -w proto`
  - `bun run proto:lint`
  - `cargo test -p onequery-proto-runtime` from `apps/cli`
  - `bunx turbo typecheck --json --filter @onequery/proto-runtime`

### Phase 2: Rust Supervisor Server Skeleton

- [x] Add supervisor control module skeleton and socket path helper.
- [x] Add supervisor control endpoint config.
- [x] Start/stop Connect server in supervisor process.
- [x] Implement `GetStatus` and `WatchStatus` over an in-memory actor.
- [x] Add tests for socket permissions.
- [x] Add tests for stale socket cleanup.
- [x] Add tests for identity fencing.
- [x] Add tests for watch snapshot/transition delivery.

### Phase 3: Runtime Session Client

- [x] Add TS supervisor client.
- [x] Runtime opens session after server startup.
- [x] Send `hello`, `ready`, heartbeat.
- [x] Supervisor control actor records runtime session ready events.
- [x] Supervisor startup waits for session ready instead of runtime `WatchStatus`.
- [x] Add cross-language test: TS runtime fixture connects to Rust supervisor server and reaches ready.

### Phase 4: Stop Command Path

- [x] Supervisor `Stop` RPC sends command over active session.
- [x] Runtime receives command and invokes shutdown controller.
- [x] Runtime reports shutdown result over session.
- [x] Supervisor manages grace, terminate, kill timers.
- [x] `gateway stop` calls supervisor RPC instead of sending signal first.
- Add tests for:
  - [x] graceful stop.
  - [x] runtime ignores graceful command, supervisor terminates.
  - [x] runtime ignores terminate, supervisor hard-kills.
  - [x] duplicate stop operation id idempotency/conflict.

### Phase 5: Remove Runtime-Owned RuntimeControl

- [x] Delete `serveRuntimeControl` and runtime-control actor/server exports.
- [x] Delete old Rust client.
- [x] Delete old cross-language tests that target runtime-owned server.
- [x] Replace fixtures with supervisor-owned server/session fixtures.
- [x] Ensure generated `RuntimeControlService` references are gone unless intentionally retained in proto history comments.

### Phase 6: Recovery And CLI Polish

- [x] Update durable recovery to prefer live supervisor status, then durable records.
- [x] Update render output labels from `runtimeControlReachable` to supervisor control equivalents.
- [x] Update human-readable errors and retry hints.
- Add recovery tests for:
  - [x] supervisor unavailable but durable runtime record exists.
  - [x] terminal supervisor record suppresses stale runtime lease.
  - [x] mismatched launch/session is rejected and does not corrupt active records.

## Verification Commands

Use project commands from `AGENTS.md`:

- Proto:
  - `buf format -w`
  - `buf lint`
- Whole repo check:
  - `bunx turbo check --json`
  - `bunx turbo typecheck --json`
  - `bunx turbo test --json`
- Targeted JS tests:
  - `bunx vitest run packages/self-host-runtime/src/self-host/...`
- Targeted Rust tests:
  - run from `apps/cli`
  - `cargo test -p onequery-gateway`
  - `cargo test -p onequery-proto-runtime`

Do not use `bun test`.

## Risks

- `connectrpc` built-in Rust server examples are TCP-oriented. If UDS server support is not exposed directly, use the lower-level `ConnectRpcService` with Hyper over `tokio::net::UnixListener`. Use `.tmp/connect-rust-repo/connectrpc/src/server.rs` and `ConnectRpcService` service implementation as reference.
- Node Connect client over UDS needs careful HTTP/2 session options. Validate against `.tmp/connect-es-repo/packages/connect-node/src/node-transport-options.ts` and add a real cross-language test early.
- Bidi session semantics must handle runtime process exit, stream close, and supervisor child monitor events without double-finishing. Keep all decisions funneled through one actor.
- Durable record ownership must stay explicit. Do not let session events make supervisor write normal runtime status snapshots unless the runtime writer is removed in the same phase.
- Windows named pipe support is not part of this hard rewrite. Keep it rejected until there is an implemented and tested transport.

## Definition Of Done

- Runtime no longer opens a lifecycle Connect server.
- Supervisor opens the lifecycle Connect server before spawning runtime.
- Runtime connects to supervisor as a Connect client and maintains a lifecycle session.
- Startup readiness flows through supervisor-owned session state.
- Stop/status/watch flows through supervisor RPC.
- Graceful stop and escalation behavior matches or improves current tests.
- No stale `RuntimeControlService` call sites remain.
- Cross-language tests cover Rust server + TS client over the selected local transport.
