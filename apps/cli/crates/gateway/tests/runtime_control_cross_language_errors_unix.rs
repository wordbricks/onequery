#![cfg(unix)]

use std::collections::HashMap;
use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::Path;
use std::process::Child;
use std::process::Command;
use std::time::Duration;

use base64::Engine;
use buffa::MessageField;
use connectrpc::ConnectError;
use connectrpc::ErrorCode;
use connectrpc::client::CallOptions;
use connectrpc::client::ClientConfig;
use connectrpc::client::Http2Connection;
use connectrpc::client::SharedHttp2Connection;
use onequery_proto_runtime::google::rpc;
use onequery_proto_runtime::onequery::runtime::v1 as runtime;
use pretty_assertions::assert_eq;
use tempfile::TempDir;
use tempfile::tempdir;

const RUNTIME_CONTROL_TEST_MAX_MESSAGE_SIZE: usize = 64 * 1024;
const READY_WAIT_ATTEMPTS: usize = 100;
const READY_WAIT_INTERVAL: Duration = Duration::from_millis(50);
const ERROR_INFO_DETAIL_TYPE: &str = "google.rpc.ErrorInfo";
const BAD_REQUEST_DETAIL_TYPE: &str = "google.rpc.BadRequest";
const RETRY_INFO_DETAIL_TYPE: &str = "google.rpc.RetryInfo";
const RESOURCE_INFO_DETAIL_TYPE: &str = "google.rpc.ResourceInfo";
const PRECONDITION_FAILURE_DETAIL_TYPE: &str = "google.rpc.PreconditionFailure";

#[tokio::test]
async fn rust_generated_client_receives_stale_launch_fencing_details() {
    let fixture = RuntimeControlFixture::start(&[]);
    let client = runtime_control_client(fixture.socket_path()).await;
    let error = stop_error(
        &client,
        runtime::StopRequest {
            target: MessageField::some(runtime_target_with_launch("launch-stale")),
            ..runtime_stop_request("018f0789-cc38-7d46-9a6b-83a2c8f0a201")
        },
    )
    .await;

    assert_eq!(error.code, ErrorCode::FailedPrecondition);
    assert_eq!(
        error.message.as_deref(),
        Some(
            "runtime control stop target launch_id mismatch: expected launch-rust-connect-unix, got launch-stale"
        )
    );
    assert_eq!(
        runtime_error_details::<rpc::ErrorInfo>(&error, ERROR_INFO_DETAIL_TYPE),
        vec![rpc::ErrorInfo {
            domain: "onequery.runtime.v1".to_owned(),
            metadata: runtime_control_metadata(&[
                ("actual", "launch-stale"),
                ("component", "runtime-control"),
                ("expected", "launch-rust-connect-unix"),
                ("field", "launch_id"),
                ("operation", "stop"),
                ("retryable", "false"),
            ]),
            reason: "RUNTIME_CONTROL_TARGET_PRECONDITION_FAILED".to_owned(),
            ..Default::default()
        }]
    );
    assert_eq!(
        runtime_error_details::<rpc::PreconditionFailure>(
            &error,
            PRECONDITION_FAILURE_DETAIL_TYPE
        ),
        vec![rpc::PreconditionFailure {
            violations: vec![rpc::precondition_failure::Violation {
                description:
                    "runtime control stop target launch_id mismatch: expected launch-rust-connect-unix, got launch-stale"
                        .to_owned(),
                r#type: "RUNTIME_TARGET_MISMATCH".to_owned(),
                subject: "launch_id".to_owned(),
                ..Default::default()
            }],
            ..Default::default()
        }]
    );
    assert_eq!(
        runtime_error_details::<rpc::ResourceInfo>(&error, RESOURCE_INFO_DETAIL_TYPE),
        vec![rpc::ResourceInfo {
            description:
                "runtime control stop target launch_id mismatch: expected launch-rust-connect-unix, got launch-stale"
                    .to_owned(),
            resource_name: "target.launch_id:launch-rust-connect-unix".to_owned(),
            resource_type: "onequery.runtime.control.target".to_owned(),
            ..Default::default()
        }]
    );
}

