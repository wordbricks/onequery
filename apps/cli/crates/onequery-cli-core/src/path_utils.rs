//! Shared path normalization and private filesystem write helpers.

use std::borrow::Cow;
use std::collections::HashSet;
use std::fmt;
use std::io;
use std::path::Display;
use std::path::Path;
use std::path::PathBuf;

use crate::error::CliError;
use crate::error::ErrorStage;
use dirs::home_dir;
use path_absolutize::Absolutize;
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;
use tempfile::NamedTempFile;

#[derive(Debug, Clone, Eq, PartialEq)]
/// Absolute path buffer normalized for CLI input semantics.
pub struct AbsolutePathBuf(PathBuf);

impl AbsolutePathBuf {
    fn normalize_cli_input_path(path: &Path) -> PathBuf {
        let normalized = normalize_windows_path_for_wsl(path);
        Self::maybe_expand_home_directory(&normalized)
    }

    fn maybe_expand_home_directory(path: &Path) -> PathBuf {
        let Some(path_str) = path.to_str() else {
            return path.to_path_buf();
        };

        if cfg!(not(target_os = "windows"))
            && let Some(home) = home_dir()
        {
            if path_str == "~" {
                return home;
            }
            if let Some(rest) = path_str.strip_prefix("~/") {
                let rest = rest.trim_start_matches('/');
                if rest.is_empty() {
                    return home;
                }
                return home.join(rest);
            }
        }

        path.to_path_buf()
    }

    /// Resolves `path` against `base_path`, preserving absolute paths.
    pub fn resolve_path_against_base<P: AsRef<Path>, B: AsRef<Path>>(
        path: P,
        base_path: B,
    ) -> io::Result<Self> {
        let normalized_path = Self::normalize_cli_input_path(path.as_ref());
        let absolute_path = normalized_path.absolutize_from(base_path.as_ref())?;
        Ok(Self(absolute_path.into_owned()))
    }

    /// Normalizes a path and returns its absolute form.
    pub fn from_absolute_path<P: AsRef<Path>>(path: P) -> io::Result<Self> {
        let normalized_path = Self::normalize_cli_input_path(path.as_ref());
        let absolute_path = normalized_path.absolutize()?;
        Ok(Self(absolute_path.into_owned()))
    }

    /// Resolves the current working directory.
    pub fn current_dir() -> io::Result<Self> {
        Self::from_absolute_path(std::env::current_dir()?)
    }

    /// Resolves a child path against this absolute path.
    pub fn join<P: AsRef<Path>>(&self, path: P) -> io::Result<Self> {
        Self::resolve_path_against_base(path, &self.0)
    }

    /// Returns this path's parent when present.
    pub fn parent(&self) -> Option<Self> {
        self.0.parent().map(|path| {
            debug_assert!(
                path.is_absolute(),
                "parent of AbsolutePathBuf must be absolute"
            );
            Self(path.to_path_buf())
        })
    }

    /// Returns this path as a [`Path`].
    pub fn as_path(&self) -> &Path {
        &self.0
    }

    /// Converts this absolute path into a [`PathBuf`].
    pub fn into_path_buf(self) -> PathBuf {
        self.0
    }

    /// Clones this absolute path into a [`PathBuf`].
    pub fn to_path_buf(&self) -> PathBuf {
        self.0.clone()
    }

    /// Returns this path as a lossy string.
    pub fn to_string_lossy(&self) -> Cow<'_, str> {
        self.0.to_string_lossy()
    }

    /// Returns a display adapter for this path.
    pub fn display(&self) -> Display<'_> {
        self.0.display()
    }
}

impl AsRef<Path> for AbsolutePathBuf {
    fn as_ref(&self) -> &Path {
        &self.0
    }
}

impl From<AbsolutePathBuf> for PathBuf {
    fn from(path: AbsolutePathBuf) -> Self {
        path.into_path_buf()
    }
}

