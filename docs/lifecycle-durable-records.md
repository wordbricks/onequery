# Lifecycle Durable Records

The private self-host lifecycle contract uses generated
`onequery.runtime.v1` protobuf messages as the only durable record schema shared
by the Rust gateway and TypeScript runtime.

## Encoding

Inspectable state files use UTF-8 protobuf JSON:

- `run/runtime.lease.json` stores a `RuntimeLeaseRecord`
- `run/runtime.status.json` stores a `RuntimeStatusSnapshot`
- `run/supervisor.status.json` stores a `SupervisorStatusSnapshot`
- `run/lifecycle.events.pb` stores length-delimited `LifecycleEventLogEntry`
  frames

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

1. supervisor terminal record
2. runtime status snapshot
3. runtime lease record
4. process liveness check

The lifecycle event log is diagnostic evidence today. Recovery records corrupt
durable artifacts there, but the binary log is not folded into startup recovery
decisions yet.

Supervisor status snapshots are decisive only when they are terminal
(`exited` or `failed`) and their launch identity matches the requested data
directory. A matching supervisor terminal record resolves recovery as no active
runtime and lower-precedence runtime or lease evidence cannot resurrect that
runtime.

Runtime status snapshots are the next decisive state-file source. A
non-terminal runtime status snapshot (`starting`, `ready`, `draining`,
`checkpointing`, or `stopping`) can nominate an active runtime pid when its
launch identity matches the requested data directory. A terminal runtime status
snapshot (`stopped`, `shutdown_failed`, or `failed`) resolves recovery as no
active runtime for that launch.

Runtime lease records are the lowest-precedence durable source. A matching
lease may nominate an active runtime pid only when no higher-precedence durable
source made a decision.

Process liveness checks are the final validation step for any nominated active
runtime pid. Liveness can confirm the selected active candidate or reject it as
stale; it does not override a higher-precedence terminal decision and does not
fall through to lower-precedence durable records after a higher source has made
a decision.

Malformed non-empty durable artifacts are recovery errors after the corruption
event is recorded. Only missing files or valid but non-decisive records can fall
through to lower-precedence evidence.

## Sequence Domains

Lifecycle ordering uses explicit sequence domains:

- `runtime_sequence` is owned by the TypeScript supervisor runtime session and
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
