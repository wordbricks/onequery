use std::time::Duration;

use connectrpc::ConnectError;
use connectrpc::client::ClientConfig;
#[cfg(unix)]
use connectrpc::client::Http2Connection;

use crate::runtime_control::types;
use crate::self_host::SelfHostRuntimePaths;

const SUPERVISOR_CONTROL_AUTHORITY: &str = "http://onequery-supervisor";
const SUPERVISOR_CONTROL_SHARED_STREAM_BOUND: usize = 8;
const SUPERVISOR_CONTROL_REQUEST_TIMEOUT: Duration = Duration::from_secs(5);
const SUPERVISOR_CONTROL_MAX_MESSAGE_SIZE: usize = 64 * 1024;

pub(crate) type SupervisorControlClient =
    onequery_proto_runtime::onequery::runtime::v1::SupervisorLifecycleServiceClient<
        connectrpc::client::SharedHttp2Connection,
    >;

pub(crate) async fn get_supervisor_status(
    paths: &SelfHostRuntimePaths,
    target: types::SupervisorStopTarget,
) -> Result<types::SupervisorStatus, ConnectError> {
    let response = supervisor_control_client(paths)
        .await?
        .get_status(types::SupervisorLifecycleServiceGetStatusRequest {
            target: buffa::MessageField::some(target),
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
        .default_max_message_size(SUPERVISOR_CONTROL_MAX_MESSAGE_SIZE);

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

    Err(ConnectError::unimplemented(
        "supervisor control Connect over Unix socket is not available on this platform",
    ))
}

fn supervisor_control_authority() -> Result<http::Uri, ConnectError> {
    SUPERVISOR_CONTROL_AUTHORITY.parse().map_err(|error| {
        ConnectError::internal(format!(
            "invalid supervisor control authority {SUPERVISOR_CONTROL_AUTHORITY}: {error}"
        ))
    })
}