impl TryFrom<&Path> for AbsolutePathBuf {
    type Error = io::Error;

    fn try_from(value: &Path) -> Result<Self, Self::Error> {
        Self::from_absolute_path(value)
    }
}

impl TryFrom<PathBuf> for AbsolutePathBuf {
    type Error = io::Error;

    fn try_from(value: PathBuf) -> Result<Self, Self::Error> {
        Self::from_absolute_path(value)
    }
}

impl TryFrom<&str> for AbsolutePathBuf {
    type Error = io::Error;

    fn try_from(value: &str) -> Result<Self, Self::Error> {
        Self::from_absolute_path(value)
    }
}

impl TryFrom<String> for AbsolutePathBuf {
    type Error = io::Error;

    fn try_from(value: String) -> Result<Self, Self::Error> {
        Self::from_absolute_path(value)
    }
}

fn is_wsl() -> bool {
    #[cfg(target_os = "linux")]
    {
        if std::env::var_os("WSL_DISTRO_NAME").is_some() {
            return true;
        }

        match std::fs::read_to_string("/proc/version") {
            Ok(version) => version.to_lowercase().contains("microsoft"),
            Err(_) => false,
        }
    }
    #[cfg(not(target_os = "linux"))]
    {
        false
    }
}

fn normalize_windows_path_for_wsl(path: &Path) -> PathBuf {
    normalize_windows_path_for_wsl_with_flag(path, is_wsl())
}

fn normalize_windows_path_for_wsl_with_flag(path: &Path, is_wsl: bool) -> PathBuf {
    if !is_wsl {
        return path.to_path_buf();
    }

    let Some(path_str) = path.to_str() else {
        return path.to_path_buf();
    };

    match win_path_to_wsl(path_str) {
        Some(mapped_path) => PathBuf::from(mapped_path),
        None => path.to_path_buf(),
    }
}

fn win_path_to_wsl(path: &str) -> Option<String> {
    let bytes = path.as_bytes();
    if bytes.len() < 3
        || bytes[1] != b':'
        || !(bytes[2] == b'\\' || bytes[2] == b'/')
        || !bytes[0].is_ascii_alphabetic()
    {
        return None;
    }

    let drive = (bytes[0] as char).to_ascii_lowercase();
    let tail = path[3..].replace('\\', "/");
    if tail.is_empty() {
        return Some(format!("/mnt/{drive}"));
    }

    Some(format!("/mnt/{drive}/{tail}"))
}

/// Resolves a user-supplied CLI path into an absolute path or a structured CLI error.
pub fn resolve_user_path_for_cli(
    path: &Path,
    command_line: &str,
    stage: ErrorStage,
    title: impl Into<String>,
    try_next: Vec<String>,
) -> Result<PathBuf, CliError> {
    match AbsolutePathBuf::from_absolute_path(path) {
        Ok(path) => Ok(path.into_path_buf()),
        Err(error) => Err(CliError::new(
            title,
            command_line,
            stage,
            format!("{error} ({})", path.display()),
            try_next,
        )),
    }
}

/// Resolves and validates a directory supplied through an environment variable.
pub fn resolve_env_directory_for_cli(
    env_name: &str,
    path: &Path,
    command_line: &str,
    stage: ErrorStage,
    title: &str,
    try_next: Vec<String>,
) -> Result<PathBuf, CliError> {
    let resolved_path =
        resolve_user_path_for_cli(path, command_line, stage, title, try_next.clone())?;
    let build_error = |why: String| {
        CliError::new(
            title.to_owned(),
            command_line.to_owned(),
            stage,
            why,
            try_next.clone(),
        )
    };

    let metadata = std::fs::metadata(&resolved_path).map_err(|error| match error.kind() {
        io::ErrorKind::NotFound => build_error(format!(
            "{env_name} points to {}, but that path does not exist",
            resolved_path.display()
        )),
        _ => build_error(format!(
            "failed to read {env_name} {}: {error}",
            resolved_path.display()
        )),
    })?;

    if !metadata.is_dir() {
        return Err(build_error(format!(
            "{env_name} points to {}, but that path is not a directory",
            resolved_path.display()
        )));
    }

    resolved_path.canonicalize().map_err(|error| {
        build_error(format!(
            "failed to canonicalize {env_name} {}: {error}",
            resolved_path.display()
        ))
    })
}

