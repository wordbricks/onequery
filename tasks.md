# Lifecycle Supervisor Hard Rewrite

Goal: Rust supervisor is the SSoT for OS process lifecycle. The TypeScript runtime-control actor is the SSoT for in-process runtime lifecycle. Connect RPC is the live control plane. Durable files are recovery snapshots and event evidence, not competing authorities.

Hard rewrite constraints:

- No backward-compatibility layer. Delete legacy JSON/pid/stop artifacts when the new SSoT records replace them.
- No duplicate lifecycle authority. A file may be a recovery snapshot, event evidence, or derived cache, but not an independent source of truth.
- State transitions define truth. Reducers are pure. Effects are emitted and executed outside reducers.
- Failure, timeout, retry, escalation, crash recovery, and stale identity are normal lifecycle transitions, not exceptions.

Comments:

- `WatchStatus` already exists in the proto and TypeScript actor, but the Rust gateway still relies on JSON state polling plus TCP probing for startup/shutdown readiness.
- `StopRequest.grace_timeout` is accepted by the proto contract, but the TypeScript shutdown path does not enforce it yet.
- `RuntimeOperation.operation_id` currently requires UUID in proto, but TypeScript emits internal lifecycle operation ids such as `lifecycle:...`. Split caller operations from internal transition identity instead of weakening validation.

## Tasks

### Contract and Durable SSoT

- [x] Add proto-backed durable lifecycle records for runtime lease, runtime status snapshot, supervisor status snapshot, and lifecycle event log entries. Use the same generated `onequery.runtime.v1` types from Rust and TypeScript instead of hand-maintained JSON structs.
- [x] Delete the legacy hand-written JSON record structs and legacy lifecycle files after replacement: `server.state.json`, lock JSON, pid-only markers, `server.stop`, and supervisor JSON state. Reintroduce any path only if it is explicitly documented as a derived cache.
- [x] Decide and document durable encoding: proto JSON for inspectable state files, binary protobuf for append-only event logs if size matters. Keep one encoder/decoder module per language.
- [x] Define durable recovery precedence: lifecycle event log, runtime status snapshot, supervisor terminal record, lease record, and process liveness checks. Recovery must have one deterministic conflict-resolution path.
- [x] Add schema version, writer identity, launch id, data dir, runtime pid, supervisor pid, and supervisor generation to durable records so crash recovery can distinguish runtime-owned snapshots from supervisor-owned terminal records.
- [x] Define sequence domains explicitly: either one global lifecycle sequence per launch or separate `runtime_sequence` and `supervisor_sequence`. Avoid two unrelated counters named `sequence`.
- [x] Add a `RuntimeTarget` or equivalent fencing field to control requests: expected `launch_id`, `data_dir`, and optionally `pid`/`supervisor_pid`/`supervisor_generation`. Reject stale or mismatched requests with `FailedPrecondition`.
- [x] Split caller operation identity from internal transition identity. Keep `operation_id` for caller-generated UUID idempotency keys; use a separate `transition_id`, `correlation_id`, or omitted operation for internal lifecycle/release transitions.
- [x] Make `operation_id` truly idempotent for `Stop`: the caller must reuse the same operation id across retries, and the actor must store recent operation outcomes so retrying the same request returns the same disposition/status/transition.
- [x] Reject operation-id reuse with different target, reason, completion, or grace timeout using `InvalidArgument` or `FailedPrecondition`.

### Connect Control Plane

- [x] Move Rust startup readiness to `RuntimeControlService.WatchStatus(include_snapshot=true)` once the control socket is reachable. Treat `READY` from the stream as the primary signal; keep file/TCP probing only as pre-handshake and crash-recovery fallback.
- [x] Move Rust stop waiting to `Stop` followed by `WatchStatus(after_sequence=stop.status.sequence)`, waiting for `STOPPED`, `SHUTDOWN_FAILED`, or child exit.
- [x] Route `gateway stop` through the supervisor-owned lifecycle path. The CLI command may submit stop intent, but it must not directly own graceful RPC stop, SIGTERM/platform terminate, hard kill, or terminal event writing.
- [x] Use generated Rust client methods for `WatchStatus` server streaming and per-call `CallOptions` for timeout, max message size, and request headers.
- [x] Add request/operation headers through `ClientConfig::default_header` or `CallOptions::with_header`: request id, supervisor id, launch id, CLI version.
- [x] Map TypeScript domain failures to `ConnectError` with precise codes and details: `ErrorInfo`, `BadRequest`, `RetryInfo`, `ResourceInfo`, and `PreconditionFailure`.
- [x] Add Rust decoding for runtime-control Connect error details so CLI output can explain stale launch, validation failure, retryable startup, and shutdown timeout without string matching.
- [x] Keep the private server Connect-only with validation, bounded message sizes, bounded timeout, and required Connect protocol header.

