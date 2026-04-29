use std::path::Path;
use std::path::PathBuf;

const LAUNCH_CONFIG_FILENAME_PREFIX: &str = "launch-";
const LAUNCH_CONFIG_FILENAME_SUFFIX: &str = ".json";
const RUNTIME_CONTROL_SOCKET_FILENAME: &str = "runtime-control.sock";

pub(super) fn launch_config_path_for_launch(run_dir: &Path, launch_id: &str) -> PathBuf {
    run_dir.join(format!(
        "{LAUNCH_CONFIG_FILENAME_PREFIX}{}{LAUNCH_CONFIG_FILENAME_SUFFIX}",
        short_stable_hash(launch_id.as_bytes())
    ))
}

pub(super) fn runtime_control_socket_path_for_runtime(data_dir: &Path, run_dir: &Path) -> PathBuf {
    #[cfg(unix)]
    {
        let _ = run_dir;
        PathBuf::from("/tmp")
            .join(format!(
                "onequery-runtime-control-{}",
                path_stable_hash(data_dir)
            ))
            .join(RUNTIME_CONTROL_SOCKET_FILENAME)
    }

    #[cfg(not(unix))]
    {
        let _ = data_dir;
        run_dir.join(RUNTIME_CONTROL_SOCKET_FILENAME)
    }
}

pub(super) fn short_stable_hash(input: &[u8]) -> String {
    blake3::hash(input).to_hex()[..16].to_owned()
}

fn path_stable_hash(path: &Path) -> String {
    #[cfg(unix)]
    {
        use std::os::unix::ffi::OsStrExt as _;

        short_stable_hash(path.as_os_str().as_bytes())
    }

    #[cfg(not(unix))]
    {
        short_stable_hash(path.to_string_lossy().as_bytes())
    }
}

#[cfg(test)]
mod tests {
    #[cfg(unix)]
    use std::os::unix::ffi::OsStrExt as _;
    use std::path::Path;
    #[cfg(unix)]
    use std::path::PathBuf;

    use pretty_assertions::assert_ne;

    use super::launch_config_path_for_launch;
    #[cfg(unix)]
    use super::runtime_control_socket_path_for_runtime;

    #[test]
    fn launch_config_path_is_scoped_by_launch_id() {
        let run_dir = Path::new("/home/alice/.onequery/run");

        assert_ne!(
            launch_config_path_for_launch(run_dir, "launch-a"),
            launch_config_path_for_launch(run_dir, "launch-b")
        );
        assert!(
            launch_config_path_for_launch(run_dir, "launch-a")
                .file_name()
                .and_then(|value| value.to_str())
                .is_some_and(|value| value.starts_with("launch-") && value.ends_with(".json"))
        );
    }

    #[cfg(unix)]
    #[test]
    fn unix_runtime_control_socket_path_is_bounded_for_long_data_dirs() {
        let long_prefix = "x".repeat(240);
        let data_dir = PathBuf::from(format!("/tmp/{long_prefix}/.onequery"));
        let run_dir = data_dir.join("run");
        let socket_path =
            runtime_control_socket_path_for_runtime(data_dir.as_path(), run_dir.as_path());

        assert!(socket_path.as_os_str().as_bytes().len() < 100);
        assert!(
            socket_path
                .to_string_lossy()
                .starts_with("/tmp/onequery-runtime-control-")
        );
    }
}
