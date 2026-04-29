#[cfg(unix)]
use std::path::Path;
use std::time::Duration as StdDuration;

use buffa::EnumValue;
use buffa::MessageField;
use connectrpc::ConnectError;
use connectrpc::client::CallOptions;
use connectrpc::client::ClientConfig;
use connectrpc::client::ClientTransport;
#[cfg(unix)]
use connectrpc::client::Http2Connection;
use uuid::Uuid;

use crate::runtime_control::RuntimeControlClient;
use crate::runtime_control::types;
use crate::self_host::SelfHostRuntimePaths;

use super::super::state::GatewayRuntimeState;
use super::lifecycle::ManagedRuntimeIdentity;
use super::lifecycle::ManagedSupervisorIdentity;
use super::lifecycle::read_active_supervisor_identity_for_runtime;
use super::lifecycle::read_managed_runtime_identity;

pub(crate) use super::control_error::runtime_control_error_allows_fallback;

const RUNTIME_CONTROL_AUTHORITY: &str = "http://onequery-runtime";
const RUNTIME_CONTROL_SHARED_STREAM_BOUND: usize = 8;
const RUNTIME_CONTROL_REQUEST_TIMEOUT: StdDuration = StdDuration::from_secs(5);
const RUNTIME_CONTROL_MAX_MESSAGE_SIZE: usize = 64 * 1024;
const RUNTIME_CONTROL_CLIENT_HEADER_NAME: &str = "x-onequery-runtime-control-client";
const RUNTIME_CONTROL_CLIENT_HEADER_VALUE: &str = "onequery-gateway";
const RUNTIME_CONTROL_REQUEST_ID_HEADER_NAME: &str = "x-request-id";
const RUNTIME_CONTROL_SUPERVISOR_ID_HEADER_NAME: &str = "x-onequery-runtime-control-supervisor-id";
const RUNTIME_CONTROL_LAUNCH_ID_HEADER_NAME: &str = "x-onequery-runtime-control-launch-id";
const RUNTIME_CONTROL_CLI_VERSION_HEADER_NAME: &str = "x-onequery-cli-version";
const RUNTIME_CONTROL_CLI_VERSION_HEADER_VALUE: &str = env!("CARGO_PKG_VERSION");

#[derive(Debug, Clone, Eq, PartialEq)]
pub(crate) struct RuntimeControlStatus {
    pub(crate) pid: Option<u32>,
    pub(crate) launch_id: Option<String>,
    pub(crate) data_dir: Option<String>,
    pub(crate) phase: types::RuntimePhase,
    pub(crate) runtime_sequence: Option<u64>,
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub(crate) enum RuntimeControlStatusWatchEvent {
    Snapshot(RuntimeControlStatus),
    Transition {
        phase: types::RuntimePhase,
        runtime_sequence: Option<u64>,
    },
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub(crate) struct RuntimeControlStopResponse {
    pub(crate) status: RuntimeControlStatus,
}

#[derive(Debug, Clone, Copy, Default, Eq, PartialEq)]
pub(crate) struct RuntimeControlCallHeaders<'a> {
    launch_id: Option<&'a str>,
    supervisor_id: Option<&'a str>,
}

#[cfg(unix)]
#[derive(Debug, Clone, Copy, Eq, PartialEq)]
enum RuntimeControlTransportEndpoint<'a> {
    UnixSocket { path: &'a Path },
}

type RuntimeControlResponseBody =
    <connectrpc::client::SharedHttp2Connection as ClientTransport>::ResponseBody;

pub(crate) type RuntimeControlStatusStream = connectrpc::client::ServerStream<
    RuntimeControlResponseBody,
    types::WatchStatusResponseView<'static>,
>;

pub(crate) const fn runtime_control_phase_label(phase: types::RuntimePhase) -> &'static str {
    match phase {
        types::RuntimePhase::RUNTIME_PHASE_UNSPECIFIED => "unspecified",
        types::RuntimePhase::RUNTIME_PHASE_STARTING => "starting",
        types::RuntimePhase::RUNTIME_PHASE_READY => "ready",
        types::RuntimePhase::RUNTIME_PHASE_DRAINING => "draining",
        types::RuntimePhase::RUNTIME_PHASE_CHECKPOINTING => "checkpointing",
        types::RuntimePhase::RUNTIME_PHASE_STOPPING => "stopping",
        types::RuntimePhase::RUNTIME_PHASE_STOPPED => "stopped",
        types::RuntimePhase::RUNTIME_PHASE_SHUTDOWN_FAILED => "shutdown_failed",
        types::RuntimePhase::RUNTIME_PHASE_FAILED => "failed",
    }
}

