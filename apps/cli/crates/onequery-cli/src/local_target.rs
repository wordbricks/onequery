use std::net::IpAddr;
use std::path::PathBuf;

use onequery_cli_core::error::CliError;
use onequery_cli_core::error::ErrorStage;
use url::Url;

use crate::commands::CommandContext;
pub(crate) use onequery_gateway::runtime_accepting_connections;
use onequery_gateway::runtime_probe_host;
use onequery_gateway::self_host::DEFAULT_SELF_HOST_LISTEN_HOST;
use onequery_gateway::self_host::DEFAULT_SELF_HOST_PORT;
use onequery_gateway::self_host::SelfHostConfig;
use onequery_gateway::self_host::SelfHostRuntimePaths;
use onequery_gateway::self_host::default_public_origin;
use onequery_gateway::self_host::load_self_host_public_config;
use onequery_gateway::self_host::self_host_public_origin;
use onequery_gateway::self_host::self_host_runtime_paths;

const GATEWAY_START_COMMAND: &str = "onequery gateway start";
const GATEWAY_STATUS_COMMAND: &str = "onequery gateway status";
const GATEWAY_LOGS_COMMAND: &str = "onequery gateway logs";

#[derive(Debug, Clone, Eq, PartialEq)]
struct ManagedGatewayTarget {
    listen_host: String,
    port: u16,
    public_origin: String,
    log_path: PathBuf,
}

#[derive(Debug, Clone, Eq, PartialEq)]
struct SelfHostTargetState {
    paths: SelfHostRuntimePaths,
    config: SelfHostTargetConfig,
}

#[derive(Debug, Clone, Eq, PartialEq)]
enum SelfHostTargetConfig {
    Missing,
    Loaded(SelfHostConfig),
}

pub(crate) fn managed_gateway_unavailable_error(
    context: &CommandContext,
    stage: ErrorStage,
) -> Result<Option<CliError>, CliError> {
    let target_url = match Url::parse(&context.base_url) {
        Ok(target_url) => target_url,
        Err(_) => return Ok(None),
    };
    if !target_host_is_loopback(&target_url) {
        return Ok(None);
    }

    managed_gateway_unavailable_error_with_probe(
        context,
        stage,
        self_host_runtime_paths(&context.command_line)?,
        runtime_accepting_connections,
    )
}

pub(crate) fn managed_gateway_recovery_try_next(
    context: &CommandContext,
) -> Result<Option<Vec<String>>, CliError> {
    let target_url = match Url::parse(&context.base_url) {
        Ok(target_url) => target_url,
        Err(_) => return Ok(None),
    };
    if !target_host_is_loopback(&target_url) {
        return Ok(None);
    }

    managed_gateway_recovery_try_next_with_paths(
        context,
        self_host_runtime_paths(&context.command_line)?,
        runtime_accepting_connections,
    )
}

fn managed_gateway_unavailable_error_with_probe<F>(
    context: &CommandContext,
    stage: ErrorStage,
    paths: SelfHostRuntimePaths,
    runtime_accepting_connections: F,
) -> Result<Option<CliError>, CliError>
where
    F: Fn(&str, u16) -> bool,
{
    let Some(target) = managed_gateway_target_for_base_url_with_paths(
        &context.base_url,
        paths,
        &context.command_line,
    )?
    else {
        return Ok(None);
    };

    if runtime_accepting_connections(&target.listen_host, target.port) {
        return Ok(None);
    }

    Ok(Some(gateway_unavailable_error(context, stage, &target)))
}

fn managed_gateway_recovery_try_next_with_paths<F>(
    context: &CommandContext,
    paths: SelfHostRuntimePaths,
    runtime_accepting_connections: F,
) -> Result<Option<Vec<String>>, CliError>
where
    F: Fn(&str, u16) -> bool,
{
    let Some(target) = managed_gateway_target_for_base_url_with_paths(
        &context.base_url,
        paths,
        &context.command_line,
    )?
    else {
        return Ok(None);
    };

    if runtime_accepting_connections(&target.listen_host, target.port) {
        return Ok(None);
    }

    Ok(Some(managed_gateway_try_next(&target, None)))
}

