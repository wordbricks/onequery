use onequery_cli_core::error::CliError;

use crate::config::self_host::SelfHostConfig;
use crate::config::self_host::SelfHostRuntimePaths;
use crate::config::self_host::bootstrap_self_host_foundation;
use crate::config::self_host::load_self_host_config;
use crate::config::self_host::self_host_runtime_paths;

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub(super) enum GatewayStateAccessMode {
    BootstrapIfMissing,
    ReadOnly,
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub(super) struct GatewayRuntimeState {
    pub(super) paths: SelfHostRuntimePaths,
    pub(super) bootstrapped: bool,
    pub(super) config_created: bool,
    pub(super) secrets_created: bool,
    pub(super) config: Option<SelfHostConfig>,
    pub(super) pglite_dir_present: bool,
    pub(super) log_file_present: bool,
    pub(super) pid_file_present: bool,
    pub(super) lock_file_present: bool,
}

pub(super) fn resolve_runtime_state(
    command_line: &str,
    access_mode: GatewayStateAccessMode,
) -> Result<GatewayRuntimeState, CliError> {
    let bootstrap_result = match access_mode {
        GatewayStateAccessMode::BootstrapIfMissing => {
            Some(bootstrap_self_host_foundation(command_line)?)
        }
        GatewayStateAccessMode::ReadOnly => None,
    };
    let paths = bootstrap_result
        .as_ref()
        .map(|result| result.paths.clone())
        .unwrap_or(self_host_runtime_paths(command_line)?);

    let config = if paths.config_path.is_file() && paths.secrets_path.is_file() {
        Some(load_self_host_config(command_line)?.config)
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