pub(crate) const fn runtime_control_phase_is_terminal(phase: types::RuntimePhase) -> bool {
    matches!(
        phase,
        types::RuntimePhase::RUNTIME_PHASE_STOPPED
            | types::RuntimePhase::RUNTIME_PHASE_SHUTDOWN_FAILED
            | types::RuntimePhase::RUNTIME_PHASE_FAILED
    )
}

fn runtime_control_phase_from_proto(
    value: Option<EnumValue<types::RuntimePhase>>,
) -> types::RuntimePhase {
    value
        .and_then(|value| value.as_known())
        .unwrap_or(types::RuntimePhase::RUNTIME_PHASE_UNSPECIFIED)
}

impl<'a> RuntimeControlCallHeaders<'a> {
    pub(crate) fn for_launch(launch_id: &'a str) -> Self {
        Self {
            launch_id: Some(launch_id),
            supervisor_id: None,
        }
    }

    pub(crate) fn with_supervisor_id(mut self, supervisor_id: &'a str) -> Self {
        self.supervisor_id = Some(supervisor_id);
        self
    }
}

pub(crate) async fn read_live_runtime_status(
    state: &GatewayRuntimeState,
    command_line: &str,
) -> Option<RuntimeControlStatus> {
    let identity = read_managed_runtime_identity(&state.paths, command_line)
        .ok()
        .flatten()?;
    let supervisor =
        read_active_supervisor_identity_for_runtime(&state.paths, &identity, command_line)
            .ok()
            .flatten();

    // CONTEXT: `gateway status` remains useful during startup, shutdown, and
    // crash recovery even when the private control socket is not accepting RPCs.
    get_runtime_control_status(
        &state.paths,
        runtime_control_call_headers_for_identity(&identity, supervisor.as_ref()),
    )
    .await
    .ok()
}

pub(crate) async fn request_runtime_control_stop(
    paths: &SelfHostRuntimePaths,
    identity: &ManagedRuntimeIdentity,
    supervisor_id: &str,
    operation_id: &str,
    reason: &str,
    grace_timeout: StdDuration,
) -> Result<RuntimeControlStopResponse, ConnectError> {
    let client = runtime_control_client(paths).await?;
    let request = stop_request(
        runtime_target(paths, identity),
        operation_id,
        reason,
        grace_timeout,
    );
    let call_headers = RuntimeControlCallHeaders::for_launch(identity.launch_id.as_str())
        .with_supervisor_id(supervisor_id);

    validate_stop_response(
        client
            .stop_with_options(request, runtime_control_call_options(call_headers)?)
            .await?
            .into_owned(),
    )
}

pub(crate) async fn watch_runtime_control_status(
    paths: &SelfHostRuntimePaths,
    launch_id: &str,
    call_headers: RuntimeControlCallHeaders<'_>,
) -> Result<RuntimeControlStatusStream, ConnectError> {
    watch_runtime_control_status_after(paths, launch_id, 0, true, call_headers).await
}

pub(crate) async fn watch_runtime_control_status_after(
    paths: &SelfHostRuntimePaths,
    launch_id: &str,
    after_runtime_sequence: u64,
    include_snapshot: bool,
    call_headers: RuntimeControlCallHeaders<'_>,
) -> Result<RuntimeControlStatusStream, ConnectError> {
    let client = runtime_control_client(paths).await?;

    client
        .watch_status_with_options(
            watch_status_request(paths, launch_id, after_runtime_sequence, include_snapshot),
            runtime_control_call_options(call_headers)?,
        )
        .await
}

pub(crate) fn runtime_control_watch_event_from_proto(
    response: types::WatchStatusResponse,
) -> Option<RuntimeControlStatusWatchEvent> {
    match response.event? {
        types::watch_status_response::Event::Snapshot(status) => Some(
            RuntimeControlStatusWatchEvent::Snapshot(status_from_proto(*status)),
        ),
        types::watch_status_response::Event::Transition(transition) => {
            Some(RuntimeControlStatusWatchEvent::Transition {
                phase: runtime_control_phase_from_proto(transition.current_phase),
                runtime_sequence: transition.runtime_sequence,
            })
        }
    }
}

