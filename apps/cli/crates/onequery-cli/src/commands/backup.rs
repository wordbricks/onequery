use std::fs;
use std::fs::File;
use std::io;
use std::path::Path;

use chrono::Utc;
use flate2::Compression;
use flate2::write::GzEncoder;
use onequery_cli_core::error::CliError;
use onequery_cli_core::error::ErrorStage;
use serde_json::json;
use tar::Builder;

use crate::cli::BackupArgs;
use crate::config::self_host::SelfHostRuntimePaths;
use crate::config::self_host::self_host_runtime_paths;
use crate::output::CommandOutput;
use crate::path_utils::resolve_user_path_for_cli;

use super::CommandContext;
use super::Runtime;
use super::ensure_self_host_runtime_supported;
use super::is_process_running;

pub(crate) async fn execute<B, T>(
    args: &BackupArgs,
    context: &CommandContext,
    _runtime: &mut Runtime<B, T>,
) -> Result<CommandOutput, CliError> {
    ensure_self_host_runtime_supported(&context.command_line)?;

    let paths = self_host_runtime_paths(&context.command_line)?;
    execute_with_paths(args, context, &paths)
}

fn execute_with_paths(
    args: &BackupArgs,
    context: &CommandContext,
    paths: &SelfHostRuntimePaths,
) -> Result<CommandOutput, CliError> {
    ensure_runtime_not_running(paths, &context.command_line)?;
    ensure_backup_inputs_exist(paths, &context.command_line)?;

    let archive_path = match &args.archive_path {
        Some(archive_path) => resolve_user_path_for_cli(
            archive_path.as_path(),
            &context.command_line,
            ErrorStage::LoadConfig,
            "failed to resolve backup archive path",
            vec!["pass a valid path to --archive-path".to_owned()],
        )?,
        None => paths.backups_dir.join(format!(
            "onequery-backup-{}.tar.gz",
            Utc::now().format("%Y%m%dT%H%M%SZ")
        )),
    };

    if let Some(parent) = archive_path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            CliError::new(
                "failed to prepare backup directory",
                &context.command_line,
                ErrorStage::LoadConfig,
                format!("{error} ({})", parent.display()),
                vec!["retry onequery backup".to_owned()],
            )
        })?;
    }

    let file = File::create(&archive_path).map_err(|error| {
        CliError::new(
            "failed to create backup archive",
            &context.command_line,
            ErrorStage::LoadConfig,
            format!("{error} ({})", archive_path.display()),
            vec!["retry onequery backup".to_owned()],
        )
    })?;
    let encoder = GzEncoder::new(file, Compression::default());
    let mut archive = Builder::new(encoder);
    let mut archived_items = 0usize;

    archive
        .append_path_with_name(&paths.config_path, "config/self-host/config.toml")
        .map_err(|error| {
            archive_error(
                "failed to archive self-host config",
                &context.command_line,
                error,
            )
        })?;
    archived_items += 1;

    if args.include_secrets && paths.secrets_path.is_file() {
        archive
            .append_path_with_name(&paths.secrets_path, "config/self-host/secrets.toml")
            .map_err(|error| {
                archive_error(
                    "failed to archive secrets config",
                    &context.command_line,
                    error,
                )
            })?;
        archived_items += 1;
    }

    archived_items += append_directory_tree(
        &mut archive,
        &paths.data_dir,
        Path::new("data"),
        true,
        &context.command_line,
    )?;

    let encoder = archive.into_inner().map_err(|error| {
        CliError::new(
            "failed to finalize backup archive",
            &context.command_line,
            ErrorStage::LoadConfig,
            error.to_string(),
            vec!["retry onequery backup".to_owned()],
        )
    })?;
    encoder.finish().map_err(|error| {
        CliError::new(
            "failed to finalize backup archive",
            &context.command_line,
            ErrorStage::LoadConfig,
            error.to_string(),
            vec!["retry onequery backup".to_owned()],
        )
    })?;

    Ok(CommandOutput::structured(
        vec![
            "Backup created.".to_owned(),
            format!("Archive: {}", archive_path.display()),
            format!(
                "Included secrets: {}",
                if args.include_secrets { "yes" } else { "no" }
            ),
            format!("Archived items: {archived_items}"),
        ],
        json!({
            "kind": "backup",
            "archivePath": archive_path.display().to_string(),
            "archivedItems": archived_items,
            "includedSecrets": args.include_secrets,
        }),
    ))
}

