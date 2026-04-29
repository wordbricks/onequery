# Self-Host Runtime IPC Plan

## Decision

Use **Connect RPC between Rust and TypeScript processes**. Use `antiox`
mailboxes, `oneshot`, and deterministic reducers **inside**
`packages/self-host-runtime`.

Actor messages are an ownership/concurrency model, not the wire contract. The
wire contract should be protobuf, observable, versioned, and testable without
reconstructing actor runtime semantics across languages.

## Contract Start Point

- Added `proto/onequery/runtime/v1/common.proto`.
- Added `proto/onequery/runtime/v1/control.proto`.
- Package: `onequery.runtime.v1`.
- Service: `RuntimeControlService`.
- RPCs:
  - `GetStatus`: read current runtime status.
  - `Stop`: request a lifecycle transition to shutdown.
  - `WatchStatus`: server-stream status snapshots/transitions.
- Domain failures are represented as `RuntimeFailure` inside lifecycle state and
  transitions. Connect errors stay for invalid requests, auth/permission,
  cancellation, deadlines, and transport failure.

Current proto contract intentionally models:

- finite `RuntimePhase`
- caller-generated `operation_id` for idempotent stop retries
- explicit `RuntimeTransition`
- optional `RuntimeOperation` on transitions for caller-driven commands
- `RuntimeStopDisposition`
- bounded strings and protovalidate constraints
- runtime-specific Connect error detail anchor

## Transport Direction

Target a private control listener, not the public app API.

Preferred transport:

- Unix: Connect over cleartext HTTP/2 on a Unix domain socket.
- Windows: decide between named pipe support and loopback HTTP/2 with a
  launch-scoped token.

Reference notes:

- `connect-rust` has UDS client support through `Http2Connection::connect_unix`.
- Connect ES/Node serves the private runtime API on a Node `http2` server over a
  Unix socket.
- Keep the protobuf contract unary + server-streaming. Avoid bidi for runtime
  control unless a real interactive protocol appears.

## Hard-Rewrite Shape

- Remove the hand-rolled JSON supervisor socket path instead of staging shims.
- Add a private runtime control endpoint to the self-host launch contract.
- Gateway commands call generated Connect clients for live runtime control.
- Gateway/supervisor still own launch, startup polling, crash detection, stale
  file cleanup, and hard termination fallback.
- Runtime Connect handlers only adapt RPC to actor messages.
- Runtime actor owns lifecycle state; reducers stay pure; effects persist state,
  respond to callers, close resources, and exit.
- Durable files remain recovery truth after crashes or unreachable RPC.

## Checklist

### Completed

- [x] Chose Connect RPC for process boundary and actors for process internals.
- [x] Explored `connect-rust` reference for UDS, codegen, streaming, and server
      limitations.
- [x] Explored Connect ES/Node reference for adapters, HTTP/2, streaming, and
      UDS viability.
- [x] Created private runtime proto package `onequery.runtime.v1`.
- [x] Added `RuntimePhase`, `RuntimeStatus`, `RuntimeTransition`,
      `RuntimeOperation`, `RuntimeFailure`, and stop disposition/completion
      types.
- [x] Added `RuntimeControlService` with `GetStatus`, `Stop`, and
      `WatchStatus`.
- [x] Updated proto package boundary rules and proto README for
      `onequery.runtime.v1`.
- [x] Verified proto formatting, lint, and package boundaries.
- [x] Removed staged rollout/backward-compatibility work from this plan.
- [x] Moved TypeScript protobuf generation into package-scoped outputs:
      `packages/proto-cli/src`, `packages/proto-runtime/src`, and
      `packages/proto-workflow/src`.
- [x] Exported generated contracts from `@onequery/proto-cli`,
      `@onequery/proto-runtime`, and `@onequery/proto-workflow`.
- [x] Removed `@onequery/cli-server` runtime-control proto re-exports and stale
      `packages/cli-server/src/connect/gen` output.
- [x] Repointed CLI server, self-host runtime, and CLI smoke tests to generated
      proto packages.
- [x] Added `runtimeControl` endpoint to the launch config contract, Rust launch
      writer, and TypeScript lifecycle path model.
- [x] Implemented `RuntimeControlActor` in `packages/self-host-runtime` using
      `antiox` `mpsc` + `oneshot`.
- [x] Wired runtime Connect service registration and handlers.
- [x] Started a private Connect HTTP/2 listener on the runtime Unix socket
      during managed self-host startup.
- [x] Routed `Stop` through actor-backed graceful shutdown with
      `RUNTIME_STOP_COMPLETION_CLEANUP_AND_EXIT`.
- [x] Routed `GetStatus` and `WatchStatus` from actor lifecycle state.
- [x] Added actor tests for duplicate stop requests and status streaming.
- [x] Added a local compatibility test for Node HTTP/2 Connect over Unix socket.
- [x] Proved Rust `Http2Connection::connect_unix` against the Node runtime
      control listener.
- [x] Added Rust gateway codegen for `onequery.runtime.v1`.
- [x] Replace gateway stop/status live paths with generated Connect calls.
- [x] Delete the old tagged JSON supervisor IPC.
- [x] Keep signal/hard-kill fallback for unreachable runtime control RPC.
- [x] Unit test runtime reducer shutdown failure transitions.

### Next

- [ ] Integration test graceful stop, stop during startup, unreachable runtime
      fallback, runtime crash recovery, and stale lock/pid cleanup.

## Open Decisions

- Windows private transport: named pipe versus loopback HTTP/2 + token.
- Exact gateway `CliError` mapping for runtime Connect errors and
  `RuntimeFailure` states.