async fn get_runtime_control_status(
    paths: &SelfHostRuntimePaths,
    call_headers: RuntimeControlCallHeaders<'_>,
) -> Result<RuntimeControlStatus, ConnectError> {
    let client = runtime_control_client(paths).await?;
    let response = client
        .get_status_with_options(
            types::GetStatusRequest::default(),
            runtime_control_call_options(call_headers)?,
        )
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
    let endpoint = runtime_control_transport_endpoint(paths);
    let connection = runtime_control_connection(endpoint, authority.clone()).await?;
    let config = runtime_control_client_config(authority)?;

    Ok(RuntimeControlClient::new(
        connection.shared(RUNTIME_CONTROL_SHARED_STREAM_BOUND),
        config,
    ))
}

#[cfg(unix)]
fn runtime_control_transport_endpoint(
    paths: &SelfHostRuntimePaths,
) -> RuntimeControlTransportEndpoint<'_> {
    RuntimeControlTransportEndpoint::UnixSocket {
        path: paths.runtime_control_socket_path.as_path(),
    }
}

#[cfg(unix)]
async fn runtime_control_connection(
    endpoint: RuntimeControlTransportEndpoint<'_>,
    authority: http::Uri,
) -> Result<Http2Connection, ConnectError> {
    match endpoint {
        RuntimeControlTransportEndpoint::UnixSocket { path } => {
            // CONTEXT: `connect_unix` is connect-rust's custom connector path
            // for UDS h2c. Future named-pipe transports should add another
            // connector branch here and still return the same generated client.
            Http2Connection::connect_unix(path, authority).await
        }
    }
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

fn runtime_control_client_config(authority: http::Uri) -> Result<ClientConfig, ConnectError> {
    Ok(ClientConfig::new(authority)
        .default_timeout(RUNTIME_CONTROL_REQUEST_TIMEOUT)
        .default_max_message_size(RUNTIME_CONTROL_MAX_MESSAGE_SIZE)
        .default_headers(runtime_control_default_headers()?))
}

fn runtime_control_default_headers() -> Result<http::HeaderMap, ConnectError> {
    let mut headers = http::HeaderMap::new();

    // CONTEXT: connect-rust's `ClientConfig::default_header` silently drops
    // invalid headers; this helper keeps runtime-control configuration
    // failures visible.
    try_insert_runtime_control_header(
        &mut headers,
        RUNTIME_CONTROL_CLIENT_HEADER_NAME,
        RUNTIME_CONTROL_CLIENT_HEADER_VALUE,
    )?;
    try_insert_runtime_control_header(
        &mut headers,
        RUNTIME_CONTROL_CLI_VERSION_HEADER_NAME,
        RUNTIME_CONTROL_CLI_VERSION_HEADER_VALUE,
    )?;

    Ok(headers)
}

fn try_insert_runtime_control_header(
    headers: &mut http::HeaderMap,
    name: &'static str,
    value: &str,
) -> Result<(), ConnectError> {
    let header_name = http::header::HeaderName::from_bytes(name.as_bytes()).map_err(|_| {
        ConnectError::internal(format!("invalid runtime control header name {name}"))
    })?;
    let header_value = http::header::HeaderValue::from_str(value).map_err(|_| {
        ConnectError::internal(format!("invalid runtime control header value for {name}"))
    })?;

    headers.append(header_name, header_value);

    Ok(())
}

fn runtime_control_call_options(
    call_headers: RuntimeControlCallHeaders<'_>,
) -> Result<CallOptions, ConnectError> {
    let request_id = Uuid::new_v4().to_string();

    runtime_control_call_options_with_request_id(call_headers, request_id.as_str())
}

fn runtime_control_call_options_with_request_id(
    call_headers: RuntimeControlCallHeaders<'_>,
    request_id: &str,
) -> Result<CallOptions, ConnectError> {
    let mut options = CallOptions::default()
        .try_with_header(RUNTIME_CONTROL_REQUEST_ID_HEADER_NAME, request_id)?;

    if let Some(launch_id) = call_headers.launch_id {
        options = options.try_with_header(RUNTIME_CONTROL_LAUNCH_ID_HEADER_NAME, launch_id)?;
    }

    if let Some(supervisor_id) = call_headers.supervisor_id {
        options =
            options.try_with_header(RUNTIME_CONTROL_SUPERVISOR_ID_HEADER_NAME, supervisor_id)?;
    }

    Ok(options)
}

fn runtime_control_call_headers_for_identity<'a>(
    identity: &'a ManagedRuntimeIdentity,
    supervisor: Option<&'a ManagedSupervisorIdentity>,
) -> RuntimeControlCallHeaders<'a> {
    let mut call_headers = RuntimeControlCallHeaders::for_launch(identity.launch_id.as_str());
    if let Some(supervisor) = supervisor {
        call_headers = call_headers.with_supervisor_id(supervisor.supervisor_id.as_str());
    }

    call_headers
}

