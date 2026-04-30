use std::fs;
use std::fs::File;
use std::path::Path;

use flate2::read::GzDecoder;
use onequery_core::error::CliError;
use onequery_core::error::ErrorStage;
use serde_json::json;
use tar::Archive;
use uuid::Uuid;

use crate::cli::RestoreArgs;
use crate::output::CommandOutput;
use onequery_core::cli_paths::resolve_user_path_for_cli;
use onequery_gateway::self_host::SelfHostBootstrapResult;
use onequery_gateway::self_host::SelfHostRuntimePaths;
use onequery_gateway::self_host::bootstrap_self_host_foundation;
use onequery_gateway::self_host::self_host_runtime_paths;

use super::CommandContext;
use super::Runtime;
use super::ensure_self_host_runtime_supported;
use super::is_process_running;

pub(crate) async fn execute<B, T>(
    args: &RestoreArgs,
    context: &CommandContext,
    _runtime: &mut Runtime<B, T>,
) -> Result<CommandOutput, CliError> {
    ensure_self_host_runtime_supported(&context.command_line)?;

    let archive_path = resolve_user_path_for_cli(
        args.archive_path.as_path(),
        &context.command_line,
        ErrorStage::LoadConfig,
        "failed to resolve backup archive path",
        vec!["pass a valid archive path to onequery restore".to_owned()],
    )?;

    if !archive_path.is_file() {
        return Err(CliError::new(
            "backup archive not found",
            &context.command_line,
            ErrorStage::LoadConfig,
            format!("missing {}", archive_path.display()),
            vec!["pass a valid archive path to onequery restore".to_owned()],
        ));
    }

    let paths = self_host_runtime_paths(&context.command_line)?;
    execute_with_paths(
        archive_path.as_path(),
        context,
        &paths,
        bootstrap_self_host_foundation,
    )
}

