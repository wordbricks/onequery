use std::net::IpAddr;
use std::net::TcpStream;
use std::net::ToSocketAddrs;
use std::path::PathBuf;
use std::time::Duration;

use onequery_cli_core::error::CliError;
use onequery_cli_core::error::ErrorStage;
use url::Url;

use crate::commands::CommandContext;
use crate::config::self_host::DEFAULT_SELF_HOST_LISTEN_HOST;
use crate::config::self_host::DEFAULT_SELF_HOST_PORT;
use crate::config::self_host::SelfHostConfig;
use crate::config::self_host::SelfHostRuntimePaths;
use crate::config::self_host::default_public_origin;
use crate::config::self_host::load_self_host_public_config_with_paths;
use crate::config::self_host::self_host_public_origin;
use crate::config::self_host::self_host_runtime_paths;

const LOCAL_CONNECTION_PROBE_TIMEOUT_MS: u64 = 100;
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
    config: Option<SelfHostConfig>,
}

pub(crate) fn runtime_accepting_connections(listen_host: &str, listen_port: u16) -> bool {
    let timeout = Duration::from_millis(LOCAL_CONNECTION_PROBE_TIMEOUT_MS);

    (runtime_probe_host(listen_host), listen_port)
        .to_socket_addrs()
        .ok()
        .into_iter()
        .flatten()
        .any(|address| TcpStream::connect_timeout(&address, timeout).is_ok())
}

pub(crate) fn runtime_probe_host(listen_host: &str) -> &str {
    match listen_host {
        "0.0.0.0" => "127.0.0.1",
        "::" => "::1",
        _ => listen_host,
    }
}

pub(crate) fn managed_gateway_unavailable_error(
    context: &CommandContext,
    stage: ErrorStage,
) -> Option<CliError> {
    let target = managed_gateway_target_for_base_url(&context.command_line, &context.base_url)?;
    if runtime_accepting_connections(&target.listen_host, target.port) {
        return None;
    }

    Some(gateway_unavailable_error(context, stage, &target))
}

fn gateway_unavailable_error(
    context: &CommandContext,
    stage: ErrorStage,
    target: &ManagedGatewayTarget,
) -> CliError {
    let probe_host = runtime_probe_host(&target.listen_host);
    let mut try_next = vec![
        GATEWAY_START_COMMAND.to_owned(),
        GATEWAY_STATUS_COMMAND.to_owned(),
    ];
    if target.log_path.is_file() {
        try_next.push(GATEWAY_LOGS_COMMAND.to_owned());
    }
    try_next.push(format!("retry {}", context.command_line));

    CliError::new(
        "self-host gateway is not running",
        context.command_line.clone(),
        stage,
        format!(
            "{} is configured as the CLI server, but no process is accepting connections on {probe_host}:{}",
            context.base_url, target.port
        ),
        try_next,
    )
    .with_code(Some("self_host_gateway_unavailable".to_owned()))
}

fn managed_gateway_target_for_base_url(
    command_line: &str,
    base_url: &str,
) -> Option<ManagedGatewayTarget> {
    let paths = self_host_runtime_paths(command_line).ok()?;
    let config = if paths.config_path.is_file() {
        // Comment: localhost gateway guidance is additive. A broken self-host config should not
        // mask the original API failure for commands that merely happen to target a local origin.
        load_self_host_public_config_with_paths(&paths, command_line).ok()
    } else {
        None
    };

    managed_gateway_target(base_url, &SelfHostTargetState { paths, config })
}

fn managed_gateway_target(
    base_url: &str,
    state: &SelfHostTargetState,
) -> Option<ManagedGatewayTarget> {
    let target_url = Url::parse(base_url).ok()?;
    if !target_host_is_loopback(&target_url) {
        return None;
    }

    let candidate = state.config.as_ref().map_or_else(
        || ManagedGatewayTarget {
            listen_host: DEFAULT_SELF_HOST_LISTEN_HOST.to_owned(),
            port: DEFAULT_SELF_HOST_PORT,
            public_origin: default_public_origin(),
            log_path: state.paths.server_log_path.clone(),
        },
        |config| ManagedGatewayTarget {
            listen_host: config.server.listen_host.clone(),
            port: config.server.port,
            public_origin: self_host_public_origin(config),
            log_path: state.paths.server_log_path.clone(),
        },
    );

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

    use insta::assert_snapshot;
    use pretty_assertions::assert_eq;
    use uuid::Uuid;

    use crate::commands::ResolvedOrgSource;
    use crate::config::self_host::SelfHostRuntimePaths;
    use crate::output::EffectiveOutputMode;
    use crate::output::render_error;

    use super::CommandContext;
    use super::DEFAULT_SELF_HOST_LISTEN_HOST;
    use super::DEFAULT_SELF_HOST_PORT;
    use super::ErrorStage;
    use super::ManagedGatewayTarget;
    use super::SelfHostConfig;
    use super::SelfHostTargetState;
    use super::gateway_unavailable_error;
    use super::managed_gateway_target;
    use super::managed_gateway_unavailable_error;

    fn target_state(
        paths: SelfHostRuntimePaths,
        config: Option<SelfHostConfig>,
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
        SelfHostRuntimePaths::for_test(config_dir, data_dir)
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

    #[test]
    fn managed_gateway_target_matches_default_self_host_origin_without_config() {
        let paths = test_paths();
        let target =
            managed_gateway_target("http://127.0.0.1:5656", &target_state(paths.clone(), None));

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
        let target = managed_gateway_target(
            "http://127.0.0.1:7777",
            &target_state(
                paths.clone(),
                Some(SelfHostConfig {
                    server: crate::config::self_host::ServerSection {
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
        let target = managed_gateway_target(
            "https://onequery.example.com",
            &target_state(test_paths(), None),
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

        assert_snapshot!(render_error(&error, EffectiveOutputMode::Text));
    }

    #[test]
    fn managed_gateway_unavailable_error_skips_non_gateway_targets() {
        let error = managed_gateway_unavailable_error(
            &test_context("https://onequery.example.com", "onequery auth login"),
            ErrorStage::Auth,
        );

        assert_eq!(error.is_none(), true);
    }
}