fn stop_request(
    target: types::RuntimeTarget,
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
        target: MessageField::some(target),
        ..Default::default()
    }
}

fn watch_status_request(
    paths: &SelfHostRuntimePaths,
    launch_id: &str,
    after_runtime_sequence: u64,
    include_snapshot: bool,
) -> types::WatchStatusRequest {
    types::WatchStatusRequest {
        after_runtime_sequence: Some(after_runtime_sequence),
        include_snapshot: Some(include_snapshot),
        target: MessageField::some(runtime_target_for_launch(paths, launch_id)),
        ..Default::default()
    }
}

fn runtime_target(
    paths: &SelfHostRuntimePaths,
    identity: &ManagedRuntimeIdentity,
) -> types::RuntimeTarget {
    types::RuntimeTarget {
        launch_id: Some(identity.launch_id.clone()),
        data_dir: Some(paths.data_dir.display().to_string()),
        pid: Some(identity.pid),
        supervisor_pid: identity.supervisor_pid,
        supervisor_generation: identity.supervisor_generation,
        ..Default::default()
    }
}

fn runtime_target_for_launch(
    paths: &SelfHostRuntimePaths,
    launch_id: &str,
) -> types::RuntimeTarget {
    types::RuntimeTarget {
        launch_id: Some(launch_id.to_owned()),
        data_dir: Some(paths.data_dir.display().to_string()),
        ..Default::default()
    }
}