fn execute_with_paths(
    archive_path: &Path,
    context: &CommandContext,
    paths: &SelfHostRuntimePaths,
    bootstrap_foundation: impl FnOnce(
        &SelfHostRuntimePaths,
        &str,
    ) -> Result<SelfHostBootstrapResult, CliError>,
) -> Result<CommandOutput, CliError> {
    ensure_runtime_not_running(paths, &context.command_line)?;
    let temp_root = std::env::temp_dir().join(format!("onequery-restore-{}", Uuid::new_v4()));
    let archive_copy_path = temp_root.join("archive.tar.gz");
    fs::create_dir_all(&temp_root).map_err(|error| {
        CliError::new(
            "failed to prepare restore workspace",
            &context.command_line,
            ErrorStage::LoadConfig,
            format!("{error} ({})", temp_root.display()),
            vec!["retry onequery restore".to_owned()],
        )
    })?;
    fs::copy(archive_path, &archive_copy_path).map_err(|error| {
        CliError::new(
            "failed to copy backup archive",
            &context.command_line,
            ErrorStage::LoadConfig,
            format!("{error} ({})", archive_path.display()),
            vec!["retry onequery restore".to_owned()],
        )
    })?;

    let extract_root = temp_root.join("extract");
    fs::create_dir_all(&extract_root).map_err(|error| {
        CliError::new(
            "failed to prepare restore extraction directory",
            &context.command_line,
            ErrorStage::LoadConfig,
            format!("{error} ({})", extract_root.display()),
            vec!["retry onequery restore".to_owned()],
        )
    })?;

    let archive_file = File::open(&archive_copy_path).map_err(|error| {
        CliError::new(
            "failed to open backup archive",
            &context.command_line,
            ErrorStage::LoadConfig,
            format!("{error} ({})", archive_copy_path.display()),
            vec!["retry onequery restore".to_owned()],
        )
    })?;
    let mut archive = Archive::new(GzDecoder::new(archive_file));
    archive.unpack(&extract_root).map_err(|error| {
        CliError::new(
            "failed to unpack backup archive",
            &context.command_line,
            ErrorStage::LoadConfig,
            error.to_string(),
            vec!["verify the archive and retry onequery restore".to_owned()],
        )
    })?;

    let extracted_config_dir = if extract_root.join("self-host").join("config.toml").is_file() {
        extract_root.join("self-host")
    } else {
        extract_root.join("config").join("self-host")
    };
    let extracted_data_dir = extract_root.join("data");
    let extracted_releases_dir = if extract_root.join("releases").is_dir() {
        extract_root.join("releases")
    } else {
        extract_root.join("data").join("releases")
    };
    let extracted_state_dir = if extract_root.join("state").is_dir() {
        extract_root.join("state")
    } else {
        extract_root.join("data").join("state")
    };
    let extracted_logs_dir = if extract_root.join("logs").is_dir() {
        extract_root.join("logs")
    } else {
        extract_root.join("data").join("logs")
    };
    let extracted_config_path = extracted_config_dir.join("config.toml");
    let extracted_secrets_path = extracted_config_dir.join("secrets.toml");

    if !extracted_config_path.is_file() {
        return Err(CliError::new(
            "backup archive is missing self-host config",
            &context.command_line,
            ErrorStage::LoadConfig,
            format!("missing {}", extracted_config_path.display()),
            vec!["create a new backup archive and retry onequery restore".to_owned()],
        ));
    }

    let restored_secrets = extracted_secrets_path.is_file();
    remove_if_present(paths.config_dir.as_path(), &context.command_line)?;
    remove_if_present(paths.data_dir.as_path(), &context.command_line)?;
    remove_if_present(paths.releases_dir.as_path(), &context.command_line)?;
    remove_if_present(paths.state_dir.as_path(), &context.command_line)?;
    remove_if_present(paths.logs_dir.as_path(), &context.command_line)?;
    copy_dir_recursive(
        &extracted_config_dir,
        paths.config_dir.as_path(),
        &context.command_line,
    )?;
    copy_dir_recursive(
        &extracted_data_dir,
        paths.data_dir.as_path(),
        &context.command_line,
    )?;
    copy_dir_recursive(
        &extracted_releases_dir,
        paths.releases_dir.as_path(),
        &context.command_line,
    )?;
    copy_dir_recursive(
        &extracted_state_dir,
        paths.state_dir.as_path(),
        &context.command_line,
    )?;
    if !extract_root.join("state").is_dir() {
        copy_legacy_home_state_entries(
            &extracted_data_dir,
            paths.state_dir.as_path(),
            &context.command_line,
        )?;
    }
    copy_dir_recursive(
        &extracted_logs_dir,
        paths.logs_dir.as_path(),
        &context.command_line,
    )?;
    remove_legacy_home_entries_from_data_dir(paths.data_dir.as_path(), &context.command_line)?;
    let bootstrap = bootstrap_foundation(paths, &context.command_line)?;

    Ok(CommandOutput::structured(
        vec![
            "Backup restored.".to_owned(),
            format!("Archive: {}", archive_path.display()),
            format!("Config dir: {}", bootstrap.paths.config_dir.display()),
            format!("Data dir: {}", bootstrap.paths.data_dir.display()),
            format!(
                "Secrets restored: {}",
                if restored_secrets { "yes" } else { "no" }
            ),
        ],
        json!({
            "kind": "restore",
            "archivePath": archive_path.display().to_string(),
            "configDir": bootstrap.paths.config_dir.display().to_string(),
            "dataDir": bootstrap.paths.data_dir.display().to_string(),
            "secretsPresent": restored_secrets,
        }),
    ))
}

fn ensure_runtime_not_running(
    paths: &onequery_gateway::self_host::SelfHostRuntimePaths,
    command_line: &str,
) -> Result<(), CliError> {
    let Some(pid) = onequery_gateway::read_running_gateway_pid_from_paths(paths, command_line)?
    else {
        return Ok(());
    };

    if is_process_running(pid) {
        return Err(CliError::new(
            "self-host runtime is currently running",
            command_line,
            ErrorStage::LoadConfig,
            format!("pid {pid} is still active"),
            vec!["stop the runtime before restoring a backup".to_owned()],
        ));
    }

    Ok(())
}

fn remove_if_present(path: &Path, command_line: &str) -> Result<(), CliError> {
    if !path.exists() {
        return Ok(());
    }

    fs::remove_dir_all(path).map_err(|error| {
        CliError::new(
            "failed to clear restore target",
            command_line,
            ErrorStage::LoadConfig,
            format!("{error} ({})", path.display()),
            vec!["retry onequery restore".to_owned()],
        )
    })
}

