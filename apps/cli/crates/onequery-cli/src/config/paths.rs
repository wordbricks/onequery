use std::env;
use std::path::PathBuf;

use onequery_cli_core::error::CliError;
use onequery_cli_core::error::ErrorStage;

use crate::path_utils::resolve_env_directory_for_cli;
use crate::path_utils::resolve_user_path_for_cli;

const APP_CONFIG_DIR_NAME: &str = "onequery";
const APP_HOME_CONFIG_DIR_NAME: &str = "config";
const APP_HOME_DATA_DIR_NAME: &str = "data";
const APP_HOME_ENV_VAR: &str = "ONEQUERY_HOME";

pub(crate) fn config_path(command_line: &str) -> Result<PathBuf, CliError> {
    let mut path = config_dir(command_line)?;
    path.push("config.toml");
    Ok(path)
}

pub(crate) fn config_dir(command_line: &str) -> Result<PathBuf, CliError> {
    if let Some(dir) = app_home_dir(
        app_home_env_override(),
        APP_HOME_CONFIG_DIR_NAME,
        command_line,
        "config",
    )? {
        return normalize_application_dir(dir, command_line, "config");
    }

    let mut dir = platform_config_root(command_line)?;
    dir.push(APP_CONFIG_DIR_NAME);
    normalize_application_dir(dir, command_line, "config")
}

#[cfg_attr(not(test), allow(dead_code))]
pub(crate) fn data_dir(command_line: &str) -> Result<PathBuf, CliError> {
    if let Some(dir) = app_home_dir(
        app_home_env_override(),
        APP_HOME_DATA_DIR_NAME,
        command_line,
        "data",
    )? {
        return normalize_application_dir(dir, command_line, "data");
    }

    let mut dir = platform_data_root(command_line)?;
    dir.push(APP_CONFIG_DIR_NAME);
    normalize_application_dir(dir, command_line, "data")
}

fn app_home_env_override() -> Option<PathBuf> {
    env::var_os(APP_HOME_ENV_VAR)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
}

fn app_home_dir(
    app_home: Option<PathBuf>,
    child_dir_name: &str,
    command_line: &str,
    label: &str,
) -> Result<Option<PathBuf>, CliError> {
    let Some(app_home) = app_home else {
        return Ok(None);
    };

    // Comment: `ONEQUERY_HOME` is a single umbrella root so config, auth, and local
    // runtime state can move together without changing the default XDG/APPDATA layout.
    let title = format!("failed to resolve {label} directory");
    let root = resolve_env_directory_for_cli(
        APP_HOME_ENV_VAR,
        app_home.as_path(),
        command_line,
        ErrorStage::LoadConfig,
        &title,
        vec![format!("set {APP_HOME_ENV_VAR} to a valid directory")],
    )?;

    Ok(Some(root.join(child_dir_name)))
}

fn normalize_application_dir(
    dir: PathBuf,
    command_line: &str,
    label: &str,
) -> Result<PathBuf, CliError> {
    resolve_user_path_for_cli(
        dir.as_path(),
        command_line,
        ErrorStage::LoadConfig,
        format!("failed to resolve {label} directory"),
        vec![format!(
            "check the configured {label} directory path and retry"
        )],
    )
}

#[cfg(not(windows))]
fn platform_config_root(command_line: &str) -> Result<PathBuf, CliError> {
    // Comment: keep Unix-like storage XDG-shaped even on macOS so the CLI
    // resolves one predictable config root across Unix-like environments.
    unix_config_root(
        env::var_os("XDG_CONFIG_HOME")
            .filter(|value| !value.is_empty())
            .map(PathBuf::from),
        dirs::home_dir(),
        command_line,
    )
}

#[cfg(not(windows))]
#[cfg_attr(not(test), allow(dead_code))]
fn platform_data_root(command_line: &str) -> Result<PathBuf, CliError> {
    // Comment: keep Unix-like storage XDG-shaped even on macOS so the CLI
    // resolves one predictable data root across Unix-like environments.
    unix_data_root(
        env::var_os("XDG_DATA_HOME")
            .filter(|value| !value.is_empty())
            .map(PathBuf::from),
        dirs::home_dir(),
        command_line,
    )
}

