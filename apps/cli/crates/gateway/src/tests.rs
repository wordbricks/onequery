use std::fs;
use std::path::Path;
use std::path::PathBuf;

use insta::assert_snapshot;
use pretty_assertions::assert_eq;
use tempfile::tempdir;
use uuid::Uuid;

use onequery_core::packaged_runtime::packaged_cli_relative_path;
use onequery_core::packaged_runtime::packaged_server_relative_path;
use onequery_core::packaged_runtime::runtime_root_env_var;

use super::PACKAGED_SERVER_BUNDLE_FILENAME;
use super::launch::RuntimeBundleRoot;
use super::launch::RuntimeBundleRootLocator;
use super::launch::RuntimeBundleRootSource;
use super::launch::resolve_runtime_bundle_root_from_locator;
use super::render::render_gateway_logs_output;
use super::render::render_gateway_output;
use super::render::render_gateway_start_output;
use super::render::render_gateway_status_output;
use super::render::render_gateway_status_output_with_live_status;
use super::runtime::LogPreview;
use super::runtime::RuntimeControlStatus;
use super::state::GatewayRuntimeState;
use super::state::GatewayStateAccessMode;
use crate::runtime_control::types;
use crate::runtime_probe_host;
use crate::self_host::DEFAULT_SELF_HOST_LISTEN_HOST;
use crate::self_host::SelfHostConfig;
use crate::self_host::SelfHostRuntimePaths;
use crate::self_host::bootstrap_self_host_foundation;
use crate::self_host::default_port;
use crate::self_host::load_self_host_config;
use crate::self_host::self_host_launch_config_path_for_launch;
use crate::self_host::write_self_host_launch_config;

fn sample_paths() -> SelfHostRuntimePaths {
    SelfHostRuntimePaths::from_dirs(
        "/tmp/onequery/config/self-host".into(),
        "/tmp/onequery/data".into(),
    )
}

fn sample_state() -> GatewayRuntimeState {
    GatewayRuntimeState {
        paths: sample_paths(),
        bootstrapped: true,
        config_created: true,
        secrets_created: true,
        config: Some(SelfHostConfig::default()),
        pglite_dir_present: false,
        log_file_present: false,
        runtime_lease_present: false,
        runtime_status_snapshot_present: false,
    }
}

#[test]
fn render_gateway_output_snapshot() {
    let output = render_gateway_output(&sample_state());
    assert_snapshot!(output.lines.join("\n"));
}

#[test]
fn render_gateway_start_output_snapshot() {
    let output = render_gateway_start_output(&sample_state(), 4242);
    assert_snapshot!(output.lines.join("\n"));
}

#[test]
fn render_gateway_status_output_snapshot() {
    let output = render_gateway_status_output(&sample_state());
    assert_snapshot!(output.lines.join("\n"));
}

#[test]
fn render_gateway_status_output_prefers_live_runtime_control_phase() {
    let live_status = RuntimeControlStatus {
        pid: Some(4242),
        launch_id: Some("launch-a".to_owned()),
        data_dir: Some("/tmp/onequery-data".to_owned()),
        phase: types::RuntimePhase::RUNTIME_PHASE_READY,
        runtime_sequence: Some(17),
    };

    let output = render_gateway_status_output_with_live_status(&sample_state(), Some(&live_status));
    assert_eq!(output.lines[3], "Runtime: ready");

    let data = output.into_data();

    assert_eq!(
        data.pointer("/runtimeState/status")
            .and_then(serde_json::Value::as_str),
        Some("ready")
    );
    assert_eq!(data.pointer("/runtimeState/running"), None);
    assert_eq!(data.pointer("/runtimeState/runtimeControlReachable"), None);
    assert_eq!(
        data.pointer("/runtimeState/runtimePid")
            .and_then(serde_json::Value::as_u64),
        Some(4242)
    );
    assert_eq!(
        data.pointer("/runtimeState/runtimeSequence")
            .and_then(serde_json::Value::as_u64),
        Some(17)
    );
}

