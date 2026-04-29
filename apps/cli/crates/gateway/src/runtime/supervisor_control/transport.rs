use std::path::Path;
use std::path::PathBuf;

pub(super) const SUPERVISOR_CONTROL_SOCKET_FILE_NAME: &str = "supervisor-control.sock";

pub(super) fn supervisor_control_socket_path(runtime_dir: &Path) -> PathBuf {
    runtime_dir.join(SUPERVISOR_CONTROL_SOCKET_FILE_NAME)
}