#[cfg(windows)]
fn platform_config_root(command_line: &str) -> Result<PathBuf, CliError> {
    windows_config_root(dirs::config_dir(), command_line)
}

#[cfg(windows)]
#[cfg_attr(not(test), allow(dead_code))]
fn platform_data_root(command_line: &str) -> Result<PathBuf, CliError> {
    windows_data_root(dirs::data_dir(), command_line)
}

fn unix_config_root(
    xdg_config_home: Option<PathBuf>,
    home_dir: Option<PathBuf>,
    command_line: &str,
) -> Result<PathBuf, CliError> {
    if let Some(xdg_config_home) = xdg_config_home {
        return resolve_env_directory_for_cli(
            "XDG_CONFIG_HOME",
            xdg_config_home.as_path(),
            command_line,
            ErrorStage::LoadConfig,
            "failed to resolve config directory",
            vec!["set XDG_CONFIG_HOME or HOME to a valid directory".to_owned()],
        );
    }

    let mut dir = home_dir.ok_or_else(|| {
        CliError::new(
            "failed to resolve config directory",
            command_line,
            ErrorStage::LoadConfig,
            "neither XDG_CONFIG_HOME nor HOME resolved to a directory",
            vec!["set XDG_CONFIG_HOME or HOME to a valid directory".to_owned()],
        )
    })?;
    dir.push(".config");
    Ok(dir)
}

fn unix_data_root(
    xdg_data_home: Option<PathBuf>,
    home_dir: Option<PathBuf>,
    command_line: &str,
) -> Result<PathBuf, CliError> {
    if let Some(xdg_data_home) = xdg_data_home {
        return resolve_env_directory_for_cli(
            "XDG_DATA_HOME",
            xdg_data_home.as_path(),
            command_line,
            ErrorStage::LoadConfig,
            "failed to resolve data directory",
            vec!["set XDG_DATA_HOME or HOME to a valid directory".to_owned()],
        );
    }

    let mut dir = home_dir.ok_or_else(|| {
        CliError::new(
            "failed to resolve data directory",
            command_line,
            ErrorStage::LoadConfig,
            "neither XDG_DATA_HOME nor HOME resolved to a directory",
            vec!["set XDG_DATA_HOME or HOME to a valid directory".to_owned()],
        )
    })?;
    dir.push(".local");
    dir.push("share");
    Ok(dir)
}

#[cfg(any(test, windows))]
fn windows_config_root(
    windows_config_dir: Option<PathBuf>,
    command_line: &str,
) -> Result<PathBuf, CliError> {
    windows_config_dir.ok_or_else(|| {
        CliError::new(
            "failed to resolve config directory",
            command_line,
            ErrorStage::LoadConfig,
            "APPDATA did not resolve to a config directory",
            vec!["set APPDATA to a valid directory".to_owned()],
        )
    })
}

#[cfg(any(test, windows))]
fn windows_data_root(
    windows_data_dir: Option<PathBuf>,
    command_line: &str,
) -> Result<PathBuf, CliError> {
    windows_data_dir.ok_or_else(|| {
        CliError::new(
            "failed to resolve data directory",
            command_line,
            ErrorStage::LoadConfig,
            "LOCALAPPDATA did not resolve to a data directory",
            vec!["set LOCALAPPDATA to a valid directory".to_owned()],
        )
    })
}

#[cfg(test)]
mod tests {
    use pretty_assertions::assert_eq;
    use std::fs;
    use std::path::Path;
    use std::path::PathBuf;
    use uuid::Uuid;

    use super::APP_HOME_CONFIG_DIR_NAME;
    use super::APP_HOME_DATA_DIR_NAME;
    use super::app_home_dir;
    use super::unix_config_root;
    use super::unix_data_root;
    use super::windows_config_root;
    use super::windows_data_root;

