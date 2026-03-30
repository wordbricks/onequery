#[cfg(not(debug_assertions))]
use std::path::Path;
#[cfg(not(debug_assertions))]
use std::path::PathBuf;

#[cfg(not(debug_assertions))]
use reqwest::header::USER_AGENT;
#[cfg(any(test, not(debug_assertions)))]
use serde::Deserialize;
#[cfg(any(test, not(debug_assertions)))]
use serde::Serialize;
#[cfg(not(debug_assertions))]
use thiserror::Error;
#[cfg(any(test, not(debug_assertions)))]
use time::OffsetDateTime;
#[cfg(any(test, not(debug_assertions)))]
use time::format_description::well_known::Rfc3339;

#[cfg(not(debug_assertions))]
use crate::config::config_dir;

#[cfg(not(debug_assertions))]
const CLI_VERSION_CACHE_FILENAME: &str = "version.json";
#[cfg(not(debug_assertions))]
const CLI_NPM_DIST_TAGS_URL: &str =
    "https://registry.npmjs.org/-/package/@wordbricks%2fonequery/dist-tags";
#[cfg(not(debug_assertions))]
const CLI_VERSION_REFRESH_INTERVAL_HOURS: i64 = 20;

#[cfg(not(debug_assertions))]
type VersionResult<T> = Result<T, VersionError>;

#[cfg(not(debug_assertions))]
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
    #[error("failed to fetch latest CLI version from npm: {source}")]
    FetchLatest {
        #[source]
        source: reqwest::Error,
    },
    #[error("failed to format version cache timestamp: {source}")]
    FormatTimestamp {
        #[source]
        source: time::error::Format,
    },
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
    last_checked_at: String,
    #[serde(default)]
    dismissed_version: Option<String>,
}

#[cfg(any(test, not(debug_assertions)))]
#[derive(Deserialize, Debug, Clone)]
struct DistTagsInfo {
    latest: String,
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
            Some(info) => info
                .parsed_last_checked_at()
                .map(|timestamp| {
                    timestamp
                        < OffsetDateTime::now_utc()
                            - time::Duration::hours(CLI_VERSION_REFRESH_INTERVAL_HOURS)
                })
                .unwrap_or(true),
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
    let client = reqwest::Client::new();
    let latest_version = client
        .get(CLI_NPM_DIST_TAGS_URL)
        .header(USER_AGENT, format!("onequery/{}", env!("CARGO_PKG_VERSION")))
        .send()
        .await
        .map_err(|source| VersionError::FetchLatest { source })?
        .error_for_status()
        .map_err(|source| VersionError::FetchLatest { source })?
        .json::<DistTagsInfo>()
        .await
        .map_err(|source| VersionError::FetchLatest { source })?
        .latest;

    let info = VersionInfo {
        latest_version,
        last_checked_at: OffsetDateTime::now_utc()
            .format(&Rfc3339)
            .map_err(|source| VersionError::FormatTimestamp { source })?,
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

#[cfg(any(test, not(debug_assertions)))]
impl VersionInfo {
    fn parsed_last_checked_at(&self) -> Option<OffsetDateTime> {
        OffsetDateTime::parse(&self.last_checked_at, &Rfc3339).ok()
    }
}

#[cfg(test)]
mod tests {
    use pretty_assertions::assert_eq;

    use super::DistTagsInfo;
    use super::VersionInfo;

    #[test]
    fn parses_latest_version_from_npm_dist_tags_payload() {
        assert_eq!(
            serde_json::from_str::<DistTagsInfo>(r#"{"latest":"1.5.0","next":"1.6.0-beta.1"}"#,)
                .expect("failed to parse dist-tags payload")
                .latest,
            "1.5.0"
        );
    }

    #[test]
    fn dist_tags_payload_without_latest_is_invalid() {
        assert!(serde_json::from_str::<DistTagsInfo>(r#"{"next":"1.6.0-beta.1"}"#).is_err());
    }

    #[test]
    fn version_info_parses_rfc3339_timestamps() {
        let info = VersionInfo {
            latest_version: "0.1.2".to_owned(),
            last_checked_at: "2026-03-10T00:00:00Z".to_owned(),
            dismissed_version: None,
        };

        assert!(info.parsed_last_checked_at().is_some());
    }
}
