use std::time::Duration as StdDuration;

use buffa::EnumValue;
use buffa::MessageField;
use connectrpc::ConnectError;
use connectrpc::ErrorCode;
#[cfg(unix)]
use connectrpc::client::Http2Connection;
use uuid::Uuid;

use crate::runtime_control::RuntimeControlClient;
use crate::runtime_control::types;
use crate::self_host::SelfHostRuntimePaths;

use super::super::state::GatewayRuntimeState;
use super::lifecycle::read_managed_runtime_pid;

const RUNTIME_CONTROL_AUTHORITY: &str = "http://onequery-runtime";
const RUNTIME_CONTROL_SHARED_STREAM_BOUND: usize = 8;
const RUNTIME_CONTROL_REQUEST_TIMEOUT: StdDuration = StdDuration::from_secs(5);
const RUNTIME_CONTROL_MAX_MESSAGE_SIZE: usize = 64 * 1024;

#[derive(Debug, Clone, Eq, PartialEq)]
pub(crate) struct RuntimeControlStatus {
    pub(crate) pid: Option<u32>,
    pub(crate) launch_id: Option<String>,
    pub(crate) data_dir: Option<String>,
    pub(crate) phase: RuntimeControlPhase,
    pub(crate) sequence: Option<u64>,
}

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub(crate) enum RuntimeControlPhase {
    Unspecified,
    Starting,
    Ready,
    Draining,
    Checkpointing,
    Stopping,
    Stopped,
    ShutdownFailed,
    Failed,
    Unknown(i32),
}

impl RuntimeControlPhase {
    pub(crate) const fn label(self) -> &'static str {
        match self {
            Self::Unspecified => "unspecified",
            Self::Starting => "starting",
            Self::Ready => "ready",
            Self::Draining => "draining",
            Self::Checkpointing => "checkpointing",
            Self::Stopping => "stopping",
            Self::Stopped => "stopped",
            Self::ShutdownFailed => "shutdown_failed",
            Self::Failed => "failed",
            Self::Unknown(_) => "unknown",
        }
    }

    fn from_proto(value: Option<EnumValue<types::RuntimePhase>>) -> Self {
        let Some(value) = value else {
            return Self::Unspecified;
        };

        match value.as_known() {
            Some(types::RuntimePhase::RUNTIME_PHASE_UNSPECIFIED) => Self::Unspecified,
            Some(types::RuntimePhase::RUNTIME_PHASE_STARTING) => Self::Starting,
            Some(types::RuntimePhase::RUNTIME_PHASE_READY) => Self::Ready,
            Some(types::RuntimePhase::RUNTIME_PHASE_DRAINING) => Self::Draining,
            Some(types::RuntimePhase::RUNTIME_PHASE_CHECKPOINTING) => Self::Checkpointing,
            Some(types::RuntimePhase::RUNTIME_PHASE_STOPPING) => Self::Stopping,
            Some(types::RuntimePhase::RUNTIME_PHASE_STOPPED) => Self::Stopped,
            Some(types::RuntimePhase::RUNTIME_PHASE_SHUTDOWN_FAILED) => Self::ShutdownFailed,
            Some(types::RuntimePhase::RUNTIME_PHASE_FAILED) => Self::Failed,
            None => Self::Unknown(value.to_i32()),
        }
    }
}

pub(crate) async fn read_live_runtime_status(
    state: &GatewayRuntimeState,
    command_line: &str,
) -> Option<RuntimeControlStatus> {
    read_managed_runtime_pid(&state.paths, command_line)
        .ok()
        .flatten()?;

    // CONTEXT: `gateway status` remains useful during startup, shutdown, and
    // crash recovery even when the private control socket is not accepting RPCs.
    get_runtime_control_status(&state.paths).await.ok()
}

pub(crate) async fn request_runtime_control_stop(
    paths: &SelfHostRuntimePaths,
    reason: &str,
    grace_timeout: StdDuration,
) -> Result<(), ConnectError> {
    let client = runtime_control_client(paths).await?;
    let request = stop_request(&Uuid::new_v4().to_string(), reason, grace_timeout);

    validate_stop_response(client.stop(request).await?.into_owned())
}

pub(crate) fn runtime_control_error_allows_fallback(error: &ConnectError) -> bool {
    matches!(
        error.code,
        ErrorCode::DeadlineExceeded
            | ErrorCode::Unavailable
            | ErrorCode::Unimplemented
            | ErrorCode::Unknown
    )
}

async fn get_runtime_control_status(
    paths: &SelfHostRuntimePaths,
) -> Result<RuntimeControlStatus, ConnectError> {
    let client = runtime_control_client(paths).await?;
    let response = client
        .get_status(types::GetStatusRequest::default())
        .await?
        .into_owned();
    let status = response.status.into_option().ok_or_else(|| {
        ConnectError::internal("runtime control GetStatus response omitted status")
    })?;

    Ok(status_from_proto(status))
}

#[cfg(unix)]
async fn runtime_control_client(
    paths: &SelfHostRuntimePaths,
) -> Result<RuntimeControlClient, ConnectError> {
    let authority = runtime_control_authority()?;
    let connection =
        Http2Connection::connect_unix(&paths.runtime_control_socket_path, authority.clone())
            .await?;
    let config = connectrpc::client::ClientConfig::new(authority)
        .default_timeout(RUNTIME_CONTROL_REQUEST_TIMEOUT)
        .default_max_message_size(RUNTIME_CONTROL_MAX_MESSAGE_SIZE);

    Ok(RuntimeControlClient::new(
        connection.shared(RUNTIME_CONTROL_SHARED_STREAM_BOUND),
        config,
    ))
}

