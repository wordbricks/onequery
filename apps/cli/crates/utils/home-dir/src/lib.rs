use dirs::home_dir;
use onequery_utils_absolute_path::AbsolutePathBuf;
use std::fs;
use std::io;
use std::path::Path;
use std::path::PathBuf;

const ONEQUERY_HOME_ENV_VAR: &str = "ONEQUERY_HOME";
const ONEQUERY_HOME_DIR_NAME: &str = ".onequery";

#[cfg(unix)]
const LEGACY_CONFIG_DIR: &str = ".config/onequery";
#[cfg(unix)]
const LEGACY_DATA_DIR: &str = ".local/share/onequery";

/// Returns the path to the OneQuery home directory, which can be specified by
/// the `ONEQUERY_HOME` environment variable. If not set, defaults to
/// `~/.onequery`.
///
/// - If `ONEQUERY_HOME` is set, the value must exist and be a directory. The
///   value will be canonicalized and this function will Err otherwise.
/// - If `ONEQUERY_HOME` is not set, this function does not verify that the
///   directory exists.
pub fn find_onequery_home() -> std::io::Result<AbsolutePathBuf> {
    let onequery_home_env = std::env::var(ONEQUERY_HOME_ENV_VAR)
        .ok()
        .filter(|val| !val.is_empty());
    find_onequery_home_from_env(onequery_home_env.as_deref())
}

fn find_onequery_home_from_env(
    onequery_home_env: Option<&str>,
) -> std::io::Result<AbsolutePathBuf> {
    let default_home = home_dir();
    find_onequery_home_from_env_with_home(onequery_home_env, default_home.as_deref())
}

fn find_onequery_home_from_env_with_home(
    onequery_home_env: Option<&str>,
    default_home: Option<&Path>,
) -> std::io::Result<AbsolutePathBuf> {
    match onequery_home_env {
        Some(val) => {
            let path = PathBuf::from(val);
            let metadata = std::fs::metadata(&path).map_err(|err| match err.kind() {
                std::io::ErrorKind::NotFound => std::io::Error::new(
                    std::io::ErrorKind::NotFound,
                    format!(
                        "{ONEQUERY_HOME_ENV_VAR} points to {val:?}, but that path does not exist"
                    ),
                ),
                _ => std::io::Error::new(
                    err.kind(),
                    format!("failed to read {ONEQUERY_HOME_ENV_VAR} {val:?}: {err}"),
                ),
            })?;

            if !metadata.is_dir() {
                Err(std::io::Error::new(
                    std::io::ErrorKind::InvalidInput,
                    format!(
                        "{ONEQUERY_HOME_ENV_VAR} points to {val:?}, but that path is not a directory"
                    ),
                ))
            } else {
                let canonical = path.canonicalize().map_err(|err| {
                    std::io::Error::new(
                        err.kind(),
                        format!("failed to canonicalize {ONEQUERY_HOME_ENV_VAR} {val:?}: {err}"),
                    )
                })?;
                migrate_onequery_home_layout(canonical.as_path())?;
                AbsolutePathBuf::from_absolute_path(canonical)
            }
        }
        None => {
            let home = default_home.ok_or_else(|| {
                std::io::Error::new(
                    std::io::ErrorKind::NotFound,
                    "Could not find home directory",
                )
            })?;
            let path = default_onequery_home(home);
            migrate_legacy_default_onequery_home(home, &path)?;
            migrate_onequery_home_layout(path.as_path())?;
            AbsolutePathBuf::from_absolute_path(path)
        }
    }
}

fn default_onequery_home(home: &Path) -> PathBuf {
    home.join(ONEQUERY_HOME_DIR_NAME)
}

fn migrate_onequery_home_layout(onequery_home: &Path) -> io::Result<()> {
    if !onequery_home.exists() {
        return Ok(());
    }

    for (source, target) in [
        ("config/config.toml", "config.toml"),
        ("secrets/auth.json", "auth.json"),
        ("config/self-host/config.toml", "self-host/config.toml"),
        ("secrets/self-host/secrets.toml", "self-host/secrets.toml"),
        ("pglite", "data/pglite"),
        ("backups", "data/backups"),
        ("recovery-points", "data/recovery-points"),
        ("version.json", "state/version.json"),
        ("last-error.json", "state/last-error.json"),
        ("reports", "state/reports"),
        ("supervisor-generations", "state/supervisor-generations"),
    ] {
        move_home_entry_if_present(onequery_home, source, target)?;
    }

    remove_dir_if_empty(onequery_home.join("config").join("self-host").as_path())?;
    remove_dir_if_empty(onequery_home.join("secrets").join("self-host").as_path())?;
    remove_dir_if_empty(onequery_home.join("packages").join("standalone").as_path())?;
    remove_dir_if_empty(onequery_home.join("packages").as_path())?;
    remove_dir_if_empty(onequery_home.join("config").as_path())?;
    remove_dir_if_empty(onequery_home.join("secrets").as_path())?;

    Ok(())
}

