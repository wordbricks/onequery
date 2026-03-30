use std::fs;
use std::path::Path;

use onequery_cli_core::error::CliError;
use onequery_cli_core::error::ErrorStage;

use super::AuthDotJson;
use super::AuthSessionSnapshot;
use super::AuthSessionSource;
use super::AuthSessionStore;
use super::paths::auth_path;
use crate::path_utils;

pub(super) fn load_auth_session_store(startup_command: &str) -> Result<AuthSessionStore, CliError> {
    let path = auth_path(startup_command)?;
    let persisted_snapshot = match read_persisted_auth_session_record(&path, startup_command)? {
        Some(record) => AuthSessionSnapshot::from_auth_json(record),
        None => AuthSessionSnapshot::empty(),
    };
    let (snapshot, source) = match std::env::var("ONEQUERY_ACCESS_TOKEN") {
        Ok(access_token) if !access_token.trim().is_empty() => (
            AuthSessionSnapshot::from_access_token(access_token),
            AuthSessionSource::Environment,
        ),
        _ => (persisted_snapshot, AuthSessionSource::PersistedFile),
    };

    Ok(AuthSessionStore {
        snapshot,
        path,
        source,
    })
}

pub(super) fn persist_snapshot(
    path: &Path,
    snapshot: &AuthSessionSnapshot,
    command_line: &str,
) -> Result<(), CliError> {
    let Some(record) = snapshot.to_auth_json() else {
        return remove_persisted_auth_session_record(path, command_line);
    };

    write_persisted_auth_session_record(path, &record, command_line)
}

pub(super) fn clear_session(path: &Path, command_line: &str) -> Result<(), CliError> {
    remove_persisted_auth_session_record(path, command_line)
}

pub(super) fn read_persisted_auth_session_record(
    path: &Path,
    startup_command: &str,
) -> Result<Option<AuthDotJson>, CliError> {
    if !path.exists() {
        return Ok(None);
    }

    let raw = fs::read_to_string(path).map_err(|read_error| {
        CliError::new(
            "failed to read auth file",
            startup_command,
            ErrorStage::LoadCredentials,
            format!("{read_error} ({})", path.display()),
            vec!["onequery auth login".to_owned()],
        )
    })?;

    serde_json::from_str::<AuthDotJson>(&raw)
        .map(Some)
        .map_err(|parse_error| {
            CliError::new(
                "failed to parse auth file",
                startup_command,
                ErrorStage::LoadCredentials,
                format!("{parse_error} ({})", path.display()),
                vec![format!("remove or fix {}", path.display())],
            )
        })
}

fn write_persisted_auth_session_record(
    path: &Path,
    record: &AuthDotJson,
    command_line: &str,
) -> Result<(), CliError> {
    let parent_dir = path.parent().ok_or_else(|| {
        CliError::new(
            "failed to compute auth directory",
            command_line,
            ErrorStage::LoadCredentials,
            format!("invalid auth path: {}", path.display()),
            vec!["check filesystem permissions".to_owned()],
        )
    })?;

    path_utils::create_private_dir(
        parent_dir,
        command_line,
        ErrorStage::LoadCredentials,
        "auth",
    )?;

    let serialized = serde_json::to_string_pretty(record).map_err(|serialize_error| {
        CliError::new(
            "failed to serialize auth",
            command_line,
            ErrorStage::LoadCredentials,
            serialize_error.to_string(),
            vec!["retry command".to_owned()],
        )
    })?;

    path_utils::atomic_write_private_file(
        path,
        &serialized,
        command_line,
        ErrorStage::LoadCredentials,
        "auth",
    )
}

fn remove_persisted_auth_session_record(path: &Path, command_line: &str) -> Result<(), CliError> {
    if !path.exists() {
        return Ok(());
    }

    fs::remove_file(path).map_err(|remove_error| {
        CliError::new(
            "failed to remove auth file",
            command_line,
            ErrorStage::LoadCredentials,
            format!("{remove_error} ({})", path.display()),
            vec!["check auth directory write permissions".to_owned()],
        )
    })
}