#[cfg(not(unix))]
async fn runtime_control_client(
    paths: &SelfHostRuntimePaths,
) -> Result<RuntimeControlClient, ConnectError> {
    let _ = paths;

    Err(ConnectError::unimplemented(
        "runtime control Connect over Unix socket is not available on this platform",
    ))
}

fn runtime_control_authority() -> Result<http::Uri, ConnectError> {
    RUNTIME_CONTROL_AUTHORITY.parse().map_err(|error| {
        ConnectError::internal(format!(
            "invalid runtime control authority {RUNTIME_CONTROL_AUTHORITY}: {error}"
        ))
    })
}

fn stop_request(
    operation_id: &str,
    reason: &str,
    grace_timeout: StdDuration,
) -> types::StopRequest {
    types::StopRequest {
        operation_id: Some(operation_id.to_owned()),
        reason: Some(reason.to_owned()),
        completion: Some(
            types::RuntimeStopCompletion::RUNTIME_STOP_COMPLETION_CLEANUP_AND_EXIT.into(),
        ),
        grace_timeout: MessageField::some(protobuf_duration(grace_timeout)),
        ..Default::default()
    }
}

fn validate_stop_response(response: types::StopResponse) -> Result<(), ConnectError> {
    match response
        .disposition
        .and_then(|disposition| disposition.as_known())
    {
        Some(types::RuntimeStopDisposition::RUNTIME_STOP_DISPOSITION_ACCEPTED)
        | Some(types::RuntimeStopDisposition::RUNTIME_STOP_DISPOSITION_ALREADY_STOPPING)
        | Some(types::RuntimeStopDisposition::RUNTIME_STOP_DISPOSITION_ALREADY_FINISHED) => Ok(()),
        Some(types::RuntimeStopDisposition::RUNTIME_STOP_DISPOSITION_UNSPECIFIED) | None => Err(
            ConnectError::internal("runtime control Stop response omitted stop disposition"),
        ),
    }
}

fn protobuf_duration(value: StdDuration) -> buffa_types::google::protobuf::Duration {
    buffa_types::google::protobuf::Duration {
        seconds: value.as_secs().min(i64::MAX as u64) as i64,
        nanos: value.subsec_nanos() as i32,
        ..Default::default()
    }
}

fn status_from_proto(status: types::RuntimeStatus) -> RuntimeControlStatus {
    let mut pid = None;
    let mut launch_id = None;
    let mut data_dir = None;

    if let Some(identity) = status.identity.into_option() {
        pid = identity.pid;
        launch_id = identity.launch_id;
        data_dir = identity.data_dir;
    }

    RuntimeControlStatus {
        pid,
        launch_id,
        data_dir,
        phase: RuntimeControlPhase::from_proto(status.phase),
        sequence: status.sequence,
    }
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use pretty_assertions::assert_eq;

    use super::RuntimeControlPhase;
    use super::protobuf_duration;
    use super::status_from_proto;
    use super::stop_request;
    use super::validate_stop_response;
    use crate::runtime_control::types;

    #[test]
    fn status_from_proto_maps_identity_phase_and_sequence() {
        let status = status_from_proto(types::RuntimeStatus {
            identity: buffa::MessageField::some(types::RuntimeIdentity {
                pid: Some(4242),
                launch_id: Some("launch-a".to_owned()),
                data_dir: Some("/tmp/onequery-data".to_owned()),
                ..Default::default()
            }),
            phase: Some(types::RuntimePhase::RUNTIME_PHASE_READY.into()),
            sequence: Some(17),
            ..Default::default()
        });

        assert_eq!(status.pid, Some(4242));
        assert_eq!(status.launch_id.as_deref(), Some("launch-a"));
        assert_eq!(status.data_dir.as_deref(), Some("/tmp/onequery-data"));
        assert_eq!(status.phase, RuntimeControlPhase::Ready);
        assert_eq!(status.sequence, Some(17));
    }

    #[test]
    fn stop_request_asks_runtime_to_cleanup_and_exit() {
        let request = stop_request(
            "operation-a",
            "onequery gateway stop",
            Duration::from_millis(1_500),
        );
        let grace_timeout = request
            .grace_timeout
            .into_option()
            .unwrap_or_else(|| panic!("expected stop request grace timeout"));

        assert_eq!(request.operation_id.as_deref(), Some("operation-a"));
        assert_eq!(request.reason.as_deref(), Some("onequery gateway stop"));
        assert_eq!(
            request
                .completion
                .and_then(|completion| completion.as_known()),
            Some(types::RuntimeStopCompletion::RUNTIME_STOP_COMPLETION_CLEANUP_AND_EXIT)
        );
        assert_eq!(
            grace_timeout,
            protobuf_duration(Duration::from_millis(1_500))
        );
    }

    #[test]
    fn validate_stop_response_accepts_idempotent_stop_dispositions() {
        for disposition in [
            types::RuntimeStopDisposition::RUNTIME_STOP_DISPOSITION_ACCEPTED,
            types::RuntimeStopDisposition::RUNTIME_STOP_DISPOSITION_ALREADY_STOPPING,
            types::RuntimeStopDisposition::RUNTIME_STOP_DISPOSITION_ALREADY_FINISHED,
        ] {
            validate_stop_response(types::StopResponse {
                disposition: Some(disposition.into()),
                ..Default::default()
            })
            .unwrap_or_else(|error| panic!("expected stop disposition to pass: {error}"));
        }
    }
}