fn move_home_entry_if_present(onequery_home: &Path, source: &str, target: &str) -> io::Result<()> {
    let source_path = onequery_home.join(source);
    if !source_path.exists() {
        return Ok(());
    }

    let target_path = onequery_home.join(target);
    if target_path.exists() {
        return Err(io::Error::new(
            io::ErrorKind::AlreadyExists,
            format!(
                "cannot migrate onequery path {} because {} already exists",
                source_path.display(),
                target_path.display()
            ),
        ));
    }

    if let Some(parent) = target_path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::rename(source_path, target_path)
}

#[cfg(unix)]
fn migrate_legacy_default_onequery_home(home: &Path, onequery_home: &Path) -> io::Result<()> {
    let legacy_config_dir = home.join(LEGACY_CONFIG_DIR);
    let legacy_data_dir = home.join(LEGACY_DATA_DIR);
    if !legacy_config_dir.exists() && !legacy_data_dir.exists() {
        return Ok(());
    }

    // Drop this legacy default-path migration after the 0.50 release.
    fs::create_dir_all(onequery_home)?;
    eprintln!(
        "Migrating OneQuery data from {} and {} to {}",
        legacy_config_dir.display(),
        legacy_data_dir.display(),
        onequery_home.display()
    );
    move_legacy_children(&legacy_config_dir, onequery_home)?;
    move_legacy_children(&legacy_data_dir, onequery_home)?;
    remove_dir_if_empty(&legacy_config_dir)?;
    remove_dir_if_empty(&legacy_data_dir)?;

    Ok(())
}

#[cfg(not(unix))]
fn migrate_legacy_default_onequery_home(_home: &Path, _onequery_home: &Path) -> io::Result<()> {
    Ok(())
}

#[cfg(unix)]
fn move_legacy_children(source_dir: &Path, target_dir: &Path) -> io::Result<()> {
    match fs::read_dir(source_dir) {
        Ok(entries) => {
            for entry in entries {
                let entry = entry?;
                let source_path = entry.path();
                let target_path = target_dir.join(entry.file_name());
                if target_path.exists() {
                    return Err(io::Error::new(
                        io::ErrorKind::AlreadyExists,
                        format!(
                            "cannot migrate legacy onequery path {} because {} already exists",
                            source_path.display(),
                            target_path.display()
                        ),
                    ));
                }
                fs::rename(source_path, target_path)?;
            }
            Ok(())
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error),
    }
}

fn remove_dir_if_empty(path: &Path) -> io::Result<()> {
    match fs::remove_dir(path) {
        Ok(()) => Ok(()),
        Err(error)
            if matches!(
                error.kind(),
                io::ErrorKind::NotFound | io::ErrorKind::DirectoryNotEmpty
            ) =>
        {
            Ok(())
        }
        Err(error) => Err(error),
    }
}

#[cfg(test)]
mod tests {
    use super::default_onequery_home;
    use super::find_onequery_home_from_env;
    use onequery_utils_absolute_path::AbsolutePathBuf;
    use pretty_assertions::assert_eq;
    use std::fs;
    use std::io::ErrorKind;
    use tempfile::TempDir;

    #[test]
    fn find_onequery_home_env_missing_path_is_fatal() {
        let temp_home = TempDir::new().expect("temp home");
        let missing = temp_home.path().join("missing-onequery-home");
        let missing_str = missing
            .to_str()
            .expect("missing onequery home path should be valid utf-8");

        let err =
            find_onequery_home_from_env(Some(missing_str)).expect_err("missing ONEQUERY_HOME");
        assert_eq!(err.kind(), ErrorKind::NotFound);
        assert!(
            err.to_string().contains("ONEQUERY_HOME"),
            "unexpected error: {err}"
        );
    }

    #[test]
    fn find_onequery_home_env_file_path_is_fatal() {
        let temp_home = TempDir::new().expect("temp home");
        let file_path = temp_home.path().join("onequery-home.txt");
        fs::write(&file_path, "not a directory").expect("write temp file");
        let file_str = file_path
            .to_str()
            .expect("file onequery home path should be valid utf-8");

        let err = find_onequery_home_from_env(Some(file_str)).expect_err("file ONEQUERY_HOME");
        assert_eq!(err.kind(), ErrorKind::InvalidInput);
        assert!(
            err.to_string().contains("not a directory"),
            "unexpected error: {err}"
        );
    }

    #[test]
    fn find_onequery_home_env_valid_directory_canonicalizes() {
        let temp_home = TempDir::new().expect("temp home");
        let temp_str = temp_home
            .path()
            .to_str()
            .expect("temp onequery home path should be valid utf-8");

        let resolved = find_onequery_home_from_env(Some(temp_str)).expect("valid ONEQUERY_HOME");
        let expected = temp_home
            .path()
            .canonicalize()
            .expect("canonicalize temp home");
        let expected = AbsolutePathBuf::from_absolute_path(expected).expect("absolute home");
        assert_eq!(resolved, expected);
    }

