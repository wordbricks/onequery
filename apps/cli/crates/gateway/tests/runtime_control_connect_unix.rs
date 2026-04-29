#![cfg(unix)]

use std::path::Path;
use std::process::Child;
use std::process::Command;
use std::time::Duration;

use connectrpc::client::ClientTransport;
use connectrpc::client::Http2Connection;
use http::Method;
use http::StatusCode;
use http_body_util::BodyExt as _;
use pretty_assertions::assert_eq;
use tempfile::tempdir;

const GET_STATUS_PATH: &str = "/onequery.runtime.v1.RuntimeControlService/GetStatus";
const READY_WAIT_ATTEMPTS: usize = 100;
const READY_WAIT_INTERVAL: Duration = Duration::from_millis(50);

#[tokio::test]
async fn rust_http2_connect_unix_calls_node_runtime_control_listener() {
    let temp_dir =
        tempdir().unwrap_or_else(|error| panic!("expected runtime control temp dir: {error}"));
    let socket_path = temp_dir.path().join("runtime-control.sock");
    let ready_path = temp_dir.path().join("runtime-control.ready");
    let mut server = RuntimeControlServerProcess::spawn(&socket_path, &ready_path);

    wait_for_ready_file(&ready_path, server.child_mut()).await;

    let authority = "http://onequery-runtime"
        .parse()
        .unwrap_or_else(|error| panic!("expected runtime control authority URI: {error}"));
    let connection = Http2Connection::connect_unix(&socket_path, authority)
        .await
        .unwrap_or_else(|error| panic!("expected Rust HTTP/2 UDS connection: {error}"));
    let client = connection.shared(4);
    let request = http::Request::builder()
        .method(Method::POST)
        .uri(format!("http://onequery-runtime{GET_STATUS_PATH}"))
        .header("content-type", "application/proto")
        .header("connect-protocol-version", "1")
        .body(connectrpc::client::full_body(Vec::<u8>::new().into()))
        .unwrap_or_else(|error| panic!("expected runtime control HTTP request: {error}"));

    let response = client
        .send(request)
        .await
        .unwrap_or_else(|error| panic!("expected GetStatus HTTP/2 response: {error}"));

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        response
            .headers()
            .get("content-type")
            .and_then(|value| value.to_str().ok()),
        Some("application/proto")
    );

    let body = response
        .into_body()
        .collect()
        .await
        .unwrap_or_else(|error| panic!("expected GetStatus response body: {error}"))
        .to_bytes();

    assert_runtime_status_response(&body);
}

struct RuntimeControlServerProcess {
    child: Child,
}

impl RuntimeControlServerProcess {
    fn spawn(socket_path: &Path, ready_path: &Path) -> Self {
        let repo_root = onequery_utils::repo_root()
            .unwrap_or_else(|error| panic!("expected repo root from onequery-utils: {error}"));
        let fixture_path =
            onequery_utils::find_resource!("tests/fixtures/runtime-control-server.ts")
                .and_then(|path| path.canonicalize())
                .unwrap_or_else(|error| panic!("expected runtime control fixture: {error}"));
        let child = Command::new("bun")
            .arg(fixture_path)
            .arg(socket_path)
            .arg(ready_path)
            .current_dir(repo_root)
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

async fn wait_for_ready_file(ready_path: &Path, child: &mut Child) {
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

        tokio::time::sleep(READY_WAIT_INTERVAL).await;
    }

    panic!(
        "runtime control fixture did not create ready file {}",
        ready_path.display()
    );
}

fn assert_runtime_status_response(response: &[u8]) {
    let status = required_length_delimited_field(response, 1, "GetStatusResponse.status");
    let identity = required_length_delimited_field(status, 1, "RuntimeStatus.identity");

    assert_eq!(
        required_varint_field(identity, 1, "RuntimeIdentity.pid"),
        4242
    );
    assert_eq!(
        required_string_field(identity, 2, "RuntimeIdentity.launch_id"),
        "launch-rust-connect-unix"
    );
    assert_eq!(
        required_string_field(identity, 3, "RuntimeIdentity.data_dir"),
        "/tmp/onequery-data"
    );
    assert_eq!(required_varint_field(status, 2, "RuntimeStatus.phase"), 1);
    assert_eq!(
        required_varint_field(status, 3, "RuntimeStatus.sequence"),
        1
    );
    let updated_at = required_length_delimited_field(status, 4, "RuntimeStatus.updated_at");
    assert!(
        !updated_at.is_empty(),
        "expected RuntimeStatus.updated_at to be populated"
    );
}

fn required_varint_field(message: &[u8], field_number: u64, label: &str) -> u64 {
    let Some(value) = find_field(message, field_number).and_then(|field| match field {
        ProtoField::Varint(value) => Some(value),
        ProtoField::LengthDelimited(_) => None,
    }) else {
        panic!("expected protobuf varint field {label}");
    };

    value
}

fn required_length_delimited_field<'a>(
    message: &'a [u8],
    field_number: u64,
    label: &str,
) -> &'a [u8] {
    let Some(value) = find_field(message, field_number).and_then(|field| match field {
        ProtoField::LengthDelimited(value) => Some(value),
        ProtoField::Varint(_) => None,
    }) else {
        panic!("expected protobuf length-delimited field {label}");
    };

    value
}

fn required_string_field(message: &[u8], field_number: u64, label: &str) -> String {
    let value = required_length_delimited_field(message, field_number, label);
    String::from_utf8(value.to_vec())
        .unwrap_or_else(|error| panic!("expected protobuf string field {label}: {error}"))
}

fn find_field(message: &[u8], target_field_number: u64) -> Option<ProtoField<'_>> {
    let mut cursor = 0;
    while cursor < message.len() {
        let key = read_varint(message, &mut cursor)?;
        let field_number = key >> 3;
        let wire_type = key & 0b111;

        match wire_type {
            0 => {
                let value = read_varint(message, &mut cursor)?;
                if field_number == target_field_number {
                    return Some(ProtoField::Varint(value));
                }
            }
            2 => {
                let length = usize::try_from(read_varint(message, &mut cursor)?).ok()?;
                let end = cursor.checked_add(length)?;
                let value = message.get(cursor..end)?;
                cursor = end;
                if field_number == target_field_number {
                    return Some(ProtoField::LengthDelimited(value));
                }
            }
            _ => return None,
        }
    }

    None
}

fn read_varint(message: &[u8], cursor: &mut usize) -> Option<u64> {
    let mut value = 0u64;
    for shift in (0..64).step_by(7) {
        let byte = *message.get(*cursor)?;
        *cursor += 1;
        value |= u64::from(byte & 0x7f) << shift;
        if byte & 0x80 == 0 {
            return Some(value);
        }
    }

    None
}

enum ProtoField<'a> {
    LengthDelimited(&'a [u8]),
    Varint(u64),
}