#[derive(Debug, Clone, Eq, PartialEq)]
/// Resolved paths used for writes that should follow existing symlinks.
pub struct SymlinkWritePaths {
    /// Path to read when it could be resolved.
    pub read_path: Option<PathBuf>,
    /// Path to write atomically.
    pub write_path: PathBuf,
}

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
/// Stage where an atomic write failed.
pub enum AtomicWriteStage {
    /// The temporary file write failed.
    Write,
    /// The temporary file could not be persisted to the target.
    Finalize,
}

#[derive(Debug)]
/// Error returned by [`write_atomically`].
pub struct AtomicWriteError {
    stage: AtomicWriteStage,
    error: io::Error,
}

impl AtomicWriteError {
    fn new(stage: AtomicWriteStage, error: io::Error) -> Self {
        Self { stage, error }
    }

    /// Returns the stage that produced the write error.
    pub fn stage(&self) -> AtomicWriteStage {
        self.stage
    }
}

impl fmt::Display for AtomicWriteError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.error)
    }
}

impl std::error::Error for AtomicWriteError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        Some(&self.error)
    }
}

/// Resolves the target path for a write while preserving valid symlinks.
pub fn resolve_symlink_write_paths(path: &Path) -> io::Result<SymlinkWritePaths> {
    let root = AbsolutePathBuf::from_absolute_path(path)
        .map(AbsolutePathBuf::into_path_buf)
        .unwrap_or_else(|_| path.to_path_buf());
    let mut current = root.clone();
    let mut visited = HashSet::new();

    loop {
        let metadata = match std::fs::symlink_metadata(&current) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                return Ok(SymlinkWritePaths {
                    read_path: Some(current.clone()),
                    write_path: current,
                });
            }
            Err(_) => {
                return Ok(SymlinkWritePaths {
                    read_path: None,
                    write_path: root,
                });
            }
        };

        if !metadata.file_type().is_symlink() {
            return Ok(SymlinkWritePaths {
                read_path: Some(current.clone()),
                write_path: current,
            });
        }

        if !visited.insert(current.clone()) {
            return Ok(SymlinkWritePaths {
                read_path: None,
                write_path: root,
            });
        }

        let target = match std::fs::read_link(&current) {
            Ok(target) => target,
            Err(_) => {
                return Ok(SymlinkWritePaths {
                    read_path: None,
                    write_path: root,
                });
            }
        };

        let next = if target.is_absolute() {
            AbsolutePathBuf::from_absolute_path(&target)
        } else if let Some(parent) = current.parent() {
            AbsolutePathBuf::resolve_path_against_base(&target, parent)
        } else {
            return Ok(SymlinkWritePaths {
                read_path: None,
                write_path: root,
            });
        };

        let next = match next {
            Ok(path) => path.into_path_buf(),
            Err(_) => {
                return Ok(SymlinkWritePaths {
                    read_path: None,
                    write_path: root,
                });
            }
        };

        current = next;
    }
}