fn gateway_unavailable_error(
    context: &CommandContext,
    stage: ErrorStage,
    target: &ManagedGatewayTarget,
) -> CliError {
    let probe_host = runtime_probe_host(&target.listen_host);
    CliError::new(
        "self-host gateway is not running",
        context.command_line.clone(),
        stage,
        format!(
            "{} is configured as the CLI server, but no process is accepting connections on {probe_host}:{}",
            context.base_url, target.port
        ),
        managed_gateway_try_next(target, Some(context.command_line.as_str())),
    )
    .with_code(Some("self_host_gateway_unavailable".to_owned()))
}

fn managed_gateway_try_next(
    target: &ManagedGatewayTarget,
    retry_command: Option<&str>,
) -> Vec<String> {
    let mut try_next = vec![
        GATEWAY_START_COMMAND.to_owned(),
        GATEWAY_STATUS_COMMAND.to_owned(),
    ];
    if target.log_path.is_file() {
        try_next.push(GATEWAY_LOGS_COMMAND.to_owned());
    }
    if let Some(retry_command) = retry_command {
        try_next.push(format!("retry {retry_command}"));
    }
    try_next
}

fn managed_gateway_target_for_base_url_with_paths(
    base_url: &str,
    paths: SelfHostRuntimePaths,
    command_line: &str,
) -> Result<Option<ManagedGatewayTarget>, CliError> {
    let target_url = match Url::parse(base_url) {
        Ok(target_url) => target_url,
        Err(_) => return Ok(None),
    };
    if !target_host_is_loopback(&target_url) {
        return Ok(None);
    }

    let state = load_self_host_target_state(paths, command_line)?;
    Ok(managed_gateway(base_url, &state))
}

fn load_self_host_target_state(
    paths: SelfHostRuntimePaths,
    command_line: &str,
) -> Result<SelfHostTargetState, CliError> {
    let config = if paths.config_path.is_file() {
        // Comment: keep self-host config loading strict here so transport-path callers can surface
        // invalid managed-gateway config directly. Callers using gateway probing only as additive
        // recovery guidance should downgrade these errors at their boundary.
        SelfHostTargetConfig::Loaded(load_self_host_public_config(&paths, command_line)?)
    } else {
        SelfHostTargetConfig::Missing
    };

    Ok(SelfHostTargetState { paths, config })
}

fn managed_gateway(base_url: &str, state: &SelfHostTargetState) -> Option<ManagedGatewayTarget> {
    let target_url = Url::parse(base_url).ok()?;

    let candidate = match &state.config {
        SelfHostTargetConfig::Missing => ManagedGatewayTarget {
            listen_host: DEFAULT_SELF_HOST_LISTEN_HOST.to_owned(),
            port: DEFAULT_SELF_HOST_PORT,
            public_origin: default_public_origin(),
            log_path: state.paths.server_log_path.clone(),
        },
        SelfHostTargetConfig::Loaded(config) => ManagedGatewayTarget {
            listen_host: config.server.listen_host.clone(),
            port: config.server.port,
            public_origin: self_host_public_origin(config),
            log_path: state.paths.server_log_path.clone(),
        },
    };

    if target_matches_managed_gateway(&target_url, &candidate) {
        return Some(candidate);
    }

    None
}

fn target_host_is_loopback(target_url: &Url) -> bool {
    target_url
        .host_str()
        .is_some_and(is_loopback_or_localhost_host)
}

fn target_matches_managed_gateway(target_url: &Url, candidate: &ManagedGatewayTarget) -> bool {
    target_matches_public_origin(target_url, &candidate.public_origin)
        || target_matches_runtime_endpoint(target_url, &candidate.listen_host, candidate.port)
}

fn target_matches_public_origin(target_url: &Url, public_origin: &str) -> bool {
    let public_origin = match Url::parse(public_origin) {
        Ok(public_origin) => public_origin,
        Err(_) => return false,
    };
    let Some(target_host) = target_url.host_str() else {
        return false;
    };
    let Some(public_host) = public_origin.host_str() else {
        return false;
    };

    target_url.scheme() == public_origin.scheme()
        && target_url.port_or_known_default() == public_origin.port_or_known_default()
        && hosts_match_local_target(target_host, public_host)
}

