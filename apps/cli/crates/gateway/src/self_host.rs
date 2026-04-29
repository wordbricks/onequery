//! Self-host gateway configuration, paths, and launch contracts.

mod bootstrap;
mod config;
mod file_io;
mod launch_config;
mod paths;
mod secrets;

#[cfg(test)]
mod tests;

pub use self::bootstrap::SelfHostBootstrapResult;
pub use self::bootstrap::bootstrap_self_host_foundation;
pub use self::bootstrap::load_self_host_public_config;
pub use self::config::DEFAULT_SELF_HOST_LISTEN_HOST;
pub use self::config::DEFAULT_SELF_HOST_PORT;
pub use self::config::SelfHostConfig;
pub use self::config::ServerSection;
pub use self::config::SmtpConfig;
pub use self::config::default_port;
pub use self::config::default_public_origin;
pub use self::config::self_host_public_origin;
pub use self::paths::SelfHostRuntimePaths;
pub use self::paths::self_host_runtime_paths;

pub(crate) use self::bootstrap::load_self_host_config;
pub(crate) use self::launch_config::write_self_host_launch_config;
#[cfg(test)]
pub(crate) use self::paths::self_host_launch_config_path_for_launch;