/// Writes string contents atomically to the target path.
pub fn write_atomically(write_path: &Path, contents: &str) -> Result<(), AtomicWriteError> {
    let parent = write_path.parent().ok_or_else(|| {
        AtomicWriteError::new(
            AtomicWriteStage::Write,
            io::Error::new(
                io::ErrorKind::InvalidInput,
                format!("path {} has no parent directory", write_path.display()),
            ),
        )
    })?;
    std::fs::create_dir_all(parent)
        .map_err(|error| AtomicWriteError::new(AtomicWriteStage::Write, error))?;
    let temporary_file = NamedTempFile::new_in(parent)
        .map_err(|error| AtomicWriteError::new(AtomicWriteStage::Write, error))?;
    std::fs::write(temporary_file.path(), contents)
        .map_err(|error| AtomicWriteError::new(AtomicWriteStage::Write, error))?;
    temporary_file
        .persist(write_path)
        .map_err(|error| AtomicWriteError::new(AtomicWriteStage::Finalize, error.error))?;
    Ok(())
}

/// Creates a private directory and applies restrictive permissions on Unix.
pub fn create_private_dir(
    dir: &Path,
    command_line: &str,
    stage: ErrorStage,
    label: &str,
) -> Result<(), CliError> {
    std::fs::create_dir_all(dir).map_err(|create_error| {
        CliError::new(
            format!("failed to create {label} directory"),
            command_line.to_owned(),
            stage,
            format!("{create_error} ({})", dir.display()),
            vec![format!("check {label} directory write permissions")],
        )
    })?;

    #[cfg(unix)]
    {
        std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700)).map_err(
            |permission_error| {
                CliError::new(
                    format!("failed to secure {label} directory"),
                    command_line.to_owned(),
                    stage,
                    format!("{permission_error} ({})", dir.display()),
                    vec![format!("check {label} directory write permissions")],
                )
            },
        )?;
    }

    Ok(())
}

