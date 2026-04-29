mod control;
mod lifecycle;
mod logs;
mod process;
mod shutdown;
mod status;
mod supervisor;
mod transport;

#[cfg(test)]
pub(crate) use control::RuntimeControlPhase;
pub(crate) use control::RuntimeControlStatus;
pub(crate) use control::read_live_runtime_status;
pub(crate) use control::request_runtime_control_stop;
pub(crate) use control::runtime_control_error_allows_fallback;
pub(crate) use lifecycle::read_managed_runtime_pid;
pub(crate) use logs::LogPreview;
pub(crate) use logs::read_log_preview;
pub(crate) use process::run_gateway_background;
pub(crate) use process::run_gateway_foreground;
pub(crate) use shutdown::stop_runtime;
pub(crate) use supervisor::run_gateway_supervisor;
