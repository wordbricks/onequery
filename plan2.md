# Supervisor Lifecycle Hardening Plan

## Goal

Bring the supervisor-owned lifecycle rewrite from a working phase implementation to a rigorous final design.

This pass fixes the remaining architectural gaps:

- One source of truth for supervisor lifecycle state.
- Complete runtime session event folding.
- Identity fencing for every runtime-originated event, not only `hello`.
- Correct `GetStatus` and `WatchStatus` behavior from the same state stream.
- Clear responsibility boundaries between runtime, supervisor actor, deterministic reducer, and durable writers.
- Removal of stale runtime-control naming where it now describes supervisor control.

The target is not more protocol surface. The target is fewer state owners, fewer implicit states, and fewer ways for durable state, in-memory RPC state, and runtime session state to diverge.

## Non-Goals

- Do not move all runtime durable status writing to the supervisor in this pass.
- Do not add Windows named pipe support.
- Do not preserve compatibility with the deleted runtime-owned `RuntimeControlService`.
- Do not introduce a second reducer for the same supervisor state transitions.

## Current Gaps To Fix

### 1. Runtime Session Events Are Not Fully Consumed

`OpenRuntimeSession` currently validates the initial `hello`, then only handles:

- `runtime_ready`
- `runtime_transition`

The supervisor currently drops:

- `heartbeat`
- `shutdown_started`
- `shutdown_finished`
- `shutdown_failed`
- `runtime_exiting`

This makes the protocol look richer than the implementation and prevents stop/status/watch from being fully session-driven.

### 2. Session Identity Is Only Fenced At Hello

The `hello` event is fenced against active launch identity, but later runtime events can carry mismatched runtime identity or status without being rejected.

Every runtime-originated event that contains identity-bearing state must be checked against the accepted session:

- `launch_id`
- `data_dir`
- `runtime_pid`
- `supervisor_id`
- `supervisor_pid`
- `supervisor_generation`

### 3. Supervisor State Has Multiple Writers

Current in-memory RPC status is updated by ad hoc `replace_status(...)` calls and by session handlers. Durable status is updated by `supervisor_machine` effects. These can diverge.

The deterministic reducer should remain the canonical transition policy. The supervisor control actor should own the live state and event publication, but it must receive reducer outputs rather than independent handcrafted status mutations.

### 4. WatchStatus Does Not Publish Supervisor Transitions

`WatchStatus` can emit initial snapshots and runtime transitions, but normal supervisor transitions are not wired into the actor event stream. Session close updates `active_session` without sequence/timestamp/event publication.

### 5. Connect Server Limits Are Asymmetric

The TS client caps read/write size, but the Rust `ConnectRpcService` server does not apply matching `Limits`, despite the `.tmp/connect-rust-repo/conformance/src/bin/server.rs` reference using `.with_limits(...)`.

### 6. Stale Runtime-Control Names Remain

Some names/comments still refer to `runtime-control` even when the concept is now supervisor control. Some compatibility leftovers may be harmless, but unexplained stale names make ownership harder to audit.

## Target Architecture

### Responsibility Boundaries

#### Runtime

The runtime owns application shutdown sequencing:

- HTTP server drain.
- Storage/checkpoint close.
- Runtime lease/status writes while process is alive.
- Graceful shutdown handlers.
- Sending lifecycle session events to supervisor.

The runtime must not decide supervisor phase.

#### Supervisor Machine

`supervisor_machine.rs` remains the deterministic transition reducer.

It owns:

- Valid transition rules.
- Supervisor phase changes.
- Supervisor effects to perform.
- Stop escalation policy.
- Terminal supervisor/runtime status decisions after child exit.

It must not perform IO directly.

#### Supervisor Control Actor

The actor owns live observable control-plane state:

- Active runtime session identity.
- Active command stream.
- Current `SupervisorStatus`.
- Watch subscribers.
- Pending stop RPC requests.
- Runtime session event ingestion.

The actor should not invent supervisor phase transitions independently. It should publish state transitions from reducer outputs or from explicit session-derived events that are folded through reducer-compatible paths.

#### Supervisor Effects

Effects own side effects:

- Durable supervisor status snapshot writes.
- Durable terminal runtime snapshot writes.
- Runtime stop command delivery.
- Runtime terminate/kill signals.
- Timer scheduling.
- Publishing accepted reducer transitions into the actor.

This is the intended bridge between the reducer and live RPC state.

#### CLI Stop/Status/Watch

CLI commands should prefer supervisor RPC:

- `Stop` sends supervisor RPC.
- `Status` calls `GetStatus`.
- `Watch` calls `WatchStatus`.

Durable records remain fallback/diagnostic sources, not the primary live path.

## Implementation Phases

### Phase 1: Define The Live-State Update Contract

Status: Done for runtime-session live-state ingestion. Reducer-output publication and remaining `replace_status(...)` cleanup are tracked in Phase 4.

