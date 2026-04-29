#![expect(clippy::expect_used)]

use std::path::PathBuf;

use onequery_utils_absolute_path::AbsolutePathBuf;
pub use onequery_utils_absolute_path::test_support::PathBufExt;
pub use onequery_utils_absolute_path::test_support::PathExt;
use tempfile::TempDir;

pub mod process;
pub mod test_onequery;

pub fn test_path_buf_with_windows(unix_path: &str, windows_path: Option<&str>) -> PathBuf {
    if cfg!(windows) {
        if let Some(windows) = windows_path {
            PathBuf::from(windows)
        } else {
            let mut path = PathBuf::from(r"C:\");
            path.extend(
                unix_path
                    .trim_start_matches('/')
                    .split('/')
                    .filter(|segment| !segment.is_empty()),
            );
            path
        }
    } else {
        PathBuf::from(unix_path)
    }
}

pub fn test_path_buf(unix_path: &str) -> PathBuf {
    test_path_buf_with_windows(unix_path, /*windows_path*/ None)
}

pub fn test_absolute_path_with_windows(
    unix_path: &str,
    windows_path: Option<&str>,
) -> AbsolutePathBuf {
    AbsolutePathBuf::from_absolute_path(test_path_buf_with_windows(unix_path, windows_path))
        .expect("test path should be absolute")
}

pub fn test_absolute_path(unix_path: &str) -> AbsolutePathBuf {
    test_absolute_path_with_windows(unix_path, /*windows_path*/ None)
}

pub trait TempDirExt {
    fn abs(&self) -> AbsolutePathBuf;
}

impl TempDirExt for TempDir {
    fn abs(&self) -> AbsolutePathBuf {
        self.path().abs()
    }
}

pub fn test_tmp_path() -> AbsolutePathBuf {
    test_absolute_path_with_windows("/tmp", Some(r"C:\Users\onequery\AppData\Local\Temp"))
}

pub fn test_tmp_path_buf() -> PathBuf {
    test_tmp_path().into_path_buf()
}
