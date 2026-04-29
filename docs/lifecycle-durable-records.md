# Lifecycle Durable Records

The private self-host lifecycle contract uses generated
`onequery.runtime.v1` protobuf messages as the only durable record schema shared
by the Rust gateway and TypeScript runtime.

## Encoding

Inspectable state files use UTF-8 protobuf JSON:

- `run/runtime.lease.json` stores a `RuntimeLeaseRecord`
- `run/runtime.status.json` stores a `RuntimeStatusSnapshot`
- `run/supervisor.status.json` stores a `SupervisorStatusSnapshot`

These files are complete-record snapshots. Writers replace the whole file
atomically and terminate the JSON document with one newline. Readers must parse
them through generated protobuf types, not handwritten JSON structs.

Append-only lifecycle event logs use length-delimited binary protobuf frames of
`LifecycleEventLogEntry`. Each frame is a protobuf varint byte length followed
by the canonical binary protobuf payload for that entry. This keeps evidence
logs compact and unambiguous while allowing state snapshots to remain directly
inspectable.

`logs/server.log` remains an operator-facing text log. It is not the durable
lifecycle event log and must not be treated as lifecycle truth.

## Recovery Precedence

Crash recovery resolves durable lifecycle evidence in one fixed order:

1. lifecycle event log
2. runtime status snapshot
3. supervisor terminal record
4. runtime lease record
5. process liveness check

The lifecycle event log is the highest-precedence source once the binary log
reader exists. Until then, readers have no event-log evidence and continue to
the snapshot steps below.

Runtime status snapshots are the first decisive state-file source. A
non-terminal runtime status snapshot (`starting`, `ready`, `draining`,
`checkpointing`, or `stopping`) can nominate an active runtime pid when its
launch identity matches the requested data directory. A terminal runtime status
snapshot (`stopped`, `shutdown_failed`, or `failed`) resolves recovery as no
active runtime for that launch.

Supervisor status snapshots are only decisive when they are terminal
(`exited` or `failed`) and their launch identity matches the requested data
directory. A matching supervisor terminal record resolves recovery as no active
runtime and lower-precedence lease evidence cannot resurrect that runtime.

Runtime lease records are the lowest-precedence durable source. A matching
lease may nominate an active runtime pid only when no higher-precedence durable
source made a decision.

Process liveness checks are the final validation step for any nominated active
runtime pid. Liveness can confirm the selected active candidate or reject it as
stale; it does not override a higher-precedence terminal decision and does not
fall through to lower-precedence durable records after a higher source has made
a decision.

## Sequence Domains

Lifecycle ordering uses explicit sequence domains:

- `runtime_sequence` is owned by the TypeScript runtime-control actor and
  increments once for each runtime phase transition in a launch.
- `supervisor_sequence` is owned by the Rust supervisor and increments once for
  each supervisor phase transition in a supervisor generation.
- `lifecycle_sequence` is owned by the append-only lifecycle event log writer
  and records event-log append order. Event log entries may also copy the
  relevant runtime or supervisor sequence for correlation, but those copied
  values do not define event-log order.

## Codec Modules

All durable lifecycle encoding and decoding belongs in one module per language:

- Rust gateway: `apps/cli/crates/gateway/src/runtime/lifecycle_records.rs`
- TypeScript runtime:
  `packages/self-host-runtime/src/self-host/lifecycle/records.ts`

Other code may decide when to read, write, replace, or append files, but it
should call these modules for protobuf JSON or binary protobuf conversion.

## Compatibility Rule

The current durable lifecycle schema version is `1`. Changing file names,
state-file encoding, event-log framing, or the protobuf message associated with
a durable file is a durable schema change and must either increment the schema
version or define an explicit recovery/migration path before readers accept the
new format.