#[tokio::test]
async fn rust_generated_client_replays_and_rejects_stop_operation_ids() {
    let fixture = RuntimeControlFixture::start(&[]);
    let client = runtime_control_client(fixture.socket_path()).await;
    let operation_id = "018f0789-cc38-7d46-9a6b-83a2c8f0a202";
    let accepted = client
        .stop_with_options(
            runtime_stop_request(operation_id),
            runtime_control_test_call_options(),
        )
        .await
        .unwrap_or_else(|error| panic!("expected first Stop response: {error}"))
        .into_owned();
    let duplicate = client
        .stop_with_options(
            runtime_stop_request(operation_id),
            runtime_control_test_call_options(),
        )
        .await
        .unwrap_or_else(|error| panic!("expected duplicate Stop response: {error}"))
        .into_owned();

    assert_eq!(duplicate, accepted);

    let conflict = stop_error(
        &client,
        runtime::StopRequest {
            completion: Some(
                runtime::RuntimeStopCompletion::RUNTIME_STOP_COMPLETION_CLEANUP_ONLY.into(),
            ),
            ..runtime_stop_request(operation_id)
        },
    )
    .await;

    assert_eq!(conflict.code, ErrorCode::InvalidArgument);
    assert_eq!(
        conflict.message.as_deref(),
        Some(
            "runtime control stop request operation_id 018f0789-cc38-7d46-9a6b-83a2c8f0a202 was already used with a different completion: expected cleanup_and_exit, got cleanup_only"
        )
    );
    assert_eq!(
        runtime_error_details::<rpc::ErrorInfo>(&conflict, ERROR_INFO_DETAIL_TYPE),
        vec![rpc::ErrorInfo {
            domain: "onequery.runtime.v1".to_owned(),
            metadata: runtime_control_metadata(&[
                ("actual", "cleanup_only"),
                ("component", "runtime-control"),
                ("expected", "cleanup_and_exit"),
                ("field", "completion"),
                ("operation", "stop"),
                ("operationId", operation_id),
                ("retryable", "false"),
            ]),
            reason: "RUNTIME_CONTROL_OPERATION_CONFLICT".to_owned(),
            ..Default::default()
        }]
    );
    assert_eq!(
        bad_request_field_reasons(&runtime_error_details::<rpc::BadRequest>(
            &conflict,
            BAD_REQUEST_DETAIL_TYPE
        )),
        vec![
            (
                "operation_id".to_owned(),
                "OPERATION_ID_REUSE_CONFLICT".to_owned()
            ),
            (
                "completion".to_owned(),
                "OPERATION_ID_CONFLICTING_FIELD".to_owned()
            ),
        ]
    );
    assert_eq!(
        runtime_error_details::<rpc::ResourceInfo>(&conflict, RESOURCE_INFO_DETAIL_TYPE),
        vec![rpc::ResourceInfo {
            description:
                "runtime control stop request operation_id 018f0789-cc38-7d46-9a6b-83a2c8f0a202 was already used with a different completion: expected cleanup_and_exit, got cleanup_only"
                    .to_owned(),
            resource_name: operation_id.to_owned(),
            resource_type: "onequery.runtime.control.stop_operation".to_owned(),
            ..Default::default()
        }]
    );
}

#[tokio::test]
async fn rust_generated_client_receives_validation_and_timeout_failures() {
    let fixture = RuntimeControlFixture::start(&[]);
    let client = runtime_control_client(fixture.socket_path()).await;
    let validation = stop_error(
        &client,
        runtime::StopRequest {
            operation_id: Some("not-a-uuid".to_owned()),
            ..runtime_stop_request("018f0789-cc38-7d46-9a6b-83a2c8f0a203")
        },
    )
    .await;

    assert_eq!(validation.code, ErrorCode::InvalidArgument);
    assert_eq!(
        runtime_error_details::<rpc::ErrorInfo>(&validation, ERROR_INFO_DETAIL_TYPE),
        vec![rpc::ErrorInfo {
            domain: "onequery.runtime.v1".to_owned(),
            metadata: runtime_control_metadata(&[
                ("component", "runtime-control"),
                ("operation", "Stop"),
                ("retryable", "false"),
            ]),
            reason: "RUNTIME_CONTROL_REQUEST_INVALID".to_owned(),
            ..Default::default()
        }]
    );
    assert_eq!(
        bad_request_field_reasons(&runtime_error_details::<rpc::BadRequest>(
            &validation,
            BAD_REQUEST_DETAIL_TYPE
        )),
        vec![("operation_id".to_owned(), "STRING_UUID".to_owned())]
    );

    let timeout = match client
        .get_status_with_options(
            runtime::GetStatusRequest::default(),
            runtime_control_test_call_options_with_timeout(Duration::from_millis(300_001)),
        )
        .await
    {
        Ok(_) => panic!("expected GetStatus timeout overflow to fail"),
        Err(error) => error,
    };

    assert_eq!(timeout.code, ErrorCode::InvalidArgument);
    assert_eq!(
        timeout.message.as_deref(),
        Some("timeout 300001ms must be <= 300000")
    );
}