fn runtime_lease_json(paths: &SelfHostRuntimePaths, pid: u32, launch_id: &str) -> String {
    format!(
        r#"{{
  "header": {{
    "schemaVersion": 1,
    "writer": {{"writer": "LIFECYCLE_RECORD_WRITER_RUNTIME", "writerId": "runtime:{pid}"}},
    "launch": {{"launchId": "{launch_id}", "dataDir": "{}", "runtimePid": {pid}, "supervisorPid": 1, "supervisorGeneration": "1"}},
    "writtenAt": "2026-03-25T00:00:00Z"
  }},
  "runtime": {{"pid": {pid}, "launchId": "{launch_id}", "dataDir": "{}"}},
  "supervisor": {{"supervisorId": "supervisor-a", "pid": 1, "generation": "1"}},
  "runtimeSequence": "1",
  "acquiredAt": "2026-03-25T00:00:00Z",
  "renewedAt": "2026-03-25T00:00:00Z",
  "leaseTtl": "60s"
}}"#,
        paths.data_dir.display(),
        paths.data_dir.display()
    )
}

fn runtime_status_snapshot_json(paths: &SelfHostRuntimePaths, pid: u32, launch_id: &str) -> String {
    format!(
        r#"{{
  "header": {{
    "schemaVersion": 1,
    "writer": {{"writer": "LIFECYCLE_RECORD_WRITER_RUNTIME", "writerId": "runtime:{pid}"}},
    "launch": {{"launchId": "{launch_id}", "dataDir": "{}", "runtimePid": {pid}, "supervisorPid": 1, "supervisorGeneration": "1"}},
    "writtenAt": "2026-03-25T00:00:00Z"
  }},
  "status": {{
    "identity": {{"pid": {pid}, "launchId": "{launch_id}", "dataDir": "{}"}},
    "phase": "RUNTIME_PHASE_READY",
    "runtimeSequence": "1",
    "updatedAt": "2026-03-25T00:00:00Z"
  }},
  "snapshotAt": "2026-03-25T00:00:00Z"
}}"#,
        paths.data_dir.display(),
        paths.data_dir.display()
    )
}

#[test]
fn render_gateway_status_output_reports_running_from_lease_without_status_snapshot() {
    let test_dir =
        std::env::temp_dir().join(format!("onequery-gateway-lease-status-{}", Uuid::new_v4()));
    let paths = SelfHostRuntimePaths::from_dirs(
        test_dir.join("config").join("self-host"),
        test_dir.join("data"),
    );

    resolve_runtime_state_with_paths_for_test(
        paths.clone(),
        GatewayStateAccessMode::BootstrapIfMissing,
        "onequery gateway",
    )
    .unwrap_or_else(|error| panic!("expected gateway bootstrap to succeed: {error}"));
    fs::write(
        &paths.runtime_lease_path,
        runtime_lease_json(&paths, std::process::id(), "launch-a"),
    )
    .unwrap_or_else(|error| panic!("expected lease fixture write to succeed: {error}"));

    let state = resolve_runtime_state_with_paths_for_test(
        paths,
        GatewayStateAccessMode::ReadOnly,
        "onequery gateway",
    )
    .unwrap_or_else(|error| panic!("expected gateway state read to succeed: {error}"));
    let output = render_gateway_status_output(&state);
    assert_snapshot!(output.lines.join("\n"));

    fs::remove_dir_all(test_dir)
        .unwrap_or_else(|error| panic!("expected gateway proof temp dir cleanup: {error}"));
}

