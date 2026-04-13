#[cfg(not(debug_assertions))]
use std::path::Path;
#[cfg(any(test, not(debug_assertions)))]
use std::path::PathBuf;

#[cfg(any(test, not(debug_assertions)))]
use chrono::DateTime;
#[cfg(not(debug_assertions))]
use chrono::Duration;
#[cfg(any(test, not(debug_assertions)))]
use chrono::Utc;
#[cfg(any(test, not(debug_assertions)))]
use serde::Deserialize;
#[cfg(any(test, not(debug_assertions)))]
use serde::Serialize;
#[cfg(any(test, not(debug_assertions)))]
use thiserror::Error;

#[cfg(not(debug_assertions))]
use crate::config::config_dir;

#[cfg(not(debug_assertions))]
const CLI_VERSION_CACHE_FILENAME: &str = "version.json";
#[cfg(not(debug_assertions))]
const CLI_LATEST_RELEASE_URL: &str =
    "https://api.github.com/repos/wordbricks/onequery/releases/latest";
#[cfg(not(debug_assertions))]
const CLI_VERSION_REFRESH_INTERVAL_HOURS: i64 = 20;

#[cfg(any(test, not(debug_assertions)))]
type VersionResult<T> = Result<T, VersionError>;

#[cfg(any(test, not(debug_assertions)))]
#[cfg_attr(test, allow(dead_code))]
#[derive(Debug, Error)]
enum VersionError {
    #[error("failed to read version cache at {path}: {source}")]
    ReadCache {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },
    #[error("failed to parse version cache at {path}: {source}")]
    ParseCache {
        path: PathBuf,
        #[source]
        source: serde_json::Error,
    },
    #[error("failed to fetch latest CLI version from GitHub releases: {source}")]
    FetchLatest {
        #[source]
        source: ureq::Error,
    },
    #[error("failed to join latest CLI version fetch task: {source}")]
    FetchLatestTask {
        #[source]
        source: tokio::task::JoinError,
    },
    #[error("failed to parse latest CLI release tag '{tag_name}'")]
    ParseLatestTag { tag_name: String },
    #[error("failed to serialize version cache: {source}")]
    SerializeCache {
        #[source]
        source: serde_json::Error,
    },
    #[error("failed to create version cache directory {path}: {source}")]
    CreateCacheDir {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },
    #[error("failed to write version cache to {path}: {source}")]
    WriteCache {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },
}

#[cfg(any(test, not(debug_assertions)))]
#[derive(Serialize, Deserialize, Debug, Clone, Eq, PartialEq)]
struct VersionInfo {
    latest_version: String,
    last_checked_at: DateTime<Utc>,
    #[serde(default)]
    dismissed_version: Option<String>,
}

#[cfg(any(test, not(debug_assertions)))]
#[derive(Deserialize, Debug, Clone)]
struct ReleaseInfo {
    tag_name: String,
}

pub(crate) fn refresh_cache_on_startup(command_line: &str) {
    #[cfg(debug_assertions)]
    {
        let _ = command_line;
    }

    #[cfg(not(debug_assertions))]
    {
        let version_file = match version_path(command_line) {
            Ok(version_file) => version_file,
            Err(error) => {
                tracing::debug!(command = command_line, error = %error, "failed to resolve version cache path");
                return;
            }
        };

        let info = read_version_info_if_present(&version_file);
        let should_refresh = match &info {
            None => true,
            Some(info) => {
                info.last_checked_at
                    < Utc::now() - Duration::hours(CLI_VERSION_REFRESH_INTERVAL_HOURS)
            }
        };

        if !should_refresh {
            return;
        }

        tokio::spawn(async move {
            if let Err(error) = check_for_update(&version_file).await {
                tracing::warn!(
                    version_path = %version_file.display(),
                    error = %error,
                    "failed to refresh CLI version cache"
                );
            }
        });
    }
}

#[cfg(not(debug_assertions))]
fn version_path(command_line: &str) -> Result<PathBuf, onequery_cli_core::error::CliError> {
    let mut path = config_dir(command_line)?;
    path.push(CLI_VERSION_CACHE_FILENAME);
    Ok(path)
}