- Add a small live-state update API on `SupervisorControlActor`.
- Replace broad `replace_status(...)` usage with explicit methods:
  - `apply_supervisor_transition(...)`
  - `apply_runtime_ready(...)`
  - `apply_runtime_shutdown_started(...)`
  - `apply_runtime_shutdown_finished(...)`
  - `apply_runtime_shutdown_failed(...)`
  - `apply_runtime_exiting(...)`
  - `apply_session_closed(...)`
- Each method must either:
  - receive reducer output and publish it, or
  - produce a runtime-scoped status update that does not conflict with supervisor phase ownership.
- Every live-state mutation must update:
  - `updated_at`
  - sequence where appropriate
  - watch event publication where appropriate
- Remove direct status field mutation from service handlers.

Verification:

- Add actor tests proving every update method changes exactly the intended fields.
- Add a regression test proving `WatchStatus(include_snapshot = true)` reports the same status as `GetStatus`.

### Phase 2: Fold All Session Events

Status: Done.

Implement explicit handling for every `OpenRuntimeSessionRequest.payload` variant:

- `hello`
  - Must be first.
  - Must establish accepted session identity.
  - A second `hello` on the same stream should be rejected or ignored with a documented rule.
- `heartbeat`
  - Validate session.
  - Update last-seen metadata if represented.
  - Do not bump supervisor phase by itself.
- `runtime_transition`
  - Validate identity if transition includes runtime/supervisor identity.
  - Publish to watchers.
  - Do not write normal runtime durable snapshots from supervisor.
- `runtime_ready`
  - Validate status identity.
  - Mark active session ready.
  - Wake startup waiter.
- `shutdown_started`
  - Validate operation identity.
  - Update live runtime phase to draining/stopping if this is represented in `SupervisorStatus`.
  - Publish runtime transition/watch event.
- `shutdown_finished`
  - Validate final status identity.
  - Update live runtime phase to stopped.
  - Complete matching pending stop operation if the stream result is needed by the RPC layer.
- `shutdown_failed`
  - Validate failure/status identity.
  - Update live runtime phase/failure.
  - Complete matching pending stop operation as failed if applicable.
- `runtime_exiting`
  - Record exit intent/metadata for child-exit reconciliation.
  - Do not mark terminal supervisor state until child monitor observes actual process exit.

Verification:

- Unit tests for every session event variant.
- Test that shutdown events sent by the TS runtime fixture are visible through `GetStatus`.
- Test that ignored/unrecognized ordering cannot silently mark ready or stopped.

### Phase 3: Enforce Session Identity Fencing Everywhere

Status: Done for all status-bearing runtime events. `runtime_transition`, `shutdown_started`, and `runtime_exiting` are fenced by accepted stream ownership because those proto messages do not carry runtime/supervisor identity fields.

Introduce a stored `RuntimeSessionIdentity` inside the actor after accepted `hello`.

It should contain:

- `launch_id`
- `data_dir`
- `runtime_pid`
- `runtime_sequence_at_hello`
- `supervisor_id`
- `supervisor_pid`
- `supervisor_generation`

All subsequent event handlers must validate against this stored session identity, not only against the current mutable `SupervisorStatus`.

Rules:

- A new session may replace the active session only if no active session exists, or if the previous session is closed and belongs to the same launch/runtime identity.
- A mismatched event returns `FAILED_PRECONDITION`.
- A mismatched event must not mutate live state, durable state, or watcher streams.
- Session close must only clear the active sink if the closing stream owns the current `session_id`.

Verification:

- Tests for mismatched `runtime_ready`, `shutdown_finished`, and `runtime_transition`.
- Test that stale session close cannot clear a newer active session.
- Test that a rejected session does not corrupt `GetStatus`.

### Phase 4: Make Reducer Output Publish Live State

Status: Done.

After `reduce_supervisor_machine(...)`, publish the accepted supervisor transition to the actor as part of effect execution.

Suggested shape:

```rust
pub(super) struct SupervisorAppliedTransition {
    pub(super) transition: types::SupervisorTransition,
    pub(super) status: types::SupervisorStatus,
}
```

`dispatch_supervisor_event(...)` should:

1. Reduce the event.
2. Append durable transition event log entry.
3. Execute durable/effect operations.
4. Publish the same accepted transition/status to `SupervisorControlActor`.

Avoid manual status reconstruction outside this path except for initial bootstrapping before the machine has accepted `LaunchRequested`.

Verification:

- Remove most call sites of `replace_status(...)`.
- Add test that a reducer transition appears in `WatchStatus`.
- Add test that `GetStatus` reflects the latest reducer transition after durable snapshot write succeeds.

### Phase 5: Stop RPC Completion Semantics

Clarify what `Stop` RPC means:

- `ACCEPTED`: command accepted and sent, runtime may still be stopping.
- `ALREADY_STOPPING`: same or compatible stop already in progress.
- Failure: command could not be accepted or delivered.

Do not block `Stop` until shutdown finishes unless that is deliberately part of the contract. If shutdown completion is asynchronous, then `WatchStatus`/`GetStatus` must be the completion observation path.