fn copy_dir_recursive(
    source: &Path,
    destination: &Path,
    command_line: &str,
) -> Result<(), CliError> {
    if !source.exists() {
        return Ok(());
    }

    fs::create_dir_all(destination).map_err(|error| {
        CliError::new(
            "failed to prepare restore destination",
            command_line,
            ErrorStage::LoadConfig,
            format!("{error} ({})", destination.display()),
            vec!["retry onequery restore".to_owned()],
        )
    })?;

    let mut entries = fs::read_dir(source)
        .map_err(|error| {
            restore_error(
                "failed to read restore source directory",
                command_line,
                error,
            )
        })?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| {
            restore_error("failed to read restore source entry", command_line, error)
        })?;
    entries.sort_by_key(std::fs::DirEntry::path);

    for entry in entries {
        let source_path = entry.path();
        let destination_path = destination.join(entry.file_name());
        if source_path.is_dir() {
            copy_dir_recursive(&source_path, &destination_path, command_line)?;
        } else if source_path.is_file() {
            copy_file(
                source_path.as_path(),
                destination_path.as_path(),
                command_line,
            )?;
        }
    }

    Ok(())
}

fn copy_file(source: &Path, destination: &Path, command_line: &str) -> Result<(), CliError> {
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            CliError::new(
                "failed to prepare restore file destination",
                command_line,
                ErrorStage::LoadConfig,
                format!("{error} ({})", parent.display()),
                vec!["retry onequery restore".to_owned()],
            )
        })?;
    }

    fs::copy(source, destination).map_err(|error| {
        restore_error(
            "failed to copy restored file into place",
            command_line,
            format!("{error} ({})", source.display()),
        )
    })?;

    Ok(())
}

fn copy_legacy_home_state_entries(
    legacy_home_dir: &Path,
    state_dir: &Path,
    command_line: &str,
) -> Result<(), CliError> {
    for name in [
        "version.json",
        "last-error.json",
        "reports",
        "supervisor-generations",
    ] {
        let source = legacy_home_dir.join(name);
        let destination = state_dir.join(name);
        if source.is_dir() {
            copy_dir_recursive(source.as_path(), destination.as_path(), command_line)?;
        } else if source.is_file() {
            copy_file(source.as_path(), destination.as_path(), command_line)?;
        }
    }

    Ok(())
}

fn remove_legacy_home_entries_from_data_dir(
    data_dir: &Path,
    command_line: &str,
) -> Result<(), CliError> {
    for name in [
        "releases",
        "state",
        "logs",
        "version.json",
        "last-error.json",
        "reports",
        "supervisor-generations",
    ] {
        let path = data_dir.join(name);
        if path.is_dir() {
            fs::remove_dir_all(path.as_path()).map_err(|error| {
                restore_error(
                    "failed to remove legacy restored data directory",
                    command_line,
                    format!("{error} ({})", path.display()),
                )
            })?;
        } else if path.is_file() {
            fs::remove_file(path.as_path()).map_err(|error| {
                restore_error(
                    "failed to remove legacy restored data file",
                    command_line,
                    format!("{error} ({})", path.display()),
                )
            })?;
        }
    }

    Ok(())
}