#[test]
fn render_gateway_status_output_reports_running_from_lease_and_runtime_status_snapshot() {
    let test_dir =
        std::env::temp_dir().join(format!("onequery-gateway-lease-status-{}", Uuid::new_v4()));
    let paths = SelfHostRuntimePaths::from_dirs(
        test_dir.join("config").join("self-host"),
        test_dir.join("data"),
    );

    resolve_runtime_state_with_paths_for_test(
        paths.clone(),
        GatewayStateAccessMode::BootstrapIfMissing,
        "onequery gateway",
    )
    .unwrap_or_else(|error| panic!("expected gateway bootstrap to succeed: {error}"));
    fs::write(
        &paths.runtime_lease_path,
        runtime_lease_json(&paths, std::process::id(), "launch-a"),
    )
    .unwrap_or_else(|error| panic!("expected lease fixture write to succeed: {error}"));
    fs::write(
        &paths.runtime_status_snapshot_path,
        runtime_status_snapshot_json(&paths, std::process::id(), "launch-a"),
    )
    .unwrap_or_else(|error| panic!("expected status snapshot fixture write to succeed: {error}"));

    let state = resolve_runtime_state_with_paths_for_test(
        paths,
        GatewayStateAccessMode::ReadOnly,
        "onequery gateway",
    )
    .unwrap_or_else(|error| panic!("expected gateway state read to succeed: {error}"));
    let output = render_gateway_status_output(&state);
    assert_snapshot!(output.lines.join("\n"));

    fs::remove_dir_all(test_dir)
        .unwrap_or_else(|error| panic!("expected gateway proof temp dir cleanup: {error}"));
}

#[test]
fn render_gateway_status_output_omits_dead_log_level_json() {
    let output = render_gateway_status_output(&sample_state());
    let data = output.into_data();

    assert_eq!(data.pointer("/server/logLevel"), None);
}

#[test]
fn render_gateway_logs_output_snapshot() {
    let output = render_gateway_logs_output(
        &GatewayRuntimeState {
            log_file_present: true,
            ..sample_state()
        },
        &LogPreview {
            lines: vec![
                format!(
                    "[onequery-server] listening on {}",
                    crate::self_host::default_public_origin()
                ),
                "[api] GET /api/health 200".to_owned(),
            ],
            truncated: false,
        },
    );
    assert_snapshot!(output.lines.join("\n"));
}

#[test]
fn runtime_state_json_reports_stale_durable_records_when_lease_or_snapshot_is_present() {
    let state = GatewayRuntimeState {
        runtime_lease_present: true,
        ..sample_state()
    };

    assert_eq!(
        super::render::runtime_state_json(&state)
            .get("status")
            .and_then(serde_json::Value::as_str),
        Some("stale_durable_records")
    );
}

#[test]
fn resolve_runtime_bundle_root_from_locator_accepts_runtime_root_override() {
    let runtime_root_override = Path::new("/tmp/staged-runtime");
    let resolved = resolve_runtime_bundle_root_from_locator(
        RuntimeBundleRootLocator::EnvironmentOverride(runtime_root_override),
        "onequery gateway",
    )
    .expect("expected runtime root override to resolve");

    assert_eq!(
        resolved,
        RuntimeBundleRoot {
            path: runtime_root_override.to_path_buf(),
            source: RuntimeBundleRootSource::EnvironmentOverride,
        }
    );
}

#[test]
fn resolve_runtime_bundle_root_from_locator_uses_packaged_executable_layout() {
    let current_executable = PathBuf::from(format!(
        "/tmp/vendor/x86_64-unknown-linux-musl/{}/onequery",
        packaged_cli_relative_path()
    ));
    let resolved = resolve_runtime_bundle_root_from_locator(
        RuntimeBundleRootLocator::CurrentExecutable(current_executable.as_path()),
        "onequery gateway",
    )
    .expect("expected packaged executable layout to resolve");

    assert_eq!(
        resolved,
        RuntimeBundleRoot {
            path: Path::new("/tmp/vendor/x86_64-unknown-linux-musl").to_path_buf(),
            source: RuntimeBundleRootSource::PackagedExecutable,
        }
    );
}

