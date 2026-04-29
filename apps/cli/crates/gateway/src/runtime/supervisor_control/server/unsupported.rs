use std::error::Error;
use std::io;
use std::path::PathBuf;

use super::super::service::SupervisorControlService;

type SupervisorControlServerResult<T> = Result<T, Box<dyn Error + Send + Sync>>;

pub(crate) struct SupervisorControlServer;

impl SupervisorControlServer {
    pub(crate) async fn stop(self) -> SupervisorControlServerResult<()> {
        Err(supervisor_control_unsupported_error())
    }
}

pub(crate) async fn start_supervisor_control_server(
    _socket_path: PathBuf,
    _service: SupervisorControlService,
) -> SupervisorControlServerResult<SupervisorControlServer> {
    Err(supervisor_control_unsupported_error())
}

fn supervisor_control_unsupported_error() -> Box<dyn Error + Send + Sync> {
    Box::new(io::Error::new(
        io::ErrorKind::Unsupported,
        "supervisor control is not supported on Windows yet",
    ))
}
