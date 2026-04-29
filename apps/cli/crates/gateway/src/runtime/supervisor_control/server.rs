#[cfg(unix)]
mod unix;
#[cfg(not(unix))]
mod unsupported;

#[cfg(unix)]
pub(crate) use unix::SupervisorControlServer;
#[cfg(unix)]
pub(crate) use unix::start_supervisor_control_server;
#[cfg(not(unix))]
pub(crate) use unsupported::SupervisorControlServer;
#[cfg(not(unix))]
pub(crate) use unsupported::start_supervisor_control_server;