    #[test]
    fn find_onequery_home_without_env_uses_default_home_dir() {
        let temp_home = TempDir::new().expect("temp home");
        let resolved = super::find_onequery_home_from_env_with_home(
            /*onequery_home_env*/ None,
            Some(temp_home.path()),
        )
        .expect("default ONEQUERY_HOME");
        let expected = temp_home.path().join(super::ONEQUERY_HOME_DIR_NAME);
        let expected = AbsolutePathBuf::from_absolute_path(expected).expect("absolute home");
        assert_eq!(resolved, expected);
    }

    #[test]
    fn migrate_onequery_home_layout_moves_nested_config_secrets_data_and_state() {
        let temp_home = TempDir::new().expect("temp home");
        let onequery_home = temp_home.path().join("onequery-home");
        fs::create_dir_all(onequery_home.join("config/self-host")).expect("config self-host");
        fs::create_dir_all(onequery_home.join("secrets/self-host")).expect("secrets self-host");
        fs::create_dir_all(onequery_home.join("pglite")).expect("pglite");
        fs::create_dir_all(onequery_home.join("backups")).expect("backups");
        fs::create_dir_all(onequery_home.join("reports")).expect("reports");
        fs::write(onequery_home.join("config/config.toml"), "config").expect("config");
        fs::write(onequery_home.join("secrets/auth.json"), "{}").expect("auth");
        fs::write(
            onequery_home.join("config/self-host/config.toml"),
            "self-host",
        )
        .expect("self-host config");
        fs::write(
            onequery_home.join("secrets/self-host/secrets.toml"),
            "secrets",
        )
        .expect("self-host secrets");
        fs::write(onequery_home.join("version.json"), "{}").expect("version");

        super::migrate_onequery_home_layout(onequery_home.as_path()).expect("home migration");

        assert_eq!(
            (
                onequery_home.join("config.toml").is_file(),
                onequery_home.join("auth.json").is_file(),
                onequery_home.join("self-host/config.toml").is_file(),
                onequery_home.join("self-host/secrets.toml").is_file(),
                onequery_home.join("data/pglite").is_dir(),
                onequery_home.join("data/backups").is_dir(),
                onequery_home.join("state/reports").is_dir(),
                onequery_home.join("state/version.json").is_file(),
                onequery_home.join("config").exists(),
                onequery_home.join("secrets").exists(),
            ),
            (true, true, true, true, true, true, true, true, false, false)
        );
    }

    #[cfg(unix)]
    #[test]
    fn migrate_legacy_default_onequery_home_moves_config_and_data_into_onequery_home() {
        let temp_home = TempDir::new().expect("temp home");
        let legacy_config_dir = temp_home.path().join(super::LEGACY_CONFIG_DIR);
        let legacy_data_dir = temp_home.path().join(super::LEGACY_DATA_DIR);
        fs::create_dir_all(legacy_config_dir.join("self-host")).expect("legacy config dir");
        fs::create_dir_all(legacy_data_dir.join("logs")).expect("legacy data dir");
        fs::write(
            legacy_config_dir.join("config.toml"),
            "[org]\nactive = \"acme\"\n",
        )
        .expect("legacy config");
        fs::write(legacy_config_dir.join("auth.json"), "{}").expect("legacy auth");
        fs::write(legacy_data_dir.join("logs/server.log"), "started").expect("legacy log");

        let onequery_home = default_onequery_home(temp_home.path());
        super::migrate_legacy_default_onequery_home(temp_home.path(), onequery_home.as_path())
            .expect("legacy migration");

        assert_eq!(
            (
                onequery_home.join("config.toml").is_file(),
                onequery_home.join("auth.json").is_file(),
                onequery_home.join("self-host").is_dir(),
                onequery_home.join("logs/server.log").is_file(),
                legacy_config_dir.exists(),
                legacy_data_dir.exists(),
            ),
            (true, true, true, true, false, false)
        );
    }

    #[cfg(unix)]
    #[test]
    fn migrate_legacy_default_onequery_home_merges_into_existing_onequery_home() {
        let temp_home = TempDir::new().expect("temp home");
        let onequery_home = default_onequery_home(temp_home.path());
        let legacy_config_dir = temp_home.path().join(super::LEGACY_CONFIG_DIR);
        fs::create_dir_all(&onequery_home).expect("onequery home");
        fs::create_dir_all(&legacy_config_dir).expect("legacy config dir");
        fs::write(
            legacy_config_dir.join("config.toml"),
            "[org]\nactive = \"acme\"\n",
        )
        .expect("legacy config");

        super::migrate_legacy_default_onequery_home(temp_home.path(), onequery_home.as_path())
            .expect("legacy migration");

        assert_eq!(
            (
                onequery_home.join("config.toml").is_file(),
                legacy_config_dir.exists(),
            ),
            (true, false)
        );
    }
}
