//! Durable lifecycle record encoding for the Rust gateway.
//!
//! State and snapshot files are newline-terminated protobuf JSON so operators
//! can inspect recovery state without custom tooling. Append-only lifecycle
//! event logs use length-delimited binary protobuf frames.

use std::sync::OnceLock;
use std::sync::atomic::AtomicU64;
use std::sync::atomic::Ordering;
use std::time::Instant;

use buffa::Message;
use serde::Serialize;
use serde::de::DeserializeOwned;

use crate::supervisor_control_proto::types;

pub(super) const DURABLE_STATE_FILE_ENCODING: types::LifecycleRecordEncoding =
    types::LifecycleRecordEncoding::LIFECYCLE_RECORD_ENCODING_PROTO_JSON;
#[allow(dead_code)]
pub(super) const DURABLE_EVENT_LOG_ENCODING: types::LifecycleRecordEncoding =
    types::LifecycleRecordEncoding::LIFECYCLE_RECORD_ENCODING_LENGTH_DELIMITED_BINARY_PROTOBUF;
pub(super) const LIFECYCLE_SCHEMA_VERSION: u32 =
    types::LifecycleRecordSchemaVersion::LIFECYCLE_RECORD_SCHEMA_VERSION_V1 as u32;
static MONOTONIC_TIMESTAMP_START: OnceLock<Instant> = OnceLock::new();
static LAST_MONOTONIC_TIMESTAMP_NANOS: AtomicU64 = AtomicU64::new(0);

pub(super) const fn durable_lifecycle_record_encoding_label(
    encoding: types::LifecycleRecordEncoding,
) -> &'static str {
    match encoding {
        types::LifecycleRecordEncoding::LIFECYCLE_RECORD_ENCODING_PROTO_JSON => "proto-json",
        types::LifecycleRecordEncoding::LIFECYCLE_RECORD_ENCODING_LENGTH_DELIMITED_BINARY_PROTOBUF => {
            "length-delimited-binary-protobuf"
        }
        types::LifecycleRecordEncoding::LIFECYCLE_RECORD_ENCODING_UNSPECIFIED => "unspecified",
    }
}

pub(super) fn decode_runtime_lease_record(
    contents: &str,
) -> Result<types::RuntimeLeaseRecord, serde_json::Error> {
    decode_proto_json(contents)
}

pub(super) fn decode_runtime_status_snapshot(
    contents: &str,
) -> Result<types::RuntimeStatusSnapshot, serde_json::Error> {
    decode_proto_json(contents)
}

pub(super) fn decode_supervisor_status_snapshot(
    contents: &str,
) -> Result<types::SupervisorStatusSnapshot, serde_json::Error> {
    decode_proto_json(contents)
}

pub(super) fn encode_supervisor_status_snapshot(
    snapshot: &types::SupervisorStatusSnapshot,
) -> Result<String, serde_json::Error> {
    encode_proto_json(snapshot)
}

pub(super) fn encode_runtime_status_snapshot(
    snapshot: &types::RuntimeStatusSnapshot,
) -> Result<String, serde_json::Error> {
    encode_proto_json(snapshot)
}

pub(super) fn encode_lifecycle_event_log_entry(entry: &types::LifecycleEventLogEntry) -> Vec<u8> {
    let mut encoded = Vec::new();
    entry.encode_length_delimited(&mut encoded);
    encoded
}

pub(super) fn decode_lifecycle_event_log_entries(
    contents: &[u8],
) -> Result<Vec<types::LifecycleEventLogEntry>, buffa::DecodeError> {
    let mut entries = Vec::new();
    let mut cursor = contents;

    while !cursor.is_empty() {
        entries.push(types::LifecycleEventLogEntry::decode_length_delimited(
            &mut cursor,
        )?);
    }

    Ok(entries)
}

pub(super) fn next_monotonic_timestamp_nanos() -> u64 {
    let start = MONOTONIC_TIMESTAMP_START.get_or_init(Instant::now);
    let elapsed = start.elapsed().as_nanos().min(u64::MAX as u128) as u64;
    let candidate = elapsed.max(1);

    loop {
        let previous = LAST_MONOTONIC_TIMESTAMP_NANOS.load(Ordering::Relaxed);
        let next = candidate.max(previous.saturating_add(1));
        if LAST_MONOTONIC_TIMESTAMP_NANOS
            .compare_exchange(previous, next, Ordering::Relaxed, Ordering::Relaxed)
            .is_ok()
        {
            return next;
        }
    }
}