fn validate_stop_response(
    response: types::StopResponse,
) -> Result<RuntimeControlStopResponse, ConnectError> {
    match response
        .disposition
        .and_then(|disposition| disposition.as_known())
    {
        Some(types::RuntimeStopDisposition::RUNTIME_STOP_DISPOSITION_ACCEPTED)
        | Some(types::RuntimeStopDisposition::RUNTIME_STOP_DISPOSITION_ALREADY_STOPPING)
        | Some(types::RuntimeStopDisposition::RUNTIME_STOP_DISPOSITION_ALREADY_FINISHED) => {}
        Some(types::RuntimeStopDisposition::RUNTIME_STOP_DISPOSITION_UNSPECIFIED) | None => Err(
            ConnectError::internal("runtime control Stop response omitted stop disposition"),
        )?,
    }

    let status = response
        .status
        .into_option()
        .ok_or_else(|| ConnectError::internal("runtime control Stop response omitted status"))?;

    Ok(RuntimeControlStopResponse {
        status: status_from_proto(status),
    })
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
        phase: runtime_control_phase_from_proto(status.phase),
        runtime_sequence: status.runtime_sequence,
    }
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use pretty_assertions::assert_eq;

    use super::RUNTIME_CONTROL_CLI_VERSION_HEADER_NAME;
    use super::RUNTIME_CONTROL_CLI_VERSION_HEADER_VALUE;
    use super::RUNTIME_CONTROL_CLIENT_HEADER_NAME;
    use super::RUNTIME_CONTROL_CLIENT_HEADER_VALUE;
    use super::RUNTIME_CONTROL_LAUNCH_ID_HEADER_NAME;
    use super::RUNTIME_CONTROL_MAX_MESSAGE_SIZE;
    use super::RUNTIME_CONTROL_REQUEST_ID_HEADER_NAME;
    use super::RUNTIME_CONTROL_REQUEST_TIMEOUT;
    use super::RUNTIME_CONTROL_SUPERVISOR_ID_HEADER_NAME;
    use super::RuntimeControlCallHeaders;
    #[cfg(unix)]
    use super::RuntimeControlTransportEndpoint;
    use super::protobuf_duration;
    use super::runtime_control_call_options_with_request_id;
    use super::runtime_control_client_config;
    #[cfg(unix)]
    use super::runtime_control_transport_endpoint;
    use super::runtime_control_watch_event_from_proto;
    use super::runtime_target;
    use super::status_from_proto;
    use super::stop_request;
    use super::validate_stop_response;
    use super::watch_status_request;
    use crate::runtime::lifecycle::ManagedRuntimeIdentity;
    use crate::runtime_control::types;
    use crate::self_host::SelfHostRuntimePaths;

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
            runtime_sequence: Some(17),
            ..Default::default()
        });

        assert_eq!(status.pid, Some(4242));
        assert_eq!(status.launch_id.as_deref(), Some("launch-a"));
        assert_eq!(status.data_dir.as_deref(), Some("/tmp/onequery-data"));
        assert_eq!(status.phase, types::RuntimePhase::RUNTIME_PHASE_READY);
        assert_eq!(status.runtime_sequence, Some(17));
    }

    #[test]
    fn runtime_control_client_config_sets_shared_defaults() {
        let config = runtime_control_client_config(
            "http://onequery-runtime"
                .parse()
                .unwrap_or_else(|error| panic!("expected runtime control authority: {error}")),
        )
        .unwrap_or_else(|error| panic!("expected runtime control client config: {error}"));

        assert_eq!(
            config.default_timeout,
            Some(RUNTIME_CONTROL_REQUEST_TIMEOUT)
        );
        assert_eq!(
            config.default_max_message_size,
            Some(RUNTIME_CONTROL_MAX_MESSAGE_SIZE)
        );
        assert_eq!(
            config
                .default_headers
                .get(RUNTIME_CONTROL_CLIENT_HEADER_NAME)
                .and_then(|value| value.to_str().ok()),
            Some(RUNTIME_CONTROL_CLIENT_HEADER_VALUE)
        );
        assert_eq!(
            config
                .default_headers
                .get(RUNTIME_CONTROL_CLI_VERSION_HEADER_NAME)
                .and_then(|value| value.to_str().ok()),
            Some(RUNTIME_CONTROL_CLI_VERSION_HEADER_VALUE)
        );
    }

    #[test]
    fn runtime_control_call_options_set_per_call_headers() {
        let options = runtime_control_call_options_with_request_id(
            RuntimeControlCallHeaders::for_launch("launch-a")
                .with_supervisor_id("gateway-supervisor:123"),
            "018f0789-cc38-7d46-9a6b-83a2c8f0a123",
        )
        .unwrap_or_else(|error| panic!("expected runtime control call options: {error}"));

        assert_eq!(options.timeout, None);
        assert_eq!(options.max_message_size, None);
        assert_eq!(
            options
                .headers
                .get(RUNTIME_CONTROL_REQUEST_ID_HEADER_NAME)
                .and_then(|value| value.to_str().ok()),
            Some("018f0789-cc38-7d46-9a6b-83a2c8f0a123")
        );
        assert_eq!(
            options
                .headers
                .get(RUNTIME_CONTROL_SUPERVISOR_ID_HEADER_NAME)
                .and_then(|value| value.to_str().ok()),
            Some("gateway-supervisor:123")
        );
        assert_eq!(
            options
                .headers
                .get(RUNTIME_CONTROL_LAUNCH_ID_HEADER_NAME)
                .and_then(|value| value.to_str().ok()),
            Some("launch-a")
        );
        assert!(
            !options
                .headers
                .contains_key(RUNTIME_CONTROL_CLIENT_HEADER_NAME)
        );
        assert!(
            !options
                .headers
                .contains_key(RUNTIME_CONTROL_CLI_VERSION_HEADER_NAME)
        );
    }

    #[test]
    fn stop_request_asks_runtime_to_cleanup_and_exit() {
        let target = types::RuntimeTarget {
            launch_id: Some("launch-a".to_owned()),
            data_dir: Some("/tmp/onequery-data".to_owned()),
            pid: Some(4242),
            ..Default::default()
        };
        let request = stop_request(
            target,
            "018f0789-cc38-7d46-9a6b-83a2c8f0a001",
            "onequery gateway stop",
            Duration::from_millis(1_500),
        );
        let grace_timeout = request
            .grace_timeout
            .into_option()
            .unwrap_or_else(|| panic!("expected stop request grace timeout"));

        assert_eq!(
            request.operation_id.as_deref(),
            Some("018f0789-cc38-7d46-9a6b-83a2c8f0a001")
        );
        assert_eq!(request.reason.as_deref(), Some("onequery gateway stop"));
        assert_eq!(
            request
                .target
                .as_option()
                .and_then(|target| target.launch_id.as_deref()),
            Some("launch-a")
        );
        assert_eq!(
            request
                .target
                .as_option()
                .and_then(|target| target.data_dir.as_deref()),
            Some("/tmp/onequery-data")
        );
        assert_eq!(
            request.target.as_option().and_then(|target| target.pid),
            Some(4242)
        );
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
    fn runtime_target_includes_supervisor_fencing_when_available() {
        let paths = SelfHostRuntimePaths::from_dirs(
            "/tmp/onequery-config".into(),
            "/tmp/onequery-data".into(),
        );
        let target = runtime_target(
            &paths,
            &ManagedRuntimeIdentity {
                launch_id: "launch-a".to_owned(),
                pid: 4242,
                supervisor_pid: Some(1001),
                supervisor_generation: Some(7),
            },
        );

        assert_eq!(
            target,
            types::RuntimeTarget {
                launch_id: Some("launch-a".to_owned()),
                data_dir: Some("/tmp/onequery-data".to_owned()),
                pid: Some(4242),
                supervisor_pid: Some(1001),
                supervisor_generation: Some(7),
                ..Default::default()
            }
        );
    }

    #[cfg(unix)]
    #[test]
    fn runtime_control_transport_endpoint_uses_unix_socket_connector_path() {
        let paths = SelfHostRuntimePaths::from_dirs(
            "/tmp/onequery-config".into(),
            "/tmp/onequery-data".into(),
        );

        let endpoint = runtime_control_transport_endpoint(&paths);

        assert_eq!(
            endpoint,
            RuntimeControlTransportEndpoint::UnixSocket {
                path: paths.runtime_control_socket_path.as_path(),
            }
        );
    }

    #[test]
    fn validate_stop_response_accepts_idempotent_stop_dispositions() {
        for disposition in [
            types::RuntimeStopDisposition::RUNTIME_STOP_DISPOSITION_ACCEPTED,
            types::RuntimeStopDisposition::RUNTIME_STOP_DISPOSITION_ALREADY_STOPPING,
            types::RuntimeStopDisposition::RUNTIME_STOP_DISPOSITION_ALREADY_FINISHED,
        ] {
            let response = validate_stop_response(types::StopResponse {
                disposition: Some(disposition.into()),
                status: buffa::MessageField::some(types::RuntimeStatus {
                    identity: buffa::MessageField::some(types::RuntimeIdentity {
                        pid: Some(4242),
                        launch_id: Some("launch-a".to_owned()),
                        data_dir: Some("/tmp/onequery-data".to_owned()),
                        ..Default::default()
                    }),
                    phase: Some(types::RuntimePhase::RUNTIME_PHASE_STOPPING.into()),
                    runtime_sequence: Some(2),
                    ..Default::default()
                }),
                ..Default::default()
            })
            .unwrap_or_else(|error| panic!("expected stop disposition to pass: {error}"));

            assert_eq!(
                response.status.phase,
                types::RuntimePhase::RUNTIME_PHASE_STOPPING
            );
            assert_eq!(response.status.runtime_sequence, Some(2));
        }
    }

    #[test]
    fn watch_status_request_fences_launch_and_asks_for_snapshot() {
        let paths = SelfHostRuntimePaths::from_dirs(
            "/tmp/onequery-config".into(),
            "/tmp/onequery-data".into(),
        );

        let request = watch_status_request(&paths, "launch-a", 9, true);

        assert_eq!(request.after_runtime_sequence, Some(9));
        assert_eq!(request.include_snapshot, Some(true));
        assert_eq!(
            request
                .target
                .as_option()
                .and_then(|target| target.launch_id.as_deref()),
            Some("launch-a")
        );
        assert_eq!(
            request
                .target
                .as_option()
                .and_then(|target| target.data_dir.as_deref()),
            Some("/tmp/onequery-data")
        );
        assert_eq!(
            request.target.as_option().and_then(|target| target.pid),
            None
        );
    }

    #[test]
    fn watch_status_event_maps_ready_transition_phase() {
        let event = runtime_control_watch_event_from_proto(types::WatchStatusResponse {
            event: Some(types::watch_status_response::Event::Transition(Box::new(
                types::RuntimeTransition {
                    current_phase: Some(types::RuntimePhase::RUNTIME_PHASE_READY.into()),
                    runtime_sequence: Some(2),
                    ..Default::default()
                },
            ))),
            ..Default::default()
        });

        assert_eq!(
            event,
            Some(super::RuntimeControlStatusWatchEvent::Transition {
                phase: types::RuntimePhase::RUNTIME_PHASE_READY,
                runtime_sequence: Some(2),
            })
        );
    }
}