    fn create_temp_dir(prefix: &str) -> PathBuf {
        let temp_dir = std::env::temp_dir().join(format!("{prefix}-{}", Uuid::new_v4()));
        fs::create_dir_all(&temp_dir)
            .unwrap_or_else(|error| panic!("expected temp dir creation to succeed: {error}"));
        temp_dir
    }

    fn remove_temp_dir(path: &Path) {
        fs::remove_dir_all(path)
            .unwrap_or_else(|error| panic!("expected temp dir cleanup to succeed: {error}"));
    }

    #[test]
    fn app_home_dir_returns_none_when_unset() {
        let resolved = app_home_dir(
            None,
            APP_HOME_CONFIG_DIR_NAME,
            "onequery org list",
            "config",
        )
        .unwrap_or_else(|error| panic!("expected unset app-home override handling: {error}"));

        assert_eq!(resolved, None);
    }

    #[test]
    fn app_home_dir_uses_onequery_home_for_config_and_data_roots() {
        let app_home = create_temp_dir("onequery-home-root");
        let expected_root = app_home
            .canonicalize()
            .unwrap_or_else(|error| panic!("expected ONEQUERY_HOME canonicalization: {error}"));

        let config_dir = app_home_dir(
            Some(app_home.join(".")),
            APP_HOME_CONFIG_DIR_NAME,
            "onequery org list",
            "config",
        )
        .unwrap_or_else(|error| panic!("expected ONEQUERY_HOME config resolution: {error}"));
        let data_dir = app_home_dir(
            Some(app_home.clone()),
            APP_HOME_DATA_DIR_NAME,
            "onequery serve",
            "data",
        )
        .unwrap_or_else(|error| panic!("expected ONEQUERY_HOME data resolution: {error}"));

        assert_eq!(
            config_dir,
            Some(expected_root.join(APP_HOME_CONFIG_DIR_NAME))
        );
        assert_eq!(data_dir, Some(expected_root.join(APP_HOME_DATA_DIR_NAME)));

        remove_temp_dir(&app_home);
    }

    #[test]
    fn app_home_dir_reports_missing_onequery_home() {
        let temp_root = create_temp_dir("onequery-home-parent");
        let missing_app_home = temp_root.join("missing");
        let error = app_home_dir(
            Some(missing_app_home),
            APP_HOME_CONFIG_DIR_NAME,
            "onequery auth whoami",
            "config",
        )
        .expect_err("expected missing ONEQUERY_HOME resolution to fail");

        assert_eq!(
            (
                error.title.clone(),
                error.try_next.clone(),
                error.why.contains("ONEQUERY_HOME points to"),
            ),
            (
                "failed to resolve config directory".to_owned(),
                vec!["set ONEQUERY_HOME to a valid directory".to_owned()],
                true,
            )
        );

        remove_temp_dir(&temp_root);
    }

    #[test]
    fn app_home_dir_reports_file_onequery_home() {
        let temp_root = create_temp_dir("onequery-home-file");
        let file_path = temp_root.join("onequery-home-file");
        fs::write(&file_path, "not a directory")
            .unwrap_or_else(|error| panic!("expected temp file write to succeed: {error}"));
        let error = app_home_dir(
            Some(file_path),
            APP_HOME_CONFIG_DIR_NAME,
            "onequery auth whoami",
            "config",
        )
        .expect_err("expected file ONEQUERY_HOME resolution to fail");

        assert_eq!(
            (
                error.title.clone(),
                error.try_next.clone(),
                error.why.contains("path is not a directory"),
            ),
            (
                "failed to resolve config directory".to_owned(),
                vec!["set ONEQUERY_HOME to a valid directory".to_owned()],
                true,
            )
        );

        remove_temp_dir(&temp_root);
    }