#[test]
fn resolve_runtime_bundle_root_from_locator_reports_cargo_output_guidance() {
    let error = resolve_runtime_bundle_root_from_locator(
        RuntimeBundleRootLocator::CurrentExecutable(Path::new(
            "/tmp/project/target/aarch64-apple-darwin/ci-release/onequery",
        )),
        "onequery gateway",
    )
    .expect_err("expected Cargo output guidance");

    assert_eq!(
        error.title.as_str(),
        "failed to resolve self-host runtime bundle"
    );
    assert_eq!(
        error.why.as_str(),
        format!(
            "current executable /tmp/project/target/aarch64-apple-darwin/ci-release/onequery was launched from Cargo output; set {} to a staged self-host runtime bundle root",
            runtime_root_env_var()
        )
    );
    assert_eq!(
        error.try_next,
        vec![format!(
            "set {}=<bundle-root> and retry onequery gateway",
            runtime_root_env_var()
        )]
    );
}

#[test]
fn packaged_server_bundle_uses_single_cross_platform_filename() {
    let temp_dir = tempdir().unwrap();
    let server_dir = temp_dir.path().join(packaged_server_relative_path());
    fs::create_dir_all(&server_dir)
        .unwrap_or_else(|error| panic!("expected packaged server dir: {error}"));

    assert_eq!(
        server_dir.join(PACKAGED_SERVER_BUNDLE_FILENAME),
        temp_dir
            .path()
            .join(packaged_server_relative_path())
            .join("onequery-server.mjs")
    );
}

#[test]
fn gateway_bootstrap_creates_self_host_foundation_and_reports_it() {
    let test_dir = std::env::temp_dir().join(format!("onequery-gateway-proof-{}", Uuid::new_v4()));
    let paths = SelfHostRuntimePaths::from_dirs(
        test_dir.join("config").join("self-host"),
        test_dir.join("data"),
    );

    let state = resolve_runtime_state_with_paths_for_test(
        paths.clone(),
        GatewayStateAccessMode::BootstrapIfMissing,
        "onequery gateway",
    )
    .unwrap_or_else(|error| panic!("expected gateway bootstrap to succeed: {error}"));

    assert!(state.bootstrapped);
    assert!(state.config_created);
    assert!(state.secrets_created);
    assert_eq!(state.config, Some(SelfHostConfig::default()));
    assert!(paths.config_path.is_file());
    assert!(paths.secrets_path.is_file());
    assert!(paths.logs_dir.is_dir());
    assert!(paths.backups_dir.is_dir());
    assert!(paths.releases_dir.is_dir());
    assert!(paths.recovery_points_dir.is_dir());
    assert!(paths.run_dir.is_dir());

    let output = render_gateway_output(&state);
    let data = output.into_data();

    assert_eq!(
        data.get("kind").and_then(serde_json::Value::as_str),
        Some("gateway")
    );
    assert_eq!(
        data.get("bootstrapped")
            .and_then(serde_json::Value::as_bool),
        Some(true)
    );
    assert_eq!(
        data.pointer("/paths/configPath")
            .and_then(serde_json::Value::as_str),
        Some(paths.config_path.to_string_lossy().as_ref())
    );
    assert_eq!(
        data.pointer("/runtimeState/status")
            .and_then(serde_json::Value::as_str),
        Some("not_running")
    );

    fs::remove_dir_all(test_dir)
        .unwrap_or_else(|error| panic!("expected gateway proof temp dir cleanup: {error}"));
}

