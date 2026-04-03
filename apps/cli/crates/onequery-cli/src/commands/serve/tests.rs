use std::fs;
use std::path::Path;
use std::path::PathBuf;

use insta::assert_snapshot;
use pretty_assertions::assert_eq;
use tempfile::tempdir;
use uuid::Uuid;

use super::PACKAGED_SERVER_FILENAME;
use super::PACKAGED_SERVER_MUSL_FILENAME;
use super::PACKAGED_SERVER_WINDOWS_FILENAME;
use super::launch::RuntimeBundleRoot;
use super::launch::RuntimeBundleRootSource;
use super::launch::current_executable_is_cargo_build_output;
use super::launch::packaged_cli_relative_path;
use super::launch::packaged_server_candidates;
use super::launch::packaged_server_relative_path;
use super::launch::resolve_runtime_bundle_root_from_components;
use super::launch::runtime_root_env_var;
use super::launch::select_packaged_server_candidate;
use super::render::render_serve_logs_output;
use super::render::render_serve_output;
use super::render::render_serve_start_output;
use super::render::render_serve_status_output;
use super::runtime::LogPreview;
use super::runtime::mark_stop_requested;
use super::runtime::stop_request_matches;
use super::state::ServeRuntimeState;
use super::state::ServeStateAccessMode;
use crate::config::self_host::DEFAULT_SELF_HOST_LISTEN_HOST;
use crate::config::self_host::SelfHostConfig;
use crate::config::self_host::SelfHostRuntimePaths;
use crate::config::self_host::bootstrap_self_host_foundation_for_test;
use crate::config::self_host::default_port;
use crate::config::self_host::load_self_host_config_for_test;
use crate::config::self_host::write_self_host_launch_config_for_test;

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