Implementation rules:

- `request_stop(...)` should register idempotency and enqueue a stop request.
- The monitor should complete the RPC once command delivery policy is decided.
- `shutdown_finished` and `shutdown_failed` should update live state and watchers, not retroactively decide command acceptance.

Verification:

- Duplicate same operation id returns `ALREADY_STOPPING`.
- Duplicate operation id with different parameters returns `FAILED_PRECONDITION`.
- Stop with no active session falls back to terminate policy and returns the documented disposition/error.
- Stop accepted is visible in `WatchStatus`.

### Phase 6: WatchStatus Correctness

`WatchStatus` should be a coherent stream from the actor state.

Rules:

- `include_snapshot = true` always emits current status first.
- `after_supervisor_sequence` filters supervisor transitions only.
- Runtime transitions are emitted only if they happen after subscription, unless represented in the initial snapshot.
- Supervisor transitions must be emitted for normal reducer transitions.
- Session close must emit either:
  - a supervisor transition, if it changes supervisor phase, or
  - a snapshot/runtime event if it only changes `active_session`.

Verification:

- Snapshot equals `GetStatus`.
- Supervisor transition sequence filtering works.
- Runtime transition delivery works without bypassing supervisor transition filtering.
- Closing the session is observable if it changes `active_session`.

### Phase 7: Align Connect Limits With References

Status: Done.

Use the `.tmp/connect-rust-repo/conformance/src/bin/server.rs` reference pattern:

- Import/use `connectrpc::Limits`.
- Wrap server service with `.with_limits(...)`.
- Match the TS client limit unless there is a documented reason not to.

Target:

- Rust server max message size: `64 * 1024`.
- TS client read/write max bytes: already `64 * 1024`.
- Add a test for oversized request rejection if practical.

### Phase 8: Naming Cleanup

Status: Done for stale runtime-control socket/config references in the supervisor lifecycle path. Legacy status JSON assertions and runtime-control rejection/detail tests were removed.

Rename stale runtime-control names that now refer to supervisor control.

Candidates:

- `RuntimeControlEndpoint` in TS lifecycle types.
- Comments saying runtime-control owns runtime sequence or terminal states.
- Test fixture JSON that still contains `runtimeControl` unless intentionally testing legacy rejection.
- Rust helper names/constants that only remain for deleted control sockets.

Rules:

- Do not rename generated proto package/module paths unless necessary.
- Keep `control_error.rs` naming only if it truly remains shared generic Connect error parsing; otherwise rename to `supervisor_control_error.rs`.
- If a legacy path remains for cleanup/recovery, add a comment explaining why it still exists.

Verification:

- `rg -n "runtimeControl|runtime-control|RuntimeControl|runtime_control" apps packages proto`
- Every remaining hit should be either generated history, intentional fallback cleanup, or a clearly named generic module.

## Tests To Add Or Update

Rust:

- `SupervisorControlActor` session event tests.
- `SupervisorControlService` bidi stream tests for all payload variants.
- `WatchStatus` reducer transition publication tests.
- Identity mismatch rejection tests.
- Stale session close test.
- Connect server max message size test if feasible.

TypeScript:

- Runtime supervisor session sends `shutdown_started`.
- Runtime supervisor session sends `shutdown_finished`.
- Runtime supervisor session sends `shutdown_failed`.
- Runtime stop command updates local lifecycle before reporting final status.
- Client UDS transport remains covered by real local server test.

Cross-language:

- TS runtime fixture connects to Rust supervisor server.
- Runtime reaches ready through session.
- Supervisor stop command reaches runtime.
- Runtime shutdown result becomes visible through supervisor `GetStatus`.
- `WatchStatus` observes stop-related transitions.

## Verification Commands

Use project commands from `AGENTS.md`.

Targeted first:

```sh
cargo test -p onequery-gateway
cargo test -p onequery-proto-runtime
bunx vitest run packages/self-host-runtime/src/self-host/supervisor-client
bunx vitest run packages/self-host-runtime/src/index.test.ts packages/self-host-runtime/src/self-host/lifecycle.test.ts
```

Then whole repo:

```sh
bun lint --format json
bunx turbo typecheck --json
bunx turbo test --json
bunx turbo check --json
```

Do not use `bun test`.

## Definition Of Done

- `OpenRuntimeSession` has explicit behavior for every event variant.
- Every runtime session event is fenced against accepted session identity.
- `SupervisorControlActor` is the live-state owner, and reducer/effect outputs publish through it.
- Manual `replace_status(...)` calls are gone or limited to documented initialization only.
- `GetStatus` and `WatchStatus` are sourced from the same actor state.
- Supervisor transitions are visible through `WatchStatus`.
- Runtime shutdown outcomes are visible through supervisor status/watch.
- Rust Connect server applies explicit message limits.
- Stale runtime-control names are removed or justified.
- No redundant lifecycle state owner remains for supervisor phase.