#[tokio::test]
async fn rust_generated_client_decodes_retryable_startup_error_details() {
    let fixture = RuntimeControlFixture::start(&["without-shutdown-controller"]);
    let client = runtime_control_client(fixture.socket_path()).await;
    let error = stop_error(
        &client,
        runtime_stop_request("018f0789-cc38-7d46-9a6b-83a2c8f0a204"),
    )
    .await;

    assert_eq!(error.code, ErrorCode::Unavailable);
    assert_eq!(
        error.message.as_deref(),
        Some("runtime shutdown controller is not attached")
    );
    assert_eq!(
        runtime_error_details::<rpc::ErrorInfo>(&error, ERROR_INFO_DETAIL_TYPE),
        vec![rpc::ErrorInfo {
            domain: "onequery.runtime.v1".to_owned(),
            metadata: runtime_control_metadata(&[
                ("component", "runtime-control"),
                ("operation", "stop"),
                ("retryable", "true"),
            ]),
            reason: "RUNTIME_CONTROL_STARTUP_NOT_READY".to_owned(),
            ..Default::default()
        }]
    );
    assert_eq!(
        runtime_error_details::<rpc::RetryInfo>(&error, RETRY_INFO_DETAIL_TYPE),
        vec![rpc::RetryInfo {
            retry_delay: MessageField::some(buffa_types::google::protobuf::Duration {
                nanos: 250_000_000,
                ..Default::default()
            }),
            ..Default::default()
        }]
    );
}

fn runtime_control_test_call_options() -> CallOptions {
    runtime_control_test_call_options_with_timeout(Duration::from_secs(5))
}

fn runtime_control_test_call_options_with_timeout(timeout: Duration) -> CallOptions {
    CallOptions::default()
        .with_timeout(timeout)
        .with_max_message_size(RUNTIME_CONTROL_TEST_MAX_MESSAGE_SIZE)
        .with_header("x-onequery-runtime-control-client", "onequery-gateway-test")
        .with_header("x-request-id", "req-runtime-control-connect-test")
        .with_header(
            "x-onequery-runtime-control-supervisor-id",
            "gateway-supervisor-test",
        )
        .with_header(
            "x-onequery-runtime-control-launch-id",
            "launch-rust-connect-unix",
        )
        .with_header("x-onequery-cli-version", env!("CARGO_PKG_VERSION"))
}

type RuntimeControlTestClient = runtime::RuntimeControlServiceClient<SharedHttp2Connection>;

async fn runtime_control_client(socket_path: &Path) -> RuntimeControlTestClient {
    let authority: http::Uri = "http://onequery-runtime"
        .parse()
        .unwrap_or_else(|error| panic!("expected runtime control authority URI: {error}"));
    let connection = Http2Connection::connect_unix(socket_path, authority.clone())
        .await
        .unwrap_or_else(|error| panic!("expected Rust HTTP/2 UDS connection: {error}"));

    runtime::RuntimeControlServiceClient::new(connection.shared(4), ClientConfig::new(authority))
}

async fn stop_error(
    client: &RuntimeControlTestClient,
    request: runtime::StopRequest,
) -> ConnectError {
    match client
        .stop_with_options(request, runtime_control_test_call_options())
        .await
    {
        Ok(_) => panic!("expected Stop to fail"),
        Err(error) => error,
    }
}

fn runtime_stop_request(operation_id: &str) -> runtime::StopRequest {
    runtime::StopRequest {
        completion: Some(
            runtime::RuntimeStopCompletion::RUNTIME_STOP_COMPLETION_CLEANUP_AND_EXIT.into(),
        ),
        grace_timeout: MessageField::some(buffa_types::google::protobuf::Duration {
            seconds: 30,
            nanos: 0,
            ..Default::default()
        }),
        operation_id: Some(operation_id.to_owned()),
        reason: Some("gateway_stop".to_owned()),
        target: MessageField::some(matching_runtime_target()),
        ..Default::default()
    }
}

fn matching_runtime_target() -> runtime::RuntimeTarget {
    runtime_target_with_launch("launch-rust-connect-unix")
}

fn runtime_target_with_launch(launch_id: &str) -> runtime::RuntimeTarget {
    runtime::RuntimeTarget {
        launch_id: Some(launch_id.to_owned()),
        data_dir: Some("/tmp/onequery-data".to_owned()),
        pid: Some(4242),
        ..Default::default()
    }
}

fn runtime_error_details<MessageType>(error: &ConnectError, detail_type: &str) -> Vec<MessageType>
where
    MessageType: buffa::Message,
{
    error
        .details
        .iter()
        .filter(|detail| detail_type_matches(detail.type_url.as_str(), detail_type))
        .map(|detail| decode_runtime_error_detail(detail, detail_type))
        .collect()
}