fn sample_state() -> ServeRuntimeState {
    ServeRuntimeState {
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
fn render_serve_output_snapshot() {
    let output = render_serve_output(&sample_state());
    assert_snapshot!(output.lines.join("\n"));
}

#[test]
fn render_serve_start_output_snapshot() {
    let output = render_serve_start_output(&sample_state());
    assert_snapshot!(output.lines.join("\n"));
}

#[test]
fn render_serve_status_output_snapshot() {
    let output = render_serve_status_output(&sample_state());
    assert_snapshot!(output.lines.join("\n"));
}

#[test]
fn render_serve_status_output_omits_dead_log_level_json() {
    let output = render_serve_status_output(&sample_state());
    let data = output.into_data();

    assert_eq!(data.pointer("/server/logLevel"), None);
}

#[test]
fn render_serve_logs_output_snapshot() {
    let output = render_serve_logs_output(
        &ServeRuntimeState {
            log_file_present: true,
            ..sample_state()
        },
        &LogPreview {
            lines: vec![
                format!(
                    "[bun-server] listening on {}",
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
    let state = ServeRuntimeState {
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
fn resolve_runtime_bundle_root_from_components_prefers_runtime_root_override() {
    let current_executable = PathBuf::from(format!(
        "/tmp/vendor/x86_64-unknown-linux-musl/{}/onequery",
        packaged_cli_relative_path()
    ));
    let runtime_root_override = Path::new("/tmp/staged-runtime");
    let resolved = resolve_runtime_bundle_root_from_components(
        Some(runtime_root_override),
        current_executable.as_path(),
        "onequery serve",
    )
    .expect("expected runtime root override to win");

    assert_eq!(
        resolved,
        RuntimeBundleRoot {
            path: runtime_root_override.to_path_buf(),
            source: RuntimeBundleRootSource::EnvironmentOverride,
        }
    );
}

#[test]
fn resolve_runtime_bundle_root_from_components_uses_packaged_executable_without_override() {
    let current_executable = PathBuf::from(format!(
        "/tmp/vendor/x86_64-unknown-linux-musl/{}/onequery",
        packaged_cli_relative_path()
    ));
    let resolved = resolve_runtime_bundle_root_from_components(
        None,
        current_executable.as_path(),
        "onequery serve",
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
fn current_executable_is_cargo_build_output_detects_standard_debug_binary_path() {
    assert_eq!(
        current_executable_is_cargo_build_output(Path::new("/tmp/project/target/debug/onequery")),
        true
    );
}

#[test]
fn resolve_runtime_bundle_root_from_components_reports_cargo_output_guidance() {
    let error = resolve_runtime_bundle_root_from_components(
        None,
        Path::new("/tmp/project/target/debug/onequery"),
        "onequery serve",
    )
    .expect_err("expected Cargo output guidance");

    assert_eq!(
        error.title.as_str(),
        "failed to resolve self-host runtime bundle"
    );
    assert_eq!(
        error.why.as_str(),
        format!(
            "current executable /tmp/project/target/debug/onequery was launched from Cargo output; set {} to a staged self-host runtime bundle root",
            runtime_root_env_var()
        )
    );
    assert_eq!(
        error.try_next,
        vec![format!(
            "set {}=<bundle-root> and retry onequery serve",
            runtime_root_env_var()
        )]
    );
}

#[test]
fn select_packaged_server_candidate_prefers_glibc_binary_when_loader_exists() {
    let temp_dir = tempdir().unwrap();
    let server_dir = temp_dir.path().join(packaged_server_relative_path());
    fs::create_dir_all(&server_dir)
        .unwrap_or_else(|error| panic!("expected packaged server dir: {error}"));
    fs::write(server_dir.join(PACKAGED_SERVER_FILENAME), b"")
        .unwrap_or_else(|error| panic!("expected glibc server binary: {error}"));
    fs::write(server_dir.join(PACKAGED_SERVER_MUSL_FILENAME), b"")
        .unwrap_or_else(|error| panic!("expected musl server binary: {error}"));

    let candidates = packaged_server_candidates(server_dir.as_path(), "linux", "x86_64").unwrap();
    let existing_candidates = candidates.iter().collect::<Vec<_>>();
    let selected = select_packaged_server_candidate(&existing_candidates, |loader_path| {
        loader_path == Path::new("/lib64/ld-linux-x86-64.so.2")
    })
    .unwrap_or_else(|| panic!("expected glibc packaged server executable"));

    assert_eq!(selected.path, server_dir.join(PACKAGED_SERVER_FILENAME));
}

#[test]
fn select_packaged_server_candidate_falls_back_to_musl_binary() {
    let temp_dir = tempdir().unwrap();
    let server_dir = temp_dir.path().join(packaged_server_relative_path());
    fs::create_dir_all(&server_dir)
        .unwrap_or_else(|error| panic!("expected packaged server dir: {error}"));
    fs::write(server_dir.join(PACKAGED_SERVER_FILENAME), b"")
        .unwrap_or_else(|error| panic!("expected glibc server binary: {error}"));
    fs::write(server_dir.join(PACKAGED_SERVER_MUSL_FILENAME), b"")
        .unwrap_or_else(|error| panic!("expected musl server binary: {error}"));

    let candidates = packaged_server_candidates(server_dir.as_path(), "linux", "x86_64").unwrap();
    let existing_candidates = candidates.iter().collect::<Vec<_>>();
    let selected = select_packaged_server_candidate(&existing_candidates, |loader_path| {
        loader_path == Path::new("/lib/ld-musl-x86_64.so.1")
    })
    .unwrap_or_else(|| panic!("expected musl packaged server executable"));

    assert_eq!(
        selected.path,
        server_dir.join(PACKAGED_SERVER_MUSL_FILENAME)
    );
}

#[test]
fn packaged_server_candidates_use_windows_executable_name() {
    let temp_dir = tempdir().unwrap();
    let server_dir = temp_dir.path().join(packaged_server_relative_path());
    fs::create_dir_all(&server_dir)
        .unwrap_or_else(|error| panic!("expected packaged server dir: {error}"));

    let candidates = packaged_server_candidates(server_dir.as_path(), "windows", "x86_64").unwrap();

    assert_eq!(candidates.len(), 1);
    assert_eq!(
        candidates[0].path,
        server_dir.join(PACKAGED_SERVER_WINDOWS_FILENAME)
    );
}

#[test]
fn serve_bootstrap_creates_phase_two_foundation_and_reports_it() {
    let test_dir = std::env::temp_dir().join(format!("onequery-serve-proof-{}", Uuid::new_v4()));
    let paths = SelfHostRuntimePaths::for_test(
        test_dir.join("config").join("self-host"),
        test_dir.join("data"),
    );

    let state = resolve_runtime_state_with_paths_for_test(
        paths.clone(),
        ServeStateAccessMode::BootstrapIfMissing,
        "onequery serve",
    )
    .unwrap_or_else(|error| panic!("expected serve bootstrap to succeed: {error}"));

    assert_eq!(state.bootstrapped, true);
    assert_eq!(state.config_created, true);
    assert_eq!(state.secrets_created, true);
    assert_eq!(state.config, Some(SelfHostConfig::default()));
    assert_eq!(paths.config_path.is_file(), true);
    assert_eq!(paths.secrets_path.is_file(), true);
    assert_eq!(paths.logs_dir.is_dir(), true);
    assert_eq!(paths.backups_dir.is_dir(), true);
    assert_eq!(paths.run_dir.is_dir(), true);

    let output = render_serve_output(&state);
    let data = output.into_data();

    assert_eq!(
        data.get("kind").and_then(serde_json::Value::as_str),
        Some("serve")
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
        .unwrap_or_else(|error| panic!("expected serve proof temp dir cleanup: {error}"));
}

#[test]
fn serve_writes_launch_contract_with_default_self_host_port() {
    let test_dir = std::env::temp_dir().join(format!("onequery-serve-launch-{}", Uuid::new_v4()));
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
        ServeStateAccessMode::BootstrapIfMissing,
        "onequery serve",
    )
    .unwrap_or_else(|error| panic!("expected serve bootstrap to succeed: {error}"));

    let launch_config_path = write_self_host_launch_config_for_test(
        state.paths,
        &asset_dir,
        &migrations_dir,
        "onequery serve",
    )
    .unwrap_or_else(|error| panic!("expected serve launch config write to succeed: {error}"));
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
        .unwrap_or_else(|error| panic!("expected serve proof temp dir cleanup: {error}"));
}

#[test]
fn mark_stop_requested_records_pid_for_managed_shutdown() {
    let test_dir =
        std::env::temp_dir().join(format!("onequery-serve-stop-request-{}", Uuid::new_v4()));
    let stop_request_path = test_dir.join("server.stop");

    fs::create_dir_all(&test_dir)
        .unwrap_or_else(|error| panic!("expected temp dir creation to succeed: {error}"));

    mark_stop_requested(stop_request_path.as_path(), 4321, "onequery serve stop")
        .unwrap_or_else(|error| panic!("expected stop request write to succeed: {error}"));

    assert_eq!(
        stop_request_matches(stop_request_path.as_path(), 4321),
        true
    );

    fs::remove_dir_all(test_dir)
        .unwrap_or_else(|error| panic!("expected stop-request temp dir cleanup: {error}"));
}

fn resolve_runtime_state_with_paths_for_test(
    paths: SelfHostRuntimePaths,
    access_mode: ServeStateAccessMode,
    command_line: &str,
) -> Result<ServeRuntimeState, onequery_cli_core::error::CliError> {
    let bootstrap_result = match access_mode {
        ServeStateAccessMode::BootstrapIfMissing => Some(bootstrap_self_host_foundation_for_test(
            paths.clone(),
            command_line,
        )?),
        ServeStateAccessMode::ReadOnly => None,
    };

    let config = if paths.config_path.is_file() && paths.secrets_path.is_file() {
        Some(load_self_host_config_for_test(paths.clone(), command_line)?.config)
    } else {
        None
    };

    Ok(ServeRuntimeState {
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