#[test]
fn gateway_writes_launch_contract_with_default_self_host_port() {
    let test_dir = std::env::temp_dir().join(format!("onequery-gateway-launch-{}", Uuid::new_v4()));
    let paths = SelfHostRuntimePaths::from_dirs(
        test_dir.join("config").join("self-host"),
        test_dir.join("data"),
    );
    let asset_dir = test_dir.join("runtime").join("web");
    let migrations_dir = test_dir.join("runtime").join("migrations");

    fs::create_dir_all(&asset_dir)
        .unwrap_or_else(|error| panic!("expected asset dir creation to succeed: {error}"));

    let state = resolve_runtime_state_with_paths_for_test(
        paths,
        GatewayStateAccessMode::BootstrapIfMissing,
        "onequery gateway",
    )
    .unwrap_or_else(|error| panic!("expected gateway bootstrap to succeed: {error}"));

    let launch_config_path = write_self_host_launch_config(
        &state.paths,
        "onequery gateway",
        &asset_dir,
        &migrations_dir,
        "launch-a",
    )
    .unwrap_or_else(|error| panic!("expected gateway launch config write to succeed: {error}"));
    let launch_config_contents = fs::read_to_string(&launch_config_path)
        .unwrap_or_else(|error| panic!("expected launch config read to succeed: {error}"));
    let launch_config: serde_json::Value = serde_json::from_str(&launch_config_contents)
        .unwrap_or_else(|error| panic!("expected launch config JSON to parse: {error}"));

    assert_eq!(
        launch_config_path,
        self_host_launch_config_path_for_launch(&state.paths, "launch-a")
    );
    assert_eq!(
        launch_config.pointer("/listen/host"),
        Some(&serde_json::Value::String(
            DEFAULT_SELF_HOST_LISTEN_HOST.to_owned(),
        ))
    );
    assert_eq!(
        launch_config.pointer("/listen/port"),
        Some(&serde_json::Value::Number(default_port().into()))
    );
    assert_eq!(
        launch_config.get("launchId"),
        Some(&serde_json::Value::String("launch-a".to_owned()))
    );
    assert_eq!(
        launch_config.pointer("/runtimeControl/transport/kind"),
        Some(&serde_json::Value::String("unix".to_owned()))
    );
    assert_eq!(
        launch_config.pointer("/runtimeControl/transport/socketPath"),
        Some(&serde_json::Value::String(
            state
                .paths
                .runtime_control_socket_path
                .display()
                .to_string(),
        ))
    );
    assert_eq!(
        launch_config.get("publicOrigin"),
        Some(&serde_json::Value::String(
            crate::self_host::default_public_origin(),
        ))
    );

    fs::remove_dir_all(test_dir)
        .unwrap_or_else(|error| panic!("expected gateway proof temp dir cleanup: {error}"));
}

#[test]
fn runtime_probe_host_normalizes_unspecified_bind_addresses() {
    assert_eq!(runtime_probe_host("0.0.0.0"), "127.0.0.1");
    assert_eq!(runtime_probe_host("::"), "::1");
    assert_eq!(runtime_probe_host("localhost"), "localhost");
}

fn resolve_runtime_state_with_paths_for_test(
    paths: SelfHostRuntimePaths,
    access_mode: GatewayStateAccessMode,
    command_line: &str,
) -> Result<GatewayRuntimeState, onequery_core::error::CliError> {
    let bootstrap_result = match access_mode {
        GatewayStateAccessMode::BootstrapIfMissing => {
            Some(bootstrap_self_host_foundation(&paths, command_line)?)
        }
        GatewayStateAccessMode::ReadOnly => None,
    };

    let config = if paths.config_path.is_file() && paths.secrets_path.is_file() {
        Some(load_self_host_config(&paths, command_line)?.config)
    } else {
        None
    };

    Ok(GatewayRuntimeState {
        bootstrapped: paths.config_path.is_file()
            && paths.secrets_path.is_file()
            && paths.config_dir.is_dir()
            && paths.data_dir.is_dir(),
        config_created: bootstrap_result
            .as_ref()
            .map(|result| result.config_created)
            .unwrap_or(false),
        secrets_created: bootstrap_result
            .as_ref()
            .map(|result| result.secrets_created)
            .unwrap_or(false),
        pglite_dir_present: paths.pglite_dir.is_dir(),
        log_file_present: paths.server_log_path.is_file(),
        runtime_lease_present: paths.runtime_lease_path.is_file(),
        runtime_status_snapshot_present: paths.runtime_status_snapshot_path.is_file(),
        paths,
        config,
    })
}