/// Atomically writes a private file and applies restrictive permissions on Unix.
pub fn atomic_write_private_file(
    path: &Path,
    content: &str,
    command_line: &str,
    stage: ErrorStage,
    label: &str,
) -> Result<(), CliError> {
    let write_path = resolve_symlink_write_paths(path)
        .map(|paths| paths.write_path)
        .map_err(|resolve_error| {
            CliError::new(
                format!("failed to resolve {label} file path"),
                command_line.to_owned(),
                stage,
                format!("{resolve_error} ({})", path.display()),
                vec![format!("check {label} directory write permissions")],
            )
        })?;

    let parent_dir = write_path.parent().ok_or_else(|| {
        CliError::new(
            format!("failed to compute {label} directory"),
            command_line.to_owned(),
            stage,
            format!("invalid path: {}", write_path.display()),
            vec!["check filesystem permissions".to_owned()],
        )
    })?;

    write_atomically(&write_path, content).map_err(|write_error| {
        let title = match write_error.stage() {
            AtomicWriteStage::Write => format!("failed to write {label} file"),
            AtomicWriteStage::Finalize => format!("failed to finalize {label} file"),
        };
        CliError::new(
            title,
            command_line.to_owned(),
            stage,
            format!("{write_error} ({})", write_path.display()),
            vec![format!("check {label} directory write permissions")],
        )
    })?;

    #[cfg(unix)]
    {
        std::fs::set_permissions(&write_path, std::fs::Permissions::from_mode(0o600)).map_err(
            |permission_error| {
                CliError::new(
                    format!("failed to secure {label} file"),
                    command_line.to_owned(),
                    stage,
                    format!("{permission_error} ({})", write_path.display()),
                    vec![format!("check {label} directory write permissions")],
                )
            },
        )?;
    }

    let dir_handle = std::fs::File::open(parent_dir).map_err(|open_error| {
        CliError::new(
            format!("failed to sync {label} directory"),
            command_line.to_owned(),
            stage,
            format!("{open_error} ({})", parent_dir.display()),
            vec!["retry command".to_owned()],
        )
    })?;

    dir_handle.sync_all().map_err(|sync_error| {
        CliError::new(
            format!("failed to sync {label} directory"),
            command_line.to_owned(),
            stage,
            format!("{sync_error} ({})", parent_dir.display()),
            vec!["retry command".to_owned()],
        )
    })?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use crate::error::ErrorStage;
    use dirs::home_dir;
    use pretty_assertions::assert_eq;
    use std::fs;
    #[cfg(unix)]
    use std::os::unix::fs::PermissionsExt;
    #[cfg(unix)]
    use std::os::unix::fs::symlink;
    use std::path::Path;
    use std::path::PathBuf;
    use tempfile::tempdir;
    use uuid::Uuid;

    use super::AbsolutePathBuf;
    use super::AtomicWriteStage;
    use super::atomic_write_private_file;
    use super::create_private_dir;
    use super::normalize_windows_path_for_wsl_with_flag;
    #[cfg(unix)]
    use super::resolve_symlink_write_paths;
    use super::win_path_to_wsl;
    use super::write_atomically;

    #[test]
    fn resolve_path_against_base_keeps_absolute_paths() {
        let absolute_path = std::env::temp_dir()
            .join("onequery")
            .join("queries")
            .join("report.sql");
        let base_path = std::env::temp_dir().join("onequery").join("project");
        let resolved = AbsolutePathBuf::resolve_path_against_base(&absolute_path, &base_path)
            .unwrap_or_else(|error| panic!("expected absolute path resolution: {error}"));

        assert_eq!(resolved.as_path(), absolute_path.as_path());
    }

    #[test]
    fn resolve_path_against_base_anchors_relative_paths() {
        let base_path = std::env::temp_dir().join("onequery").join("project");
        let resolved = AbsolutePathBuf::resolve_path_against_base("queries/report.sql", &base_path)
            .unwrap_or_else(|error| panic!("expected relative path resolution: {error}"));

        assert_eq!(
            resolved.as_path(),
            base_path.join("queries/report.sql").as_path()
        );
    }

    #[cfg(not(target_os = "windows"))]
    #[test]
    fn resolve_path_against_base_expands_home_directory() {
        let Some(home) = home_dir() else {
            return;
        };

        let resolved = AbsolutePathBuf::resolve_path_against_base("~/queries/report.sql", "/tmp")
            .unwrap_or_else(|error| panic!("expected home-directory expansion: {error}"));

        assert_eq!(
            resolved.as_path(),
            home.join("queries/report.sql").as_path()
        );
    }

    #[test]
    fn resolve_path_against_base_maps_windows_paths_for_wsl() {
        let resolved =
            normalize_windows_path_for_wsl_with_flag(Path::new(r"C:\Users\alice\query.sql"), true);

        assert_eq!(resolved, PathBuf::from("/mnt/c/Users/alice/query.sql"));
    }

    #[test]
    fn resolve_path_against_base_keeps_unix_paths_when_wsl_mapping_is_not_needed() {
        let input = Path::new("/home/alice/query.sql");
        let resolved = normalize_windows_path_for_wsl_with_flag(input, true);

        assert_eq!(resolved, input);
    }

    #[test]
    fn win_path_to_wsl_maps_windows_drive_paths() {
        assert_eq!(
            win_path_to_wsl(r"C:\Temp\codex.zip").as_deref(),
            Some("/mnt/c/Temp/codex.zip")
        );
        assert_eq!(
            win_path_to_wsl("D:/Work/codex.tgz").as_deref(),
            Some("/mnt/d/Work/codex.tgz")
        );
    }

    #[cfg(unix)]
    #[test]
    fn symlink_cycles_fall_back_to_root_write_path() {
        let temp_dir = std::env::temp_dir().join(format!("onequery-path-utils-{}", Uuid::new_v4()));
        fs::create_dir_all(&temp_dir)
            .unwrap_or_else(|error| panic!("expected temp dir creation to succeed: {error}"));

        let first = temp_dir.join("first");
        let second = temp_dir.join("second");
        symlink(&second, &first)
            .unwrap_or_else(|error| panic!("expected first symlink creation to succeed: {error}"));
        symlink(&first, &second).unwrap_or_else(|error| {
            panic!("expected second symlink creation to succeed: {error}");
        });

        let resolved = resolve_symlink_write_paths(&first)
            .unwrap_or_else(|error| panic!("expected symlink resolution to succeed: {error}"));

        assert_eq!(resolved.read_path, None);
        assert_eq!(resolved.write_path, first);

        fs::remove_dir_all(&temp_dir)
            .unwrap_or_else(|error| panic!("expected temp dir cleanup to succeed: {error}"));
    }

    #[test]
    fn write_atomically_creates_parent_directory_and_overwrites_contents() {
        let temp_dir =
            tempdir().unwrap_or_else(|error| panic!("expected temp dir creation: {error}"));
        let file_path = temp_dir.path().join("config").join("settings.toml");

        write_atomically(&file_path, "first = true\n")
            .unwrap_or_else(|error| panic!("expected first atomic write: {error}"));
        write_atomically(&file_path, "first = false\n")
            .unwrap_or_else(|error| panic!("expected overwrite atomic write: {error}"));

        assert_eq!(
            fs::read_to_string(&file_path)
                .unwrap_or_else(|error| panic!("expected file read to succeed: {error}")),
            "first = false\n"
        );
    }

    #[test]
    fn write_atomically_reports_finalize_failures_separately() {
        let temp_dir =
            tempdir().unwrap_or_else(|error| panic!("expected temp dir creation: {error}"));
        let invalid_path = temp_dir.path().join("config-target");
        fs::create_dir_all(&invalid_path)
            .unwrap_or_else(|error| panic!("expected invalid target creation: {error}"));

        let error = write_atomically(&invalid_path, "first = false\n")
            .expect_err("expected atomic write against a directory to fail");

        assert_eq!(error.stage(), AtomicWriteStage::Finalize);
    }

    #[cfg(unix)]
    #[test]
    fn atomic_write_private_file_updates_symlink_target_without_replacing_symlink() {
        let temp_dir =
            tempdir().unwrap_or_else(|error| panic!("expected temp dir creation: {error}"));
        let target_path = temp_dir.path().join("target.json");
        let symlink_path = temp_dir.path().join("auth.json");
        fs::write(&target_path, "{\"before\":true}\n")
            .unwrap_or_else(|error| panic!("expected target file write to succeed: {error}"));
        symlink(&target_path, &symlink_path)
            .unwrap_or_else(|error| panic!("expected auth symlink creation to succeed: {error}"));

        atomic_write_private_file(
            &symlink_path,
            "{\"after\":true}\n",
            "onequery auth import --input auth.json",
            ErrorStage::LoadCredentials,
            "credentials",
        )
        .unwrap_or_else(|error| panic!("expected atomic write through symlink: {error}"));

        let symlink_metadata = fs::symlink_metadata(&symlink_path)
            .unwrap_or_else(|error| panic!("expected symlink metadata read to succeed: {error}"));
        assert_eq!(symlink_metadata.file_type().is_symlink(), true);
        assert_eq!(
            fs::read_to_string(&target_path)
                .unwrap_or_else(|error| panic!("expected target file read to succeed: {error}")),
            "{\"after\":true}\n"
        );
    }

    #[cfg(unix)]
    #[test]
    fn create_private_dir_applies_private_permissions() {
        let temp_dir =
            tempdir().unwrap_or_else(|error| panic!("expected temp dir creation: {error}"));
        let private_dir = temp_dir.path().join("private");

        create_private_dir(
            &private_dir,
            "onequery auth login",
            ErrorStage::LoadCredentials,
            "auth",
        )
        .unwrap_or_else(|error| panic!("expected private dir creation to succeed: {error}"));

        let mode = fs::metadata(&private_dir)
            .unwrap_or_else(|error| panic!("expected private dir metadata read: {error}"))
            .permissions()
            .mode()
            & 0o777;

        assert_eq!(mode, 0o700);
    }
}
