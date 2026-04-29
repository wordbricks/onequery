//! Durable runtime lifecycle recovery.
//!
//! Runtime status snapshots, supervisor terminal snapshots, and runtime leases
//! are the recovery sources of truth. The append-only lifecycle event log is an
//! audit stream: recovery may append corruption observations to it, but it does
//! not fold event entries into runtime identity decisions. If event-log recovery
//! becomes necessary, add an explicit folding contract rather than reusing the
//! audit stream opportunistically.

mod recovery;

pub(crate) use recovery::ManagedRuntimeIdentity;
pub(crate) use recovery::ManagedSupervisorIdentity;
pub(crate) use recovery::read_active_supervisor_identity_for_runtime;
pub(crate) use recovery::read_managed_runtime_identity;
pub(crate) use recovery::read_managed_runtime_pid;
pub(in crate::runtime) use recovery::read_runtime_status_snapshot_for_recovery;
pub(in crate::runtime) use recovery::runtime_phase_label;