fn decode_proto_json<T>(contents: &str) -> Result<T, serde_json::Error>
where
    T: DeserializeOwned,
{
    serde_json::from_str(contents.trim())
}

fn encode_proto_json<T>(record: &T) -> Result<String, serde_json::Error>
where
    T: Serialize,
{
    let mut serialized = serde_json::to_string(record)?;
    serialized.push('\n');
    Ok(serialized)
}

#[cfg(test)]
mod tests {
    use buffa::MessageField;
    use pretty_assertions::assert_eq;

    use super::DURABLE_EVENT_LOG_ENCODING;
    use super::DURABLE_STATE_FILE_ENCODING;
    use super::decode_lifecycle_event_log_entries;
    use super::durable_lifecycle_record_encoding_label;
    use super::encode_lifecycle_event_log_entry;
    use super::encode_supervisor_status_snapshot;
    use crate::supervisor_control_proto::types;

    #[test]
    fn documents_lifecycle_record_encodings() {
        assert_eq!(
            DURABLE_EVENT_LOG_ENCODING,
            types::LifecycleRecordEncoding::LIFECYCLE_RECORD_ENCODING_LENGTH_DELIMITED_BINARY_PROTOBUF
        );
        assert_eq!(
            DURABLE_STATE_FILE_ENCODING,
            types::LifecycleRecordEncoding::LIFECYCLE_RECORD_ENCODING_PROTO_JSON
        );
        assert_eq!(
            durable_lifecycle_record_encoding_label(DURABLE_EVENT_LOG_ENCODING),
            "length-delimited-binary-protobuf"
        );
        assert_eq!(
            durable_lifecycle_record_encoding_label(DURABLE_STATE_FILE_ENCODING),
            "proto-json"
        );
    }

    #[test]
    fn encodes_supervisor_status_snapshot_as_newline_terminated_proto_json() {
        let snapshot = types::SupervisorStatusSnapshot {
            status: MessageField::some(types::SupervisorStatus {
                phase: Some(types::SupervisorPhase::SUPERVISOR_PHASE_READY.into()),
                supervisor_sequence: Some(1),
                ..Default::default()
            }),
            ..Default::default()
        };

        let encoded = encode_supervisor_status_snapshot(&snapshot)
            .expect("expected proto JSON supervisor status snapshot encode");

        assert!(encoded.ends_with('\n'));
        assert!(encoded.contains("\"phase\":\"SUPERVISOR_PHASE_READY\""));
        assert!(encoded.contains("\"supervisorSequence\":\"1\""));
    }

    #[test]
    fn encodes_lifecycle_event_log_entries_as_length_delimited_frames() {
        let first = types::LifecycleEventLogEntry {
            lifecycle_sequence: Some(1),
            kind: Some(
                types::LifecycleEventKind::LIFECYCLE_EVENT_KIND_SUPERVISOR_TRANSITION_RECORDED
                    .into(),
            ),
            monotonic_timestamp_nanos: Some(1),
            ..Default::default()
        };
        let second = types::LifecycleEventLogEntry {
            lifecycle_sequence: Some(2),
            kind: Some(
                types::LifecycleEventKind::LIFECYCLE_EVENT_KIND_SUPERVISOR_TRANSITION_RECORDED
                    .into(),
            ),
            monotonic_timestamp_nanos: Some(2),
            ..Default::default()
        };
        let mut encoded = encode_lifecycle_event_log_entry(&first);
        encoded.extend(encode_lifecycle_event_log_entry(&second));

        let decoded = decode_lifecycle_event_log_entries(&encoded)
            .expect("expected framed lifecycle entries to decode");

        assert_eq!(decoded.len(), 2);
        assert_eq!(decoded[0].lifecycle_sequence, Some(1));
        assert_eq!(decoded[1].lifecycle_sequence, Some(2));
    }
}