### Supervisor State Machine

- [ ] Implement the Rust supervisor as an explicit reducer/effect state machine with finite states: `starting`, `handshaking`, `ready`, `stop_requested`, `terminating`, `escalating`, `exited`, `failed`.
- [ ] Document the formal transition table before implementation: state, event, guard, next state, emitted effects, durable event payload, and rejected-transition behavior.
- [ ] Model these supervisor events explicitly: `launch_requested`, `child_spawned`, `control_socket_observed`, `watch_ready`, `stop_intent_received`, `stop_rpc_accepted`, `stop_rpc_failed`, `grace_deadline_elapsed`, `terminate_deadline_elapsed`, `child_exited`, `startup_deadline_elapsed`, `restart_scheduled`, and `artifact_recovery_completed`.
- [ ] Handle `child_exited` from every non-terminal supervisor state. Unexpected child exit must produce a terminal runtime status/event with exit code, signal, phase, retryability, and launch identity.
- [ ] Keep process effects outside the reducer: spawn, Connect dial, stream watch, signal, kill, file writes, log writes, sleep/backoff timers, and event-log appends.
- [ ] Feed all Rust supervisor transitions into the durable lifecycle event log with sequence, monotonic timestamp, wall timestamp, operation id/correlation id, launch identity, supervisor generation, and exit status/signal when present.
- [ ] Make foreground and background launch use the same supervisor lifecycle handshake path, with only stdio/logging differences.
- [ ] Add crash-loop policy as explicit config: disabled by default or bounded restart count with exponential backoff and a terminal `failed` phase.

### Runtime State Machine

- [ ] Ensure runtime-control actor, shutdown coordinator, and lease persistence share one transition path so each runtime phase change increments exactly one runtime sequence.
- [ ] Keep watcher registry out of durable lifecycle state. Watchers are subscription state, not lifecycle truth.
- [ ] Make TypeScript shutdown enforce `grace_timeout` with a reducer event such as `shutdown_timeout_elapsed`: transition to `shutdown_failed` with `SHUTDOWN_TIMEOUT`, then let Rust supervisor escalate process termination.
- [ ] Pass stop target, operation id, completion, reason, and grace timeout through the actor and shutdown coordinator instead of reading partial request state in effects.
- [ ] Preserve runtime failure detail in state transitions: `SHUTDOWN_REJECTED`, `SHUTDOWN_TIMEOUT`, `RESOURCE_CLOSE_FAILED`, `CHECKPOINT_FAILED`, and `INTERNAL`.
- [ ] Avoid storing derivable booleans or duplicate mode in runtime context. UI/CLI output should derive from phase, tags/status helpers, and transition payloads.

### Process Robustness

- [ ] Add two-stage termination owned by the supervisor: RPC graceful stop, then SIGTERM/platform terminate, then SIGKILL or platform hard-kill after an explicit deadline.
- [ ] Write terminal runtime status/event when the child exits unexpectedly, including exit code, signal, retryability, launch id, data dir, runtime pid, supervisor pid, and supervisor generation.
- [ ] Harden stale artifact handling against PID reuse by requiring launch id, data dir, process liveness, runtime pid, supervisor pid, and supervisor generation to match before trusting files or removing sockets.
- [ ] Remove stale sockets only after identity checks prove they belong to the current launch generation or are unreachable artifacts.
- [ ] Treat corrupt durable snapshots as recovery events. Do not silently ignore corruption except in explicitly bounded pre-handshake retry windows.

### Transport and Security