fn ensure_backup_inputs_exist(
    paths: &crate::config::self_host::SelfHostRuntimePaths,
    command_line: &str,
) -> Result<(), CliError> {
    if !paths.config_path.is_file() {
        return Err(CliError::new(
            "self-host runtime is not initialized",
            command_line,
            ErrorStage::LoadConfig,
            format!("missing {}", paths.config_path.display()),
            vec!["run onequery serve once before creating a backup".to_owned()],
        ));
    }

    Ok(())
}

fn ensure_runtime_not_running(
    paths: &crate::config::self_host::SelfHostRuntimePaths,
    command_line: &str,
) -> Result<(), CliError> {
    let Some(pid) = read_pid(paths.pid_path.as_path())? else {
        return Ok(());
    };

    if is_process_running(pid) {
        return Err(CliError::new(
            "self-host runtime is currently running",
            command_line,
            ErrorStage::LoadConfig,
            format!("pid {pid} is still active"),
            vec!["stop the runtime before creating a backup".to_owned()],
        ));
    }

    Ok(())
}

fn append_directory_tree<W: io::Write>(
    archive: &mut Builder<W>,
    source_dir: &Path,
    archive_dir: &Path,
    is_data_root: bool,
    command_line: &str,
) -> Result<usize, CliError> {
    if !source_dir.is_dir() {
        return Ok(0);
    }

    let mut archived_items = 0usize;
    archive
        .append_dir(archive_dir, source_dir)
        .map_err(|error| archive_error("failed to archive directory", command_line, error))?;
    archived_items += 1;

    let mut entries = fs::read_dir(source_dir)
        .map_err(|error| {
            archive_error(
                "failed to read backup source directory",
                command_line,
                error,
            )
        })?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| {
            archive_error("failed to read backup source entry", command_line, error)
        })?;
    entries.sort_by_key(std::fs::DirEntry::path);

    for entry in entries {
        let source_path = entry.path();
        let Some(name) = source_path.file_name() else {
            continue;
        };
        if is_data_root && matches!(name.to_str(), Some("backups" | "run")) {
            continue;
        }

        let next_archive_path = archive_dir.join(name);
        if source_path.is_dir() {
            archived_items += append_directory_tree(
                archive,
                &source_path,
                &next_archive_path,
                false,
                command_line,
            )?;
        } else if source_path.is_file() {
            archive
                .append_path_with_name(&source_path, &next_archive_path)
                .map_err(|error| archive_error("failed to archive file", command_line, error))?;
            archived_items += 1;
        }
    }

    Ok(archived_items)
}

fn archive_error(title: &str, command_line: &str, error: impl std::fmt::Display) -> CliError {
    CliError::new(
        title,
        command_line,
        ErrorStage::LoadConfig,
        error.to_string(),
        vec!["retry onequery backup".to_owned()],
    )
}