    #[test]
    fn unix_config_root_prefers_xdg_config_home() {
        let xdg_config_home = create_temp_dir("onequery-config-root");
        let resolved = unix_config_root(
            Some(xdg_config_home.join(".")),
            Some(PathBuf::from("/Users/alice")),
            "onequery auth whoami",
        )
        .unwrap_or_else(|error| panic!("expected XDG config home resolution: {error}"));

        assert_eq!(
            resolved,
            xdg_config_home
                .canonicalize()
                .unwrap_or_else(|error| panic!("expected config home canonicalization: {error}"))
        );
        remove_temp_dir(&xdg_config_home);
    }

    #[test]
    fn unix_config_root_reports_missing_xdg_config_home() {
        let temp_root = create_temp_dir("onequery-config-root-parent");
        let missing_xdg_config_home = temp_root.join("missing");
        let error = unix_config_root(
            Some(missing_xdg_config_home),
            Some(PathBuf::from("/Users/alice")),
            "onequery auth whoami",
        )
        .expect_err("expected missing XDG config home resolution to fail");

        assert_eq!(error.title, "failed to resolve config directory");
        assert_eq!(
            error.try_next,
            vec!["set XDG_CONFIG_HOME or HOME to a valid directory".to_owned()]
        );
        assert!(error.why.contains("XDG_CONFIG_HOME points to"));
        remove_temp_dir(&temp_root);
    }

    #[test]
    fn unix_config_root_reports_file_xdg_config_home() {
        let temp_root = create_temp_dir("onequery-config-root-file");
        let file_path = temp_root.join("xdg-config-file");
        fs::write(&file_path, "not a directory")
            .unwrap_or_else(|error| panic!("expected temp file write to succeed: {error}"));
        let error = unix_config_root(
            Some(file_path),
            Some(PathBuf::from("/Users/alice")),
            "onequery auth whoami",
        )
        .expect_err("expected file XDG config home resolution to fail");

        assert_eq!(error.title, "failed to resolve config directory");
        assert_eq!(
            error.try_next,
            vec!["set XDG_CONFIG_HOME or HOME to a valid directory".to_owned()]
        );
        assert!(error.why.contains("path is not a directory"));
        remove_temp_dir(&temp_root);
    }

    #[test]
    fn unix_config_root_falls_back_to_home_dot_config() {
        let resolved = unix_config_root(
            None,
            Some(PathBuf::from("/Users/alice")),
            "onequery org list",
        )
        .unwrap_or_else(|error| panic!("expected HOME fallback resolution: {error}"));

        assert_eq!(resolved, PathBuf::from("/Users/alice/.config"));
    }

    #[test]
    fn unix_config_root_reports_missing_directories() {
        let error = unix_config_root(None, None, "onequery auth whoami")
            .expect_err("expected missing config directory resolution to fail");

        assert_eq!(
            (
                error.title.clone(),
                error.why.clone(),
                error.try_next.clone()
            ),
            (
                "failed to resolve config directory".to_owned(),
                "neither XDG_CONFIG_HOME nor HOME resolved to a directory".to_owned(),
                vec!["set XDG_CONFIG_HOME or HOME to a valid directory".to_owned()],
            )
        );
    }

    #[test]
    fn windows_config_root_uses_platform_config_directory() {
        let resolved = windows_config_root(
            Some(PathBuf::from(r"C:\Users\alice\AppData\Roaming")),
            "onequery auth whoami",
        )
        .unwrap_or_else(|error| panic!("expected Windows config directory resolution: {error}"));

        assert_eq!(resolved, PathBuf::from(r"C:\Users\alice\AppData\Roaming"));
    }

    #[test]
    fn windows_config_root_reports_missing_appdata() {
        let error = windows_config_root(None, "onequery auth whoami")
            .expect_err("expected missing APPDATA resolution to fail");

        assert_eq!(
            (
                error.title.clone(),
                error.why.clone(),
                error.try_next.clone()
            ),
            (
                "failed to resolve config directory".to_owned(),
                "APPDATA did not resolve to a config directory".to_owned(),
                vec!["set APPDATA to a valid directory".to_owned()],
            )
        );
    }

