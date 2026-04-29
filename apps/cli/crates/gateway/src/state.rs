use onequery_core::error::CliError;

use crate::self_host::SelfHostConfig;
use crate::self_host::SelfHostRuntimePaths;
use crate::self_host::bootstrap_self_host_foundation;
use crate::self_host::load_self_host_config;
use crate::self_host::self_host_runtime_paths;

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
    pub(super) runtime_lease_present: bool,
    pub(super) runtime_status_snapshot_present: bool,
}

pub(super) fn resolve_runtime_state(
    command_line: &str,
    access_mode: GatewayStateAccessMode,
) -> Result<GatewayRuntimeState, CliError> {
    let paths = self_host_runtime_paths(command_line)?;
    let bootstrap_result = match access_mode {
        GatewayStateAccessMode::BootstrapIfMissing => {
            Some(bootstrap_self_host_foundation(&paths, command_line)?)
        }
        GatewayStateAccessMode::ReadOnly => None,
    };
    let config_created = bootstrap_result
        .as_ref()
        .is_some_and(|result| result.config_created);
    let secrets_created = bootstrap_result
        .as_ref()
        .is_some_and(|result| result.secrets_created);

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
        config_created,
        secrets_created,
        pglite_dir_present: paths.pglite_dir.is_dir(),
        log_file_present: paths.server_log_path.is_file(),
        runtime_lease_present: paths.runtime_lease_path.is_file(),
        runtime_status_snapshot_present: paths.runtime_status_snapshot_path.is_file(),
        paths,
        config,
    })
}