#[cfg(not(debug_assertions))]
fn read_version_info(version_file: &Path) -> VersionResult<VersionInfo> {
    let contents =
        std::fs::read_to_string(version_file).map_err(|source| VersionError::ReadCache {
            path: version_file.to_path_buf(),
            source,
        })?;
    serde_json::from_str(&contents).map_err(|source| VersionError::ParseCache {
        path: version_file.to_path_buf(),
        source,
    })
}

#[cfg(not(debug_assertions))]
fn read_version_info_if_present(version_file: &Path) -> Option<VersionInfo> {
    match read_version_info(version_file) {
        Ok(info) => Some(info),
        Err(VersionError::ReadCache { source, .. })
            if source.kind() == std::io::ErrorKind::NotFound =>
        {
            None
        }
        Err(error) => {
            tracing::debug!(
                version_path = %version_file.display(),
                error = %error,
                "ignoring unreadable CLI version cache"
            );
            None
        }
    }
}

#[cfg(not(debug_assertions))]
async fn check_for_update(version_file: &Path) -> VersionResult<()> {
    let latest_tag_name = tokio::task::spawn_blocking(fetch_latest_release_tag)
        .await
        .map_err(|source| VersionError::FetchLatestTask { source })??;

    let latest_version = extract_version_from_latest_tag(&latest_tag_name)?;

    let info = VersionInfo {
        latest_version,
        last_checked_at: Utc::now(),
        dismissed_version: read_version_info_if_present(version_file)
            .and_then(|info| info.dismissed_version),
    };

    let json_line = format!(
        "{}\n",
        serde_json::to_string(&info).map_err(|source| VersionError::SerializeCache { source })?
    );
    if let Some(parent) = version_file.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|source| VersionError::CreateCacheDir {
                path: parent.to_path_buf(),
                source,
            })?;
    }
    tokio::fs::write(version_file, json_line)
        .await
        .map_err(|source| VersionError::WriteCache {
            path: version_file.to_path_buf(),
            source,
        })?;
    Ok(())
}

#[cfg(not(debug_assertions))]
fn fetch_latest_release_tag() -> VersionResult<String> {
    let user_agent = format!("onequery/{}", env!("CARGO_PKG_VERSION"));
    let mut response = ureq::get(CLI_LATEST_RELEASE_URL)
        .header("user-agent", &user_agent)
        .call()
        .map_err(|source| VersionError::FetchLatest { source })?;

    response
        .body_mut()
        .read_json::<ReleaseInfo>()
        .map(|release| release.tag_name)
        .map_err(|source| VersionError::FetchLatest { source })
}

#[cfg(any(test, not(debug_assertions)))]
fn extract_version_from_latest_tag(latest_tag_name: &str) -> VersionResult<String> {
    latest_tag_name
        .strip_prefix("cli-v")
        .map(str::to_owned)
        .ok_or_else(|| VersionError::ParseLatestTag {
            tag_name: latest_tag_name.to_owned(),
        })
}

#[cfg(test)]
mod tests {
    use pretty_assertions::assert_eq;

    use super::ReleaseInfo;
    use super::VersionInfo;
    use chrono::DateTime;
    use chrono::Utc;

    #[test]
    fn parses_latest_version_from_latest_release_payload() {
        assert_eq!(
            serde_json::from_str::<ReleaseInfo>(
                r#"{"tag_name":"cli-v1.5.0","name":"onequery v1.5.0"}"#,
            )
            .expect("failed to parse latest release payload")
            .tag_name,
            "cli-v1.5.0"
        );
    }

    #[test]
    fn extracts_version_from_latest_release_tag() {
        assert_eq!(
            super::extract_version_from_latest_tag("cli-v1.5.0")
                .expect("failed to parse release tag"),
            "1.5.0"
        );
    }

    #[test]
    fn release_tag_without_cli_prefix_is_invalid() {
        assert!(super::extract_version_from_latest_tag("v1.5.0").is_err());
    }

    #[test]
    fn version_info_deserializes_rfc3339_timestamps() {
        let info = serde_json::from_str::<VersionInfo>(
            r#"{
                "latest_version":"0.1.2",
                "last_checked_at":"2026-03-10T00:00:00Z",
                "dismissed_version":null
            }"#,
        )
        .expect("failed to parse version info");

        assert_eq!(
            info.last_checked_at,
            DateTime::parse_from_rfc3339("2026-03-10T00:00:00Z")
                .expect("failed to parse expected timestamp")
                .with_timezone(&Utc)
        );
    }
}
