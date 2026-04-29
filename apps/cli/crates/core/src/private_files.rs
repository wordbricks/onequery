//! Private filesystem write helpers.

use std::path::Path;

use crate::error::CliError;
use crate::error::ErrorStage;
use onequery_utils_path::resolve_symlink_write_paths;
use onequery_utils_path::write_atomically;
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;

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
        CliError::new(
            format!("failed to write {label} file"),
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
    use pretty_assertions::assert_eq;
    use std::fs;
    #[cfg(unix)]
    use std::os::unix::fs::PermissionsExt;
    #[cfg(unix)]
    use std::os::unix::fs::symlink;
    use tempfile::tempdir;

    use super::atomic_write_private_file;
    use super::create_private_dir;

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
