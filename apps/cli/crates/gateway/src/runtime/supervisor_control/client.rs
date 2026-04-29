use std::time::Duration;

use connectrpc::ConnectError;
use connectrpc::client::ClientConfig;
#[cfg(unix)]
use connectrpc::client::Http2Connection;

use crate::self_host::SelfHostRuntimePaths;
use crate::supervisor_control_proto::types;
use crate::supervisor_control_protocol::SUPERVISOR_CONTROL_AUTHORITY;
use crate::supervisor_control_protocol::SUPERVISOR_CONTROL_MAX_MESSAGE_SIZE_BYTES;

const SUPERVISOR_CONTROL_SHARED_STREAM_BOUND: usize = 8;
const SUPERVISOR_CONTROL_REQUEST_TIMEOUT: Duration = Duration::from_secs(5);

pub(crate) type SupervisorControlClient =
    onequery_proto_runtime::onequery::runtime::v1::SupervisorLifecycleServiceClient<
        connectrpc::client::SharedHttp2Connection,
    >;

pub(crate) async fn get_supervisor_status(
    paths: &SelfHostRuntimePaths,
) -> Result<types::SupervisorStatus, ConnectError> {
    let response = supervisor_control_client(paths)
        .await?
        .get_status(types::SupervisorLifecycleServiceGetStatusRequest {
            ..Default::default()
        })
        .await?
        .into_owned();

    response.status.into_option().ok_or_else(|| {
        ConnectError::internal("supervisor control GetStatus response omitted status")
    })
}

#[cfg(unix)]
pub(crate) async fn supervisor_control_client(
    paths: &SelfHostRuntimePaths,
) -> Result<SupervisorControlClient, ConnectError> {
    let authority = supervisor_control_authority()?;
    let connection = Http2Connection::connect_unix(
        paths.supervisor_control_socket_path.as_path(),
        authority.clone(),
    )
    .await?;
    let config = ClientConfig::new(authority)
        .default_timeout(SUPERVISOR_CONTROL_REQUEST_TIMEOUT)
        .default_max_message_size(SUPERVISOR_CONTROL_MAX_MESSAGE_SIZE_BYTES);

    Ok(SupervisorControlClient::new(
        connection.shared(SUPERVISOR_CONTROL_SHARED_STREAM_BOUND),
        config,
    ))
}

#[cfg(not(unix))]
pub(crate) async fn supervisor_control_client(
    paths: &SelfHostRuntimePaths,
) -> Result<SupervisorControlClient, ConnectError> {
    let _ = paths;

    // Comment: Windows supervisor control is intentionally unsupported for now.
    // The current supervisor protocol is Unix-socket-only; add a named-pipe or
    // TCP transport before enabling self-host supervisor lifecycle on Windows.
    Err(ConnectError::unimplemented(
        "supervisor control is not supported on Windows yet",
    ))
}

fn supervisor_control_authority() -> Result<http::Uri, ConnectError> {
    SUPERVISOR_CONTROL_AUTHORITY.parse().map_err(|error| {
        ConnectError::internal(format!(
            "invalid supervisor control authority {SUPERVISOR_CONTROL_AUTHORITY}: {error}"
        ))
    })
}