fn restore_error(title: &str, command_line: &str, error: impl std::fmt::Display) -> CliError {
    CliError::new(
        title,
        command_line,
        ErrorStage::LoadConfig,
        error.to_string(),
        vec!["retry onequery restore".to_owned()],
    )
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::fs::File;
    use std::path::Path;

    use flate2::Compression;
    use flate2::write::GzEncoder;
    use pretty_assertions::assert_eq;
    use tar::Builder;
    use uuid::Uuid;

    use super::execute_with_paths;
    use crate::commands::CommandContext;
    use crate::commands::ResolvedOrgSource;
    use crate::config::default_base_url;
    use crate::test_support::TEST_MASTER_ENCRYPTION_KEY;
    use onequery_gateway::self_host::SelfHostRuntimePaths;
    use onequery_gateway::self_host::bootstrap_self_host_foundation;
    use onequery_gateway::self_host::default_port;

    #[test]
    fn restore_replaces_runtime_and_toggles_secrets_from_the_archive() {
        for (include_secrets, temp_dir_name) in [
            (false, "onequery-restore-command"),
            (true, "onequery-restore-secrets"),
        ] {
            let temp_root =
                std::env::temp_dir().join(format!("{temp_dir_name}-{}", Uuid::new_v4()));
            let archive_path = temp_root.join("fixtures").join(if include_secrets {
                "backup-with-secrets.tar.gz"
            } else {
                "backup-no-secrets.tar.gz"
            });
            let paths =
                SelfHostRuntimePaths::from_dirs(temp_root.join("self-host"), temp_root.clone());
            write_backup_archive(&archive_path, include_secrets);
            seed_existing_runtime(&paths);

            let output = execute_with_paths(
                archive_path.as_path(),
                &sample_context("onequery restore"),
                &paths,
                bootstrap_self_host_foundation,
            )
            .unwrap_or_else(|error| panic!("expected restore to succeed: {error}"));

            let data = output.into_data();

            assert_eq!(
                data.get("secretsPresent")
                    .and_then(serde_json::Value::as_bool),
                Some(include_secrets)
            );
            assert_eq!(paths.config_path.is_file(), true);
            assert_eq!(paths.pglite_dir.join("PG_VERSION").is_file(), true);
            assert_eq!(paths.server_log_path.is_file(), true);
            assert_eq!(paths.state_dir.join("cache.json").is_file(), true);
            assert_eq!(paths.config_dir.join("stale.txt").exists(), false);
            assert_eq!(
                paths.data_dir.join("obsolete").join("stale.bin").exists(),
                false
            );
            assert_eq!(paths.secrets_path.is_file(), true);
            let secrets_contents = fs::read_to_string(&paths.secrets_path)
                .unwrap_or_else(|error| panic!("expected restored secrets file to load: {error}"));
            if include_secrets {
                assert_eq!(
                    secrets_contents,
                    format!(
                        "[auth]\nsecret = \"archived-better\"\n\n[crypto]\nmaster_encryption_key = \"{TEST_MASTER_ENCRYPTION_KEY}\"\n\n[connectors]\nenrollment_token = \"archived-connector\"\n"
                    )
                );
            } else {
                assert!(secrets_contents.contains("secret"));
            }
            assert_eq!(
                fs::read_to_string(&paths.config_path).unwrap_or_else(|error| panic!(
                    "expected restored self-host config to load: {error}"
                )),
                format!(
                    "[server]\nlisten_host = \"0.0.0.0\"\nport = {}\n",
                    default_port()
                )
            );

            fs::remove_dir_all(temp_root)
                .unwrap_or_else(|error| panic!("expected restore test temp dir cleanup: {error}"));
        }
    }

    #[test]
    fn restore_migrates_legacy_home_entries_from_data_archive() {
        let temp_root =
            std::env::temp_dir().join(format!("onequery-restore-legacy-{}", Uuid::new_v4()));
        let archive_path = temp_root.join("fixtures").join("legacy-backup.tar.gz");
        let paths = SelfHostRuntimePaths::from_dirs(temp_root.join("self-host"), temp_root.clone());
        write_legacy_layout_backup_archive(&archive_path);

        execute_with_paths(
            archive_path.as_path(),
            &sample_context("onequery restore"),
            &paths,
            bootstrap_self_host_foundation,
        )
        .unwrap_or_else(|error| panic!("expected legacy restore to succeed: {error}"));

        assert_eq!(paths.pglite_dir.join("PG_VERSION").is_file(), true);
        assert_eq!(paths.server_log_path.is_file(), true);
        assert_eq!(paths.state_dir.join("version.json").is_file(), true);
        assert_eq!(paths.state_dir.join("last-error.json").is_file(), true);
        assert_eq!(paths.state_dir.join("state-cache.json").is_file(), true);
        assert_eq!(
            paths
                .state_dir
                .join("reports")
                .join("doctor.json")
                .is_file(),
            true
        );
        assert_eq!(
            paths
                .state_dir
                .join("supervisor-generations")
                .join("generation-00000000000000000001.json")
                .is_file(),
            true
        );
        assert_eq!(paths.data_dir.join("logs").exists(), false);
        assert_eq!(paths.data_dir.join("version.json").exists(), false);
        assert_eq!(paths.data_dir.join("last-error.json").exists(), false);
        assert_eq!(paths.data_dir.join("state").exists(), false);
        assert_eq!(paths.data_dir.join("reports").exists(), false);
        assert_eq!(
            paths.data_dir.join("supervisor-generations").exists(),
            false
        );

        fs::remove_dir_all(temp_root)
            .unwrap_or_else(|error| panic!("expected restore test temp dir cleanup: {error}"));
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

    fn seed_existing_runtime(paths: &SelfHostRuntimePaths) {
        fs::create_dir_all(&paths.config_dir)
            .unwrap_or_else(|error| panic!("expected config dir creation to succeed: {error}"));
        fs::create_dir_all(paths.data_dir.join("obsolete")).unwrap_or_else(|error| {
            panic!("expected obsolete data dir creation to succeed: {error}")
        });
        fs::write(paths.config_dir.join("stale.txt"), "stale-config").unwrap_or_else(|error| {
            panic!("expected stale config fixture write to succeed: {error}")
        });
        fs::write(
            paths.data_dir.join("obsolete").join("stale.bin"),
            "stale-data",
        )
        .unwrap_or_else(|error| panic!("expected stale data fixture write to succeed: {error}"));
        fs::write(&paths.secrets_path, "[auth]\nsecret = \"stale\"\n").unwrap_or_else(|error| {
            panic!("expected stale secrets fixture write to succeed: {error}")
        });
    }

    fn write_backup_archive(archive_path: &Path, include_secrets: bool) {
        let source_root =
            std::env::temp_dir().join(format!("onequery-restore-source-{}", Uuid::new_v4()));
        let config_dir = source_root.join("self-host");
        let data_dir = source_root.join("data");
        let logs_dir = source_root.join("logs");
        let state_dir = source_root.join("state");
        fs::create_dir_all(&config_dir)
            .unwrap_or_else(|error| panic!("expected source config dir creation: {error}"));
        fs::create_dir_all(data_dir.join("pglite").join("onequery"))
            .unwrap_or_else(|error| panic!("expected source pglite dir creation: {error}"));
        fs::create_dir_all(&logs_dir)
            .unwrap_or_else(|error| panic!("expected source logs dir creation: {error}"));
        fs::create_dir_all(&state_dir)
            .unwrap_or_else(|error| panic!("expected source state dir creation: {error}"));
        fs::write(
            config_dir.join("config.toml"),
            format!(
                "[server]\nlisten_host = \"0.0.0.0\"\nport = {}\n",
                default_port()
            ),
        )
        .unwrap_or_else(|error| panic!("expected source server config write: {error}"));
        if include_secrets {
            fs::write(
                config_dir.join("secrets.toml"),
                format!(
                    "[auth]\nsecret = \"archived-better\"\n\n[crypto]\nmaster_encryption_key = \"{TEST_MASTER_ENCRYPTION_KEY}\"\n\n[connectors]\nenrollment_token = \"archived-connector\"\n"
                ),
            )
            .unwrap_or_else(|error| panic!("expected source secrets config write: {error}"));
        }
        fs::write(
            data_dir.join("pglite").join("onequery").join("PG_VERSION"),
            "16",
        )
        .unwrap_or_else(|error| panic!("expected source pglite write: {error}"));
        fs::write(logs_dir.join("server.log"), "server-log")
            .unwrap_or_else(|error| panic!("expected source log write: {error}"));
        fs::write(state_dir.join("cache.json"), "{\"cache\":true}")
            .unwrap_or_else(|error| panic!("expected source runtime file write: {error}"));

        if let Some(parent) = archive_path.parent() {
            fs::create_dir_all(parent).unwrap_or_else(|error| {
                panic!("expected archive parent dir creation to succeed: {error}")
            });
        }

        let archive_file = File::create(archive_path)
            .unwrap_or_else(|error| panic!("expected archive file creation: {error}"));
        let encoder = GzEncoder::new(archive_file, Compression::default());
        let mut archive = Builder::new(encoder);
        archive
            .append_path_with_name(config_dir.join("config.toml"), "self-host/config.toml")
            .unwrap_or_else(|error| panic!("expected server config archive append: {error}"));
        if include_secrets {
            archive
                .append_path_with_name(config_dir.join("secrets.toml"), "self-host/secrets.toml")
                .unwrap_or_else(|error| panic!("expected secrets archive append: {error}"));
        }
        archive
            .append_dir_all("data", &data_dir)
            .unwrap_or_else(|error| panic!("expected data dir archive append: {error}"));
        archive
            .append_dir_all("state", &state_dir)
            .unwrap_or_else(|error| panic!("expected state dir archive append: {error}"));
        archive
            .append_dir_all("logs", &logs_dir)
            .unwrap_or_else(|error| panic!("expected logs dir archive append: {error}"));
        archive
            .into_inner()
            .unwrap_or_else(|error| panic!("expected archive finalization: {error}"))
            .finish()
            .unwrap_or_else(|error| panic!("expected gzip finalization: {error}"));

        fs::remove_dir_all(source_root)
            .unwrap_or_else(|error| panic!("expected source fixture cleanup: {error}"));
    }

    fn write_legacy_layout_backup_archive(archive_path: &Path) {
        let source_root =
            std::env::temp_dir().join(format!("onequery-restore-legacy-source-{}", Uuid::new_v4()));
        let config_dir = source_root.join("self-host");
        let legacy_home_dir = source_root.join("data");
        fs::create_dir_all(&config_dir)
            .unwrap_or_else(|error| panic!("expected source config dir creation: {error}"));
        fs::create_dir_all(legacy_home_dir.join("pglite").join("onequery"))
            .unwrap_or_else(|error| panic!("expected source pglite dir creation: {error}"));
        fs::create_dir_all(legacy_home_dir.join("logs"))
            .unwrap_or_else(|error| panic!("expected source logs dir creation: {error}"));
        fs::create_dir_all(legacy_home_dir.join("reports"))
            .unwrap_or_else(|error| panic!("expected source reports dir creation: {error}"));
        fs::create_dir_all(legacy_home_dir.join("state"))
            .unwrap_or_else(|error| panic!("expected source state dir creation: {error}"));
        fs::create_dir_all(legacy_home_dir.join("supervisor-generations")).unwrap_or_else(
            |error| panic!("expected source supervisor generations dir creation: {error}"),
        );
        fs::write(
            config_dir.join("config.toml"),
            format!(
                "[server]\nlisten_host = \"0.0.0.0\"\nport = {}\n",
                default_port()
            ),
        )
        .unwrap_or_else(|error| panic!("expected source server config write: {error}"));
        fs::write(
            legacy_home_dir
                .join("pglite")
                .join("onequery")
                .join("PG_VERSION"),
            "16",
        )
        .unwrap_or_else(|error| panic!("expected source pglite write: {error}"));
        fs::write(
            legacy_home_dir.join("logs").join("server.log"),
            "server-log",
        )
        .unwrap_or_else(|error| panic!("expected source log write: {error}"));
        fs::write(legacy_home_dir.join("version.json"), "{}")
            .unwrap_or_else(|error| panic!("expected source version write: {error}"));
        fs::write(legacy_home_dir.join("last-error.json"), "{}")
            .unwrap_or_else(|error| panic!("expected source last error write: {error}"));
        fs::write(legacy_home_dir.join("state").join("state-cache.json"), "{}")
            .unwrap_or_else(|error| panic!("expected source nested state write: {error}"));
        fs::write(legacy_home_dir.join("reports").join("doctor.json"), "{}")
            .unwrap_or_else(|error| panic!("expected source report write: {error}"));
        fs::write(
            legacy_home_dir
                .join("supervisor-generations")
                .join("generation-00000000000000000001.json"),
            "{}",
        )
        .unwrap_or_else(|error| panic!("expected source supervisor generation write: {error}"));

        if let Some(parent) = archive_path.parent() {
            fs::create_dir_all(parent).unwrap_or_else(|error| {
                panic!("expected archive parent dir creation to succeed: {error}")
            });
        }

        let archive_file = File::create(archive_path)
            .unwrap_or_else(|error| panic!("expected archive file creation: {error}"));
        let encoder = GzEncoder::new(archive_file, Compression::default());
        let mut archive = Builder::new(encoder);
        archive
            .append_path_with_name(config_dir.join("config.toml"), "self-host/config.toml")
            .unwrap_or_else(|error| panic!("expected server config archive append: {error}"));
        archive
            .append_dir_all("data", &legacy_home_dir)
            .unwrap_or_else(|error| panic!("expected legacy data dir archive append: {error}"));
        archive
            .into_inner()
            .unwrap_or_else(|error| panic!("expected archive finalization: {error}"))
            .finish()
            .unwrap_or_else(|error| panic!("expected gzip finalization: {error}"));

        fs::remove_dir_all(source_root)
            .unwrap_or_else(|error| panic!("expected source fixture cleanup: {error}"));
    }
}