- [ ] Generalize `runtime_control.transport` beyond Unix sockets: Unix UDS now, Windows named pipe or loopback h2c with a random per-launch bearer token later.
- [ ] Use connect-rust custom connectors for non-TCP transports instead of inventing a parallel RPC transport.
- [ ] Verify runtime control socket/pipe parent directories are private, remove stale sockets only after identity checks, and keep socket mode `0600`.
- [ ] Add graceful close behavior for active `WatchStatus` streams so shutdown does not leak sessions or leave clients hanging indefinitely.
- [ ] Require launch-scoped auth/fencing metadata for any non-UDS transport before enabling it.

### Deletion Checklist

- [x] Delete Rust serde structs for legacy runtime lock/state and supervisor state once proto records land.
- [x] Delete TypeScript zod schemas/interfaces for legacy lock/state records once proto records land.
- [x] Delete pid-only and stop-request control paths once supervisor-owned lifecycle events replace them.
- [ ] Delete TCP readiness as a primary startup signal. Keep it only as an explicitly documented fallback if needed for crash recovery or pre-handshake diagnostics.
- [ ] Delete phase enums that duplicate generated `RuntimePhase` unless they are narrow internal reducer states with documented mapping.

### Tests

- [ ] Add Rust reducer tests for the supervisor transition table covering every allowed transition and every rejected transition.
- [ ] Add TypeScript runtime-control reducer tests for stop idempotency, operation-id conflict rejection, shutdown timeout, lifecycle failure details, and watcher non-durability.
- [ ] Add Rust integration coverage using the generated runtime-control client for `GetStatus`, `Stop`, and `WatchStatus` over the Node UDS fixture.
- [ ] Add cross-language tests for stale launch fencing, duplicate `operation_id`, operation-id conflict, timeout overflow, validation failures, and typed error details.
- [ ] Add crash-recovery tests: child exits before control socket, exits after `READY`, corrupt durable snapshot, stale lock with live unrelated PID, stale socket, and mismatched supervisor generation.
- [ ] Add stop escalation tests with a fixture runtime that ignores graceful stop, ignores SIGTERM/platform terminate, and exits during each supervisor state.
- [ ] Add foreground/background parity tests proving both launch modes use the same lifecycle handshake and differ only in stdio/logging behavior.

## Connect References Consulted

- `.tmp/connect-rust-repo/connectrpc/src/client/http2.rs`: `Http2Connection::connect_unix`, `lazy_with_connector`, reconnect behavior, and `SharedHttp2Connection`.
- `.tmp/connect-rust-repo/connectrpc/src/client/mod.rs`: `ClientConfig`, `CallOptions`, server-streaming `ServerStream::message`, deadlines, headers, and max message sizes.
- `.tmp/connect-rust-repo/examples/streaming-tour`: unary, server-streaming, client-streaming, and bidi streaming patterns on the Rust side.
- `.tmp/connect-rust-repo/conformance/src/generated/connect/connectrpc.conformance.v1.service.rs`: generated client shape for `*_with_options` and server-streaming calls.
- `.tmp/connect-es-repo/packages/connect-node/src/connect-node-adapter.ts`: Node adapter route registration, fallback handling, interceptors, and Connect router options.
- `.tmp/connect-es-repo/packages/connect-node/src/node-universal-handler.ts`: Node HTTP/2 request conversion, abort handling, and response/trailer behavior.
- `.tmp/connect-es-repo/packages/connect/src/connect-error.ts`: `ConnectError` codes, metadata, and typed protobuf error details.
- `.tmp/connect-es-repo/packages/connect/src/interceptor.ts`: server/client interceptor layering for headers, logs, tracing, and stream wrapping.
- `.tmp/connect-es-repo/packages/connect/src/call-options.ts`: TypeScript call timeout, headers, abort signal, and trailer/header callbacks.
- `.tmp/connect-examples-es-repo/vanilla-node`: Node server/client examples with `connectNodeAdapter`, `createConnectTransport`, server streaming, and logging interceptors.
- `.tmp/connect-buffa-repo/README.md` and `DESIGN.md`: Buffa generated Rust message API and proto JSON support for using generated proto types as durable SSoT records.
- `.tmp/connect-protovalidate-repo/README.md`: production validation pattern for annotated protobuf contracts.
