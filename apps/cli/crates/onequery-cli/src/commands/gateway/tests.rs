use std::fs;
use std::net::TcpListener;
use std::path::Path;
use std::path::PathBuf;

use insta::assert_snapshot;
use pretty_assertions::assert_eq;
use tempfile::tempdir;
use uuid::Uuid;

use crate::packaged_runtime::packaged_cli_relative_path;
use crate::packaged_runtime::packaged_server_relative_path;
use crate::packaged_runtime::runtime_root_env_var;

use super::PACKAGED_SERVER_BUNDLE_FILENAME;
use super::launch::RuntimeBundleRoot;
use super::launch::RuntimeBundleRootLocator;
use super::launch::RuntimeBundleRootSource;
use super::launch::resolve_runtime_bundle_root_from_locator;
use super::render::render_gateway_logs_output;
use super::render::render_gateway_output;
use super::render::render_gateway_start_output;
use super::render::render_gateway_status_output;
use super::runtime::LogPreview;
use super::runtime::mark_stop_requested;
use super::runtime::parse_runtime_major_version;
use super::runtime::stop_request_matches;
use super::runtime::validate_runtime_version_output;
use super::state::GatewayRuntimeState;
use super::state::GatewayStateAccessMode;
use crate::config::self_host::DEFAULT_SELF_HOST_LISTEN_HOST;
use crate::config::self_host::SelfHostConfig;
use crate::config::self_host::SelfHostRuntimePaths;
use crate::config::self_host::bootstrap_self_host_foundation_for_test;
use crate::config::self_host::default_port;
use crate::config::self_host::load_self_host_config_for_test;
use crate::config::self_host::write_self_host_launch_config_for_test;
use crate::local_target::runtime_accepting_connections;
use crate::local_target::runtime_probe_host;

fn sample_paths() -> SelfHostRuntimePaths {
    SelfHostRuntimePaths {
        config_dir: "/tmp/onequery/config/self-host".into(),
        data_dir: "/tmp/onequery/data".into(),
        config_path: "/tmp/onequery/config/self-host/config.toml".into(),
        secrets_path: "/tmp/onequery/config/self-host/secrets.toml".into(),
        pglite_dir: "/tmp/onequery/data/pglite/onequery".into(),
        logs_dir: "/tmp/onequery/data/logs".into(),
        server_log_path: "/tmp/onequery/data/logs/server.log".into(),
        backups_dir: "/tmp/onequery/data/backups".into(),
        run_dir: "/tmp/onequery/data/run".into(),
        pid_path: "/tmp/onequery/data/run/server.pid".into(),
        lock_path: "/tmp/onequery/data/run/server.lock".into(),
        stop_request_path: "/tmp/onequery/data/run/server.stop".into(),
        launch_config_path: "/tmp/onequery/data/run/launch.json".into(),
    }
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
        pid_file_present: false,
        lock_file_present: false,
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
fn render_gateway_status_output_treats_lock_without_runtime_state_as_stale_markers_snapshot() {
    let test_dir =
        std::env::temp_dir().join(format!("onequery-gateway-lock-status-{}", Uuid::new_v4()));
    let paths = SelfHostRuntimePaths::for_test(
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
        &paths.lock_path,
        format!(
            "{{\"pid\":{},\"acquiredAt\":\"2026-03-25T00:00:00.000Z\",\"dataDir\":\"{}\"}}\n",
            std::process::id(),
            paths.data_dir.display()
        ),
    )
    .unwrap_or_else(|error| panic!("expected lock fixture write to succeed: {error}"));

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
fn render_gateway_status_output_reports_running_from_lock_and_runtime_state_snapshot() {
    let test_dir =
        std::env::temp_dir().join(format!("onequery-gateway-lock-status-{}", Uuid::new_v4()));
    let paths = SelfHostRuntimePaths::for_test(
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
        &paths.lock_path,
        format!(
            "{{\"pid\":{},\"acquiredAt\":\"2026-03-25T00:00:00.000Z\",\"dataDir\":\"{}\"}}\n",
            std::process::id(),
            paths.data_dir.display()
        ),
    )
    .unwrap_or_else(|error| panic!("expected lock fixture write to succeed: {error}"));
    fs::write(
        paths.run_dir.join("server.state.json"),
        format!(
            "{{\"pid\":{},\"phase\":\"ready\",\"updatedAt\":\"2026-03-25T00:00:00.000Z\",\"dataDir\":\"{}\"}}\n",
            std::process::id(),
            paths.data_dir.display()
        ),
    )
    .unwrap_or_else(|error| panic!("expected state fixture write to succeed: {error}"));

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
                    crate::config::self_host::default_public_origin()
                ),
                "[api] GET /api/health 200".to_owned(),
            ],
            truncated: false,
        },
    );
    assert_snapshot!(output.lines.join("\n"));
}