fn target_matches_runtime_endpoint(target_url: &Url, listen_host: &str, listen_port: u16) -> bool {
    if target_url.scheme() != "http" || target_url.port_or_known_default() != Some(listen_port) {
        return false;
    }

    let Some(target_host) = target_url.host_str() else {
        return false;
    };

    hosts_match_local_target(target_host, runtime_probe_host(listen_host))
}

fn hosts_match_local_target(target_host: &str, expected_host: &str) -> bool {
    if target_host.eq_ignore_ascii_case(expected_host) {
        return true;
    }

    if target_host.eq_ignore_ascii_case("localhost") {
        return matches!(expected_host, "127.0.0.1" | "::1");
    }

    if expected_host.eq_ignore_ascii_case("localhost") {
        return matches!(target_host, "127.0.0.1" | "::1");
    }

    false
}

fn is_loopback_or_localhost_host(host: &str) -> bool {
    host.eq_ignore_ascii_case("localhost")
        || host
            .parse::<IpAddr>()
            .is_ok_and(|address| address.is_loopback())
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::net::TcpListener;

    use insta::assert_snapshot;
    use pretty_assertions::assert_eq;
    use uuid::Uuid;

    use crate::commands::ResolvedOrgSource;
    use crate::output::EffectiveOutputMode;
    use crate::output::render_error;
    use onequery_gateway::self_host::SelfHostRuntimePaths;

    use super::CommandContext;
    use super::DEFAULT_SELF_HOST_LISTEN_HOST;
    use super::DEFAULT_SELF_HOST_PORT;
    use super::ErrorStage;
    use super::ManagedGatewayTarget;
    use super::SelfHostConfig;
    use super::SelfHostTargetConfig;
    use super::SelfHostTargetState;
    use super::gateway_unavailable_error;
    use super::managed_gateway;
    use super::managed_gateway_recovery_try_next_with_paths;
    use super::managed_gateway_unavailable_error;
    use super::managed_gateway_unavailable_error_with_probe;
    use super::runtime_accepting_connections;

    fn target_state(
        paths: SelfHostRuntimePaths,
        config: SelfHostTargetConfig,
    ) -> SelfHostTargetState {
        SelfHostTargetState { paths, config }
    }

    fn test_paths() -> SelfHostRuntimePaths {
        let root =
            std::env::temp_dir().join(format!("onequery-local-target-test-{}", Uuid::new_v4()));
        let config_dir = root.join("config");
        let data_dir = root.join("data");
        fs::create_dir_all(&config_dir)
            .unwrap_or_else(|error| panic!("expected config dir creation to succeed: {error}"));
        fs::create_dir_all(&data_dir)
            .unwrap_or_else(|error| panic!("expected data dir creation to succeed: {error}"));
        SelfHostRuntimePaths::from_dirs(config_dir, data_dir)
    }

    fn test_context(base_url: &str, command_line: &str) -> CommandContext {
        CommandContext {
            command_line: command_line.to_owned(),
            base_url: base_url.to_owned(),
            request_id: None,
            resolved_org: None,
            resolved_org_source: ResolvedOrgSource::None,
            verbose: false,
        }
    }

    fn unused_local_port() -> u16 {
        TcpListener::bind((DEFAULT_SELF_HOST_LISTEN_HOST, 0))
            .unwrap_or_else(|error| panic!("expected test TCP listener to bind: {error}"))
            .local_addr()
            .unwrap_or_else(|error| panic!("expected test TCP listener local addr: {error}"))
            .port()
    }

    fn write_public_config(paths: &SelfHostRuntimePaths, port: u16) {
        fs::write(
            &paths.config_path,
            format!("[server]\nlisten_host = \"{DEFAULT_SELF_HOST_LISTEN_HOST}\"\nport = {port}\n"),
        )
        .unwrap_or_else(|error| panic!("expected config write to succeed: {error}"));
    }

    #[test]
    fn managed_gateway_target_matches_default_self_host_origin_without_config() {
        let paths = test_paths();
        let target = managed_gateway(
            "http://127.0.0.1:5656",
            &target_state(paths.clone(), SelfHostTargetConfig::Missing),
        );

        assert_eq!(
            target,
            Some(ManagedGatewayTarget {
                listen_host: DEFAULT_SELF_HOST_LISTEN_HOST.to_owned(),
                port: DEFAULT_SELF_HOST_PORT,
                public_origin: "http://127.0.0.1:5656".to_owned(),
                log_path: paths.server_log_path,
            })
        );
    }

    #[test]
    fn managed_gateway_target_matches_custom_local_runtime_endpoint_when_public_origin_is_remote() {
        let paths = test_paths();
        let target = managed_gateway(
            "http://127.0.0.1:7777",
            &target_state(
                paths.clone(),
                SelfHostTargetConfig::Loaded(SelfHostConfig {
                    server: onequery_gateway::self_host::ServerSection {
                        listen_host: "127.0.0.1".to_owned(),
                        port: 7777,
                        public_origin: Some("https://onequery.example.com".to_owned()),
                    },
                    smtp: Default::default(),
                }),
            ),
        );

        assert_eq!(
            target,
            Some(ManagedGatewayTarget {
                listen_host: "127.0.0.1".to_owned(),
                port: 7777,
                public_origin: "https://onequery.example.com".to_owned(),
                log_path: paths.server_log_path,
            })
        );
    }

    #[test]
    fn managed_gateway_target_rejects_remote_origin() {
        let target = managed_gateway(
            "https://onequery.example.com",
            &target_state(test_paths(), SelfHostTargetConfig::Missing),
        );

        assert_eq!(target, None);
    }

    #[test]
    fn managed_gateway_unavailable_error_snapshot_guides_gateway_start_for_local_targets() {
        let context = test_context("http://127.0.0.1:5656", "onequery auth login");
        let error = gateway_unavailable_error(
            &context,
            ErrorStage::Auth,
            &ManagedGatewayTarget {
                listen_host: "127.0.0.1".to_owned(),
                port: 5656,
                public_origin: "http://127.0.0.1:5656".to_owned(),
                log_path: test_paths().server_log_path,
            },
        );

        crate::test_support::snapshot_settings_with_issue_url_filter()
            .bind(|| assert_snapshot!(render_error(&error, EffectiveOutputMode::Text)));
    }

    #[test]
    fn managed_gateway_recovery_try_next_guides_start_without_retry_command() {
        let paths = test_paths();
        let port = unused_local_port();
        let base_url = format!("http://{DEFAULT_SELF_HOST_LISTEN_HOST}:{port}");
        write_public_config(&paths, port);

        let try_next = managed_gateway_recovery_try_next_with_paths(
            &test_context(
                &base_url,
                "onequery query exec --source warehouse --sql \"select 1\"",
            ),
            paths,
            // Comment: test guidance should not depend on whether a developer already has a local
            // gateway or some unrelated process listening on a well-known port.
            |_, _| false,
        )
        .unwrap_or_else(|error| panic!("expected gateway recovery lookup to succeed: {error}"))
        .expect("expected gateway recovery guidance for local target");

        assert_eq!(
            try_next,
            vec![
                "onequery gateway start".to_owned(),
                "onequery gateway status".to_owned(),
            ]
        );
    }

    #[test]
    fn managed_gateway_unavailable_error_skips_non_gateway_targets() {
        let error = managed_gateway_unavailable_error(
            &test_context("https://onequery.example.com", "onequery auth login"),
            ErrorStage::Auth,
        )
        .unwrap_or_else(|error| panic!("expected non-gateway target check to succeed: {error}"));

        assert_eq!(error.is_none(), true);
    }

    #[test]
    fn managed_gateway_unavailable_error_reports_invalid_self_host_config_snapshot() {
        let paths = test_paths();
        let config_path = paths.config_path.display().to_string();
        fs::write(
            &paths.config_path,
            "[server]\nlisten_host = \"127.0.0.1\"\nport = 5656\nlog_level = \"debug\"\n",
        )
        .unwrap_or_else(|error| panic!("expected config write to succeed: {error}"));

        let error = managed_gateway_unavailable_error_with_probe(
            &test_context("http://127.0.0.1:5656", "onequery auth login"),
            ErrorStage::Auth,
            paths,
            runtime_accepting_connections,
        )
        .expect_err("expected invalid self-host config to fail");

        let rendered =
            render_error(&error, EffectiveOutputMode::Text).replace(&config_path, "<CONFIG_PATH>");

        crate::test_support::snapshot_settings_with_issue_url_filter()
            .bind(|| assert_snapshot!(rendered));
    }
}
