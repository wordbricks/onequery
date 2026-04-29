use std::path::Path;
use std::path::PathBuf;

const LAUNCH_CONFIG_FILENAME_PREFIX: &str = "launch-";
const LAUNCH_CONFIG_FILENAME_SUFFIX: &str = ".json";
const SUPERVISOR_CONTROL_SOCKET_FILENAME: &str = "supervisor-control.sock";

pub(super) fn launch_config_path_for_launch(run_dir: &Path, launch_id: &str) -> PathBuf {
    run_dir.join(format!(
        "{LAUNCH_CONFIG_FILENAME_PREFIX}{}{LAUNCH_CONFIG_FILENAME_SUFFIX}",
        short_stable_hash(launch_id.as_bytes())
    ))
}

pub(super) fn supervisor_control_socket_path_for_runtime(
    data_dir: &Path,
    run_dir: &Path,
) -> PathBuf {
    #[cfg(unix)]
    {
        let _ = run_dir;
        PathBuf::from("/tmp")
            .join(format!(
                "onequery-supervisor-control-{}",
                path_stable_hash(data_dir)
            ))
            .join(SUPERVISOR_CONTROL_SOCKET_FILENAME)
    }

    #[cfg(not(unix))]
    {
        let _ = data_dir;
        run_dir.join(SUPERVISOR_CONTROL_SOCKET_FILENAME)
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

    use proptest::prelude::*;

    use super::launch_config_path_for_launch;
    use super::short_stable_hash;
    #[cfg(unix)]
    use super::supervisor_control_socket_path_for_runtime;

    proptest! {
        #[test]
        fn launch_config_path_is_scoped_by_launch_id(launch_id in any::<String>()) {
            let run_dir = Path::new("/home/alice/.onequery/run");
            let path = launch_config_path_for_launch(run_dir, &launch_id);
            let Some(file_name) = path
                .file_name()
                .and_then(|value| value.to_str())
            else {
                prop_assert!(false, "launch config path should have UTF-8 file name");
                return Ok(());
            };

            prop_assert_eq!(path.parent(), Some(run_dir));
            prop_assert!(file_name.starts_with("launch-"));
            prop_assert!(file_name.ends_with(".json"));
            prop_assert_eq!(file_name.len(), "launch-".len() + 16 + ".json".len());
        }

        #[test]
        fn short_stable_hash_is_bounded_hex(input in proptest::collection::vec(any::<u8>(), 0..512)) {
            let hash = short_stable_hash(&input);

            prop_assert_eq!(hash.len(), 16);
            prop_assert!(hash.bytes().all(|byte| byte.is_ascii_hexdigit()));
            prop_assert_eq!(hash, short_stable_hash(&input));
        }
    }

    #[cfg(unix)]
    #[test]
    fn unix_supervisor_control_socket_path_is_bounded_for_long_data_dirs() {
        let long_prefix = "x".repeat(240);
        let data_dir = PathBuf::from(format!("/tmp/{long_prefix}/.onequery"));
        let run_dir = data_dir.join("run");
        let socket_path =
            supervisor_control_socket_path_for_runtime(data_dir.as_path(), run_dir.as_path());

        assert!(socket_path.as_os_str().as_bytes().len() < 100);
        assert!(
            socket_path
                .to_string_lossy()
                .starts_with("/tmp/onequery-supervisor-control-")
        );
    }
}
