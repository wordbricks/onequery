//! Durable lifecycle record encoding for the Rust gateway.
//!
//! State and snapshot files are newline-terminated protobuf JSON so operators
//! can inspect recovery state without custom tooling. Append-only lifecycle
//! event logs use length-delimited binary protobuf frames when implemented.

use serde::Serialize;
use serde::de::DeserializeOwned;

use crate::runtime_control::types;

pub(super) const DURABLE_STATE_FILE_ENCODING: &str = "proto-json";
#[allow(dead_code)]
pub(super) const DURABLE_EVENT_LOG_ENCODING: &str = "length-delimited-binary-protobuf";

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
    use super::decode_runtime_status_snapshot;
    use super::encode_supervisor_status_snapshot;
    use crate::runtime_control::types;

    #[test]
    fn documents_lifecycle_record_encodings() {
        assert_eq!(DURABLE_STATE_FILE_ENCODING, "proto-json");
        assert_eq!(
            DURABLE_EVENT_LOG_ENCODING,
            "length-delimited-binary-protobuf"
        );
    }

    #[test]
    fn decodes_runtime_status_snapshot_from_proto_json() {
        let snapshot = decode_runtime_status_snapshot(
            r#"{
  "status": {
    "identity": {"pid": 4242, "launchId": "launch-a", "dataDir": "/tmp/onequery"},
    "phase": "RUNTIME_PHASE_READY",
    "runtimeSequence": "1",
    "updatedAt": "2026-03-25T00:00:00Z"
  },
  "snapshotAt": "2026-03-25T00:00:00Z"
}"#,
        )
        .expect("expected proto JSON runtime status snapshot decode");

        let status = snapshot
            .status
            .as_option()
            .expect("expected decoded runtime status");

        assert_eq!(status.runtime_sequence, Some(1));
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
}