#[test]
fn runtime_state_json_reports_marker_status_when_pid_or_lock_is_present() {
    let state = GatewayRuntimeState {
        pid_file_present: true,
        ..sample_state()
    };

    assert_eq!(
        super::render::runtime_state_json(&state)
            .get("status")
            .and_then(serde_json::Value::as_str),
        Some("stale_markers")
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
fn gateway_bootstrap_creates_phase_two_foundation_and_reports_it() {
    let test_dir = std::env::temp_dir().join(format!("onequery-gateway-proof-{}", Uuid::new_v4()));
    let paths = SelfHostRuntimePaths::for_test(
        test_dir.join("config").join("self-host"),
        test_dir.join("data"),
    );

    let state = resolve_runtime_state_with_paths_for_test(
        paths.clone(),
        GatewayStateAccessMode::BootstrapIfMissing,
        "onequery gateway",
    )
    .unwrap_or_else(|error| panic!("expected gateway bootstrap to succeed: {error}"));

    assert_eq!(state.bootstrapped, true);
    assert_eq!(state.config_created, true);
    assert_eq!(state.secrets_created, true);
    assert_eq!(state.config, Some(SelfHostConfig::default()));
    assert_eq!(paths.config_path.is_file(), true);
    assert_eq!(paths.secrets_path.is_file(), true);
    assert_eq!(paths.logs_dir.is_dir(), true);
    assert_eq!(paths.backups_dir.is_dir(), true);
    assert_eq!(paths.run_dir.is_dir(), true);

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
    let paths = SelfHostRuntimePaths::for_test(
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

    let launch_config_path = write_self_host_launch_config_for_test(
        state.paths,
        &asset_dir,
        &migrations_dir,
        "onequery gateway",
    )
    .unwrap_or_else(|error| panic!("expected gateway launch config write to succeed: {error}"));
    let launch_config_contents = fs::read_to_string(&launch_config_path)
        .unwrap_or_else(|error| panic!("expected launch config read to succeed: {error}"));
    let launch_config: serde_json::Value = serde_json::from_str(&launch_config_contents)
        .unwrap_or_else(|error| panic!("expected launch config JSON to parse: {error}"));

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
        launch_config.get("publicOrigin"),
        Some(&serde_json::Value::String(
            crate::config::self_host::default_public_origin(),
        ))
    );

    fs::remove_dir_all(test_dir)
        .unwrap_or_else(|error| panic!("expected gateway proof temp dir cleanup: {error}"));
}

#[test]
fn mark_stop_requested_records_pid_for_managed_shutdown() {
    let test_dir =
        std::env::temp_dir().join(format!("onequery-gateway-stop-request-{}", Uuid::new_v4()));
    let stop_request_path = test_dir.join("server.stop");

    fs::create_dir_all(&test_dir)
        .unwrap_or_else(|error| panic!("expected temp dir creation to succeed: {error}"));

    mark_stop_requested(stop_request_path.as_path(), 4321, "onequery gateway stop")
        .unwrap_or_else(|error| panic!("expected stop request write to succeed: {error}"));

    assert_eq!(
        stop_request_matches(stop_request_path.as_path(), 4321),
        true
    );

    fs::remove_dir_all(test_dir)
        .unwrap_or_else(|error| panic!("expected stop-request temp dir cleanup: {error}"));
}

#[test]
fn parse_runtime_major_version_accepts_node_style_version_output() {
    assert_eq!(parse_runtime_major_version("v22.13.1\n"), Some(22));
    assert_eq!(parse_runtime_major_version("22.13.1\n"), Some(22));
}

#[test]
fn parse_runtime_major_version_rejects_invalid_version_output() {
    assert_eq!(parse_runtime_major_version(""), None);
    assert_eq!(parse_runtime_major_version("lts"), None);
}

#[test]
fn runtime_probe_host_normalizes_unspecified_bind_addresses() {
    assert_eq!(runtime_probe_host("0.0.0.0"), "127.0.0.1");
    assert_eq!(runtime_probe_host("::"), "::1");
    assert_eq!(runtime_probe_host("localhost"), "localhost");
}

#[test]
fn runtime_accepting_connections_treats_unspecified_ipv4_bind_as_localhost() {
    let listener = TcpListener::bind(("127.0.0.1", 0))
        .unwrap_or_else(|error| panic!("expected test listener bind to succeed: {error}"));
    let port = listener
        .local_addr()
        .unwrap_or_else(|error| panic!("expected test listener local addr: {error}"))
        .port();

    assert_eq!(runtime_accepting_connections("0.0.0.0", port), true);
}

#[test]
fn validate_runtime_version_output_rejects_node_20() {
    let error = validate_runtime_version_output(
        "v20.19.0\n",
        &std::ffi::OsString::from("node"),
        "onequery gateway",
        "onequery gateway",
    )
    .expect_err("expected Node 20 to be rejected");

    assert_eq!(error.title.as_str(), "unsupported self-host server runtime");
    assert_eq!(
        error.why.as_str(),
        "node reports major version 20, but packaged onequery gateway requires Node.js 22+"
    );
    assert_eq!(
        error.try_next,
        vec!["install Node.js 22+ and retry onequery gateway".to_owned()]
    );
}

#[test]
fn validate_runtime_version_output_accepts_node_22() {
    validate_runtime_version_output(
        "v22.13.1\n",
        &std::ffi::OsString::from("node"),
        "onequery gateway",
        "onequery gateway",
    )
    .unwrap_or_else(|error| panic!("expected Node 22 to be accepted: {error}"));
}

fn resolve_runtime_state_with_paths_for_test(
    paths: SelfHostRuntimePaths,
    access_mode: GatewayStateAccessMode,
    command_line: &str,
) -> Result<GatewayRuntimeState, onequery_cli_core::error::CliError> {
    let bootstrap_result = match access_mode {
        GatewayStateAccessMode::BootstrapIfMissing => Some(
            bootstrap_self_host_foundation_for_test(paths.clone(), command_line)?,
        ),
        GatewayStateAccessMode::ReadOnly => None,
    };

    let config = if paths.config_path.is_file() && paths.secrets_path.is_file() {
        Some(load_self_host_config_for_test(paths.clone(), command_line)?.config)
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
        pid_file_present: paths.pid_path.is_file(),
        lock_file_present: paths.lock_path.is_file(),
        paths,
        config,
    })
}