    #[test]
    fn unix_data_root_prefers_xdg_data_home() {
        let xdg_data_home = create_temp_dir("onequery-data-root");
        let resolved = unix_data_root(
            Some(xdg_data_home.join(".")),
            Some(PathBuf::from("/Users/alice")),
            "onequery serve",
        )
        .unwrap_or_else(|error| panic!("expected XDG data home resolution: {error}"));

        assert_eq!(
            resolved,
            xdg_data_home
                .canonicalize()
                .unwrap_or_else(|error| panic!("expected data home canonicalization: {error}"))
        );
        remove_temp_dir(&xdg_data_home);
    }

    #[test]
    fn unix_data_root_reports_missing_xdg_data_home() {
        let temp_root = create_temp_dir("onequery-data-root-parent");
        let missing_xdg_data_home = temp_root.join("missing");
        let error = unix_data_root(
            Some(missing_xdg_data_home),
            Some(PathBuf::from("/Users/alice")),
            "onequery serve",
        )
        .expect_err("expected missing XDG data home resolution to fail");

        assert_eq!(error.title, "failed to resolve data directory");
        assert_eq!(
            error.try_next,
            vec!["set XDG_DATA_HOME or HOME to a valid directory".to_owned()]
        );
        assert!(error.why.contains("XDG_DATA_HOME points to"));
        remove_temp_dir(&temp_root);
    }

    #[test]
    fn unix_data_root_reports_file_xdg_data_home() {
        let temp_root = create_temp_dir("onequery-data-root-file");
        let file_path = temp_root.join("xdg-data-file");
        fs::write(&file_path, "not a directory")
            .unwrap_or_else(|error| panic!("expected temp file write to succeed: {error}"));
        let error = unix_data_root(
            Some(file_path),
            Some(PathBuf::from("/Users/alice")),
            "onequery serve",
        )
        .expect_err("expected file XDG data home resolution to fail");

        assert_eq!(error.title, "failed to resolve data directory");
        assert_eq!(
            error.try_next,
            vec!["set XDG_DATA_HOME or HOME to a valid directory".to_owned()]
        );
        assert!(error.why.contains("path is not a directory"));
        remove_temp_dir(&temp_root);
    }

    #[test]
    fn unix_data_root_falls_back_to_home_local_share() {
        let resolved = unix_data_root(None, Some(PathBuf::from("/Users/alice")), "onequery serve")
            .unwrap_or_else(|error| panic!("expected HOME fallback resolution: {error}"));

        assert_eq!(resolved, PathBuf::from("/Users/alice/.local/share"));
    }

    #[test]
    fn unix_data_root_reports_missing_directories() {
        let error =
            unix_data_root(None, None, "onequery serve").expect_err("expected missing data root");

        assert_eq!(
            (
                error.title.clone(),
                error.why.clone(),
                error.try_next.clone()
            ),
            (
                "failed to resolve data directory".to_owned(),
                "neither XDG_DATA_HOME nor HOME resolved to a directory".to_owned(),
                vec!["set XDG_DATA_HOME or HOME to a valid directory".to_owned()],
            )
        );
    }

    #[test]
    fn windows_data_root_uses_platform_data_directory() {
        let resolved = windows_data_root(
            Some(PathBuf::from(r"C:\Users\alice\AppData\Local")),
            "onequery serve",
        )
        .unwrap_or_else(|error| panic!("expected Windows data directory resolution: {error}"));

        assert_eq!(resolved, PathBuf::from(r"C:\Users\alice\AppData\Local"));
    }

    #[test]
    fn windows_data_root_reports_missing_localappdata() {
        let error =
            windows_data_root(None, "onequery serve").expect_err("expected missing LOCALAPPDATA");

        assert_eq!(
            (
                error.title.clone(),
                error.why.clone(),
                error.try_next.clone()
            ),
            (
                "failed to resolve data directory".to_owned(),
                "LOCALAPPDATA did not resolve to a data directory".to_owned(),
                vec!["set LOCALAPPDATA to a valid directory".to_owned()],
            )
        );
    }
}