fn read_pid(path: &Path) -> Result<Option<u32>, CliError> {
    let Ok(contents) = fs::read_to_string(path) else {
        return Ok(None);
    };

    let trimmed = contents.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }

    trimmed.parse::<u32>().map(Some).map_err(|error| {
        CliError::new(
            "failed to parse runtime pid file",
            "onequery backup",
            ErrorStage::LoadConfig,
            format!("{error} ({})", path.display()),
            vec!["remove the stale pid file and retry".to_owned()],
        )
    })
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::fs::File;
    use std::path::Path;

    use flate2::read::GzDecoder;
    use pretty_assertions::assert_eq;
    use tar::Archive;
    use uuid::Uuid;

    use super::execute_with_paths;
    use crate::cli::BackupArgs;
    use crate::commands::CommandContext;
    use crate::commands::ResolvedOrgSource;
    use crate::config::default_base_url;
    use crate::config::self_host::DEFAULT_SELF_HOST_LISTEN_HOST;
    use crate::config::self_host::SelfHostRuntimePaths;
    use crate::config::self_host::default_port;

    const TEST_MASTER_ENCRYPTION_KEY: &str = "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=";

    #[test]
    fn backup_archives_server_pglite_and_runtime_files_but_excludes_secrets_and_live_markers_by_default()
     {
        let temp_root =
            std::env::temp_dir().join(format!("onequery-backup-command-{}", Uuid::new_v4()));
        let paths = SelfHostRuntimePaths::for_test(
            temp_root.join("config").join("self-host"),
            temp_root.join("data"),
        );
        seed_runtime_fixture(&paths, true);
        let archive_path = temp_root.join("artifacts").join("backup-no-secrets.tar.gz");

        let output = execute_with_paths(
            &BackupArgs {
                include_secrets: false,
                archive_path: Some(archive_path.clone()),
            },
            &sample_context("onequery backup"),
            &paths,
        )
        .unwrap_or_else(|error| panic!("expected backup to succeed: {error}"));

        let data = output.into_data();
        let entries = archive_entries(&archive_path);

        assert_eq!(
            data.get("archivePath").and_then(serde_json::Value::as_str),
            Some(archive_path.to_string_lossy().as_ref())
        );
        assert_eq!(
            data.get("includedSecrets")
                .and_then(serde_json::Value::as_bool),
            Some(false)
        );
        assert_eq!(
            entries.contains(&"config/self-host/config.toml".to_owned()),
            true
        );
        assert_eq!(
            entries.contains(&"config/self-host/secrets.toml".to_owned()),
            false
        );
        assert_eq!(
            entries.contains(&"data/pglite/onequery/PG_VERSION".to_owned()),
            true
        );
        assert_eq!(entries.contains(&"data/logs/server.log".to_owned()), true);
        assert_eq!(entries.contains(&"data/state/cache.json".to_owned()), true);
        assert_eq!(
            entries.contains(&"data/backups/old-backup.tar.gz".to_owned()),
            false
        );
        assert_eq!(entries.contains(&"data/run/server.pid".to_owned()), false);
        assert_eq!(entries.contains(&"data/run/server.lock".to_owned()), false);

        fs::remove_dir_all(temp_root)
            .unwrap_or_else(|error| panic!("expected backup test temp dir cleanup: {error}"));
    }

    #[test]
    fn backup_includes_secrets_when_requested() {
        let temp_root =
            std::env::temp_dir().join(format!("onequery-backup-secrets-{}", Uuid::new_v4()));
        let paths = SelfHostRuntimePaths::for_test(
            temp_root.join("config").join("self-host"),
            temp_root.join("data"),
        );
        seed_runtime_fixture(&paths, true);
        let archive_path = temp_root
            .join("artifacts")
            .join("backup-with-secrets.tar.gz");

        let output = execute_with_paths(
            &BackupArgs {
                include_secrets: true,
                archive_path: Some(archive_path.clone()),
            },
            &sample_context("onequery backup --include-secrets"),
            &paths,
        )
        .unwrap_or_else(|error| panic!("expected backup with secrets to succeed: {error}"));

        let data = output.into_data();
        let entries = archive_entries(&archive_path);

        assert_eq!(
            data.get("includedSecrets")
                .and_then(serde_json::Value::as_bool),
            Some(true)
        );
        assert_eq!(
            entries.contains(&"config/self-host/secrets.toml".to_owned()),
            true
        );

        fs::remove_dir_all(temp_root).unwrap_or_else(|error| {
            panic!("expected backup-with-secrets temp dir cleanup: {error}")
        });
    }

    fn sample_context(command_line: &str) -> CommandContext {
        CommandContext {
            command_line: command_line.to_owned(),
            base_url: default_base_url(),
            request_id: None,
            resolved_org: None,
            resolved_org_source: ResolvedOrgSource::None,
            verbose: false,
        }
    }

    fn seed_runtime_fixture(paths: &SelfHostRuntimePaths, include_secrets: bool) {
        fs::create_dir_all(&paths.config_dir)
            .unwrap_or_else(|error| panic!("expected config dir creation to succeed: {error}"));
        fs::create_dir_all(&paths.pglite_dir)
            .unwrap_or_else(|error| panic!("expected pglite dir creation to succeed: {error}"));
        fs::create_dir_all(&paths.logs_dir)
            .unwrap_or_else(|error| panic!("expected logs dir creation to succeed: {error}"));
        fs::create_dir_all(paths.data_dir.join("state"))
            .unwrap_or_else(|error| panic!("expected state dir creation to succeed: {error}"));
        fs::create_dir_all(&paths.backups_dir)
            .unwrap_or_else(|error| panic!("expected backups dir creation to succeed: {error}"));
        fs::create_dir_all(&paths.run_dir)
            .unwrap_or_else(|error| panic!("expected run dir creation to succeed: {error}"));

        fs::write(
            &paths.config_path,
            format!(
                "[server]\nlisten_host = \"{}\"\nport = {}\nlog_level = \"info\"\n",
                DEFAULT_SELF_HOST_LISTEN_HOST,
                default_port()
            ),
        )
        .unwrap_or_else(|error| panic!("expected server config write to succeed: {error}"));
        if include_secrets {
            fs::write(
                &paths.secrets_path,
                format!(
                    "[auth]\nsecret = \"better\"\n\n[crypto]\nmaster_encryption_key = \"{TEST_MASTER_ENCRYPTION_KEY}\"\n\n[connectors]\nenrollment_token = \"connector\"\n"
                ),
            )
            .unwrap_or_else(|error| panic!("expected secrets config write to succeed: {error}"));
        }
        fs::write(paths.pglite_dir.join("PG_VERSION"), "16")
            .unwrap_or_else(|error| panic!("expected pglite fixture write to succeed: {error}"));
        fs::write(&paths.server_log_path, "listening\n")
            .unwrap_or_else(|error| panic!("expected log fixture write to succeed: {error}"));
        fs::write(
            paths.data_dir.join("state").join("cache.json"),
            "{\"ok\":true}",
        )
        .unwrap_or_else(|error| panic!("expected runtime file write to succeed: {error}"));
        fs::write(paths.backups_dir.join("old-backup.tar.gz"), "skip")
            .unwrap_or_else(|error| panic!("expected backup fixture write to succeed: {error}"));
        fs::write(&paths.pid_path, "9999\n")
            .unwrap_or_else(|error| panic!("expected pid fixture write to succeed: {error}"));
        fs::write(&paths.lock_path, "{\"pid\":9999}\n")
            .unwrap_or_else(|error| panic!("expected lock fixture write to succeed: {error}"));
    }

    fn archive_entries(archive_path: &Path) -> Vec<String> {
        let archive_file = File::open(archive_path)
            .unwrap_or_else(|error| panic!("expected archive open to succeed: {error}"));
        let mut archive = Archive::new(GzDecoder::new(archive_file));
        let mut entries = archive
            .entries()
            .unwrap_or_else(|error| panic!("expected archive entries to load: {error}"))
            .map(|entry| {
                entry
                    .unwrap_or_else(|error| panic!("expected archive entry to load: {error}"))
                    .path()
                    .unwrap_or_else(|error| panic!("expected archive path to decode: {error}"))
                    .display()
                    .to_string()
            })
            .collect::<Vec<_>>();
        entries.sort();
        entries
    }
}