fn detail_type_matches(actual: &str, expected: &str) -> bool {
    actual == expected || actual.strip_prefix("type.googleapis.com/") == Some(expected)
}

fn decode_runtime_error_detail<MessageType>(
    detail: &connectrpc::error::ErrorDetail,
    detail_type: &str,
) -> MessageType
where
    MessageType: buffa::Message,
{
    let value = detail
        .value
        .as_deref()
        .unwrap_or_else(|| panic!("expected {detail_type} detail value"));
    let bytes = base64::engine::general_purpose::STANDARD_NO_PAD
        .decode(value)
        .or_else(|_| base64::engine::general_purpose::STANDARD.decode(value))
        .unwrap_or_else(|error| panic!("expected {detail_type} detail base64: {error}"));

    MessageType::decode_from_slice(bytes.as_slice())
        .unwrap_or_else(|error| panic!("expected {detail_type} detail protobuf: {error}"))
}

fn runtime_control_metadata(entries: &[(&str, &str)]) -> HashMap<String, String> {
    entries
        .iter()
        .map(|(key, value)| ((*key).to_owned(), (*value).to_owned()))
        .collect()
}

fn bad_request_field_reasons(details: &[rpc::BadRequest]) -> Vec<(String, String)> {
    details
        .iter()
        .flat_map(|detail| {
            detail
                .field_violations
                .iter()
                .map(|violation| (violation.field.clone(), violation.reason.clone()))
        })
        .collect()
}

struct RuntimeControlFixture {
    _server: RuntimeControlServerProcess,
    _temp_dir: TempDir,
    socket_path: std::path::PathBuf,
}

impl RuntimeControlFixture {
    fn start(modes: &[&str]) -> Self {
        let temp_dir = private_runtime_control_tempdir();
        let socket_path = temp_dir.path().join("runtime-control.sock");
        let ready_path = temp_dir.path().join("runtime-control.ready");
        let mut server =
            RuntimeControlServerProcess::spawn_with_args(&socket_path, &ready_path, modes);

        wait_for_ready_file(&ready_path, server.child_mut());

        Self {
            _server: server,
            _temp_dir: temp_dir,
            socket_path,
        }
    }

    fn socket_path(&self) -> &Path {
        self.socket_path.as_path()
    }
}

fn private_runtime_control_tempdir() -> TempDir {
    let temp_dir =
        tempdir().unwrap_or_else(|error| panic!("expected runtime control temp dir: {error}"));
    let mut permissions = fs::metadata(temp_dir.path())
        .unwrap_or_else(|error| panic!("expected runtime control temp dir metadata: {error}"))
        .permissions();
    permissions.set_mode(0o700);
    fs::set_permissions(temp_dir.path(), permissions)
        .unwrap_or_else(|error| panic!("expected private runtime control temp dir: {error}"));

    temp_dir
}

struct RuntimeControlServerProcess {
    child: Child,
}

impl RuntimeControlServerProcess {
    fn spawn_with_args(socket_path: &Path, ready_path: &Path, extra_args: &[&str]) -> Self {
        let repo_root = onequery_utils::repo_root()
            .unwrap_or_else(|error| panic!("expected repo root from onequery-utils: {error}"));
        let fixture_path =
            onequery_utils::find_resource!("tests/fixtures/runtime-control-server.ts")
                .and_then(|path| path.canonicalize())
                .unwrap_or_else(|error| panic!("expected runtime control fixture: {error}"));
        let mut command = Command::new("bun");
        command
            .arg(fixture_path)
            .arg(socket_path)
            .arg(ready_path)
            .args(extra_args)
            .current_dir(repo_root);
        let child = command
            .spawn()
            .unwrap_or_else(|error| panic!("expected to spawn runtime control fixture: {error}"));

        Self { child }
    }

    fn child_mut(&mut self) -> &mut Child {
        &mut self.child
    }
}

impl Drop for RuntimeControlServerProcess {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

fn wait_for_ready_file(ready_path: &Path, child: &mut Child) {
    for _ in 0..READY_WAIT_ATTEMPTS {
        if ready_path.exists() {
            return;
        }

        match child.try_wait() {
            Ok(Some(status)) => {
                panic!("runtime control fixture exited before ready file was written: {status}");
            }
            Ok(None) => {}
            Err(error) => {
                panic!("failed to inspect runtime control fixture process: {error}");
            }
        }

        std::thread::sleep(READY_WAIT_INTERVAL);
    }

    panic!(
        "runtime control fixture did not create ready file {}",
        ready_path.display()
    );
}
