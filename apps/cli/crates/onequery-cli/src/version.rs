use std::path::Path;
use std::path::PathBuf;
use std::time::Duration as StdDuration;

use chrono::DateTime;
use chrono::Duration;
use chrono::Utc;
use serde::Deserialize;
use serde::Serialize;
use thiserror::Error;

const CLI_VERSION_CACHE_FILENAME: &str = "version.json";
const CLI_LATEST_RELEASE_URL: &str =
    "https://api.github.com/repos/wordbricks/onequery/releases/latest";
const CLI_VERSION_REFRESH_INTERVAL_HOURS: i64 = 20;
const CLI_VERSION_REFRESH_REQUEST_TIMEOUT: StdDuration = StdDuration::from_millis(250);

pub(crate) type VersionResult<T> = Result<T, VersionError>;

#[cfg_attr(any(test, debug_assertions), allow(dead_code))]
#[derive(Debug, Error)]
pub(crate) enum VersionError {
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

#[derive(Serialize, Deserialize, Debug, Clone, Eq, PartialEq)]
struct VersionInfo {
    latest_version: String,
    last_checked_at: DateTime<Utc>,
    #[serde(default)]
    dismissed_version: Option<String>,
}

#[derive(Deserialize, Debug, Clone)]
struct ReleaseInfo {
    tag_name: String,
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub(crate) struct VersionCacheRefreshPlan {
    version_file: PathBuf,
}

impl VersionCacheRefreshPlan {
    fn new(version_file: PathBuf) -> Self {
        Self { version_file }
    }
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub(crate) enum VersionCacheRefreshPlanning {
    FreshCache,
    Refresh(VersionCacheRefreshPlan),
}

pub(crate) fn plan_cache_refresh(config_path: &Path) -> VersionCacheRefreshPlanning {
    plan_cache_refresh_for_config_at(config_path, Utc::now())
}

pub(crate) async fn run_cache_refresh(plan: VersionCacheRefreshPlan) -> VersionResult<()> {
    refresh_cache(&plan).await
}

fn version_path_for_config(config_path: &Path) -> PathBuf {
    config_path
        .parent()
        .map(|home| home.join("state").join(CLI_VERSION_CACHE_FILENAME))
        .unwrap_or_else(|| config_path.with_file_name(CLI_VERSION_CACHE_FILENAME))
}

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

fn read_version_info_if_present(version_file: &Path) -> Option<VersionInfo> {
    read_version_info(version_file).ok()
}

async fn refresh_cache(plan: &VersionCacheRefreshPlan) -> VersionResult<()> {
    let latest_tag_name = tokio::task::spawn_blocking(fetch_latest_release_tag)
        .await
        .map_err(|source| VersionError::FetchLatestTask { source })??;

    let latest_version = extract_version_from_latest_tag(&latest_tag_name)?;

    let info = VersionInfo {
        latest_version,
        last_checked_at: Utc::now(),
        dismissed_version: read_version_info_if_present(plan.version_file.as_path())
            .and_then(|info| info.dismissed_version),
    };

    let json_line = format!(
        "{}\n",
        serde_json::to_string(&info).map_err(|source| VersionError::SerializeCache { source })?
    );
    if let Some(parent) = plan.version_file.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|source| VersionError::CreateCacheDir {
                path: parent.to_path_buf(),
                source,
            })?;
    }
    tokio::fs::write(plan.version_file.as_path(), json_line)
        .await
        .map_err(|source| VersionError::WriteCache {
            path: plan.version_file.clone(),
            source,
        })?;
    Ok(())
}

fn fetch_latest_release_tag() -> VersionResult<String> {
    let user_agent = format!("onequery/{}", env!("CARGO_PKG_VERSION"));
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .timeout_global(Some(CLI_VERSION_REFRESH_REQUEST_TIMEOUT))
        .build()
        .into();
    let mut response = agent
        .get(CLI_LATEST_RELEASE_URL)
        .header("user-agent", &user_agent)
        .call()
        .map_err(|source| VersionError::FetchLatest { source })?;

    response
        .body_mut()
        .read_json::<ReleaseInfo>()
        .map(|release| release.tag_name)
        .map_err(|source| VersionError::FetchLatest { source })
}

fn extract_version_from_latest_tag(latest_tag_name: &str) -> VersionResult<String> {
    latest_tag_name
        .strip_prefix("cli-v")
        .map(str::to_owned)
        .ok_or_else(|| VersionError::ParseLatestTag {
            tag_name: latest_tag_name.to_owned(),
        })
}

fn plan_cache_refresh_for_config_at(
    config_path: &Path,
    now: DateTime<Utc>,
) -> VersionCacheRefreshPlanning {
    plan_cache_refresh_for_file_at(version_path_for_config(config_path).as_path(), now)
}

fn plan_cache_refresh_for_file_at(
    version_file: &Path,
    now: DateTime<Utc>,
) -> VersionCacheRefreshPlanning {
    match read_version_info(version_file) {
        Ok(info) if !version_cache_is_stale(&info, now) => VersionCacheRefreshPlanning::FreshCache,
        Ok(_) | Err(_) => {
            // Comment: Version refresh is advisory, so unreadable cache state is treated as stale
            // and repaired on the next successful refresh instead of surfacing startup noise.
            VersionCacheRefreshPlanning::Refresh(VersionCacheRefreshPlan::new(
                version_file.to_path_buf(),
            ))
        }
    }
}

fn version_cache_is_stale(info: &VersionInfo, now: DateTime<Utc>) -> bool {
    now - info.last_checked_at >= Duration::hours(CLI_VERSION_REFRESH_INTERVAL_HOURS)
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::Path;
    use std::path::PathBuf;

    use chrono::Duration;
    use pretty_assertions::assert_eq;

    use super::ReleaseInfo;
    use super::VersionCacheRefreshPlan;
    use super::VersionCacheRefreshPlanning;
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
    fn plan_cache_refresh_requests_refresh_when_cache_is_missing() {
        let temp_dir = tempfile::tempdir().expect("failed to create tempdir");
        let version_file = temp_dir.path().join("version.json");

        assert_eq!(
            super::plan_cache_refresh_for_file_at(version_file.as_path(), Utc::now()),
            VersionCacheRefreshPlanning::Refresh(VersionCacheRefreshPlan::new(version_file))
        );
    }

    #[test]
    fn plan_cache_refresh_skips_recent_cache() {
        let temp_dir = tempfile::tempdir().expect("failed to create tempdir");
        let version_file = temp_dir.path().join("version.json");
        let now = Utc::now();
        let info = VersionInfo {
            latest_version: "0.1.2".to_owned(),
            last_checked_at: now - Duration::hours(1),
            dismissed_version: Some("0.1.2".to_owned()),
        };
        fs::write(
            &version_file,
            serde_json::to_string(&info).expect("failed to serialize version info"),
        )
        .expect("failed to write version info");

        assert_eq!(
            super::plan_cache_refresh_for_file_at(version_file.as_path(), now),
            VersionCacheRefreshPlanning::FreshCache
        );
    }

    #[test]
    fn plan_cache_refresh_requests_refresh_when_cache_is_stale() {
        let temp_dir = tempfile::tempdir().expect("failed to create tempdir");
        let version_file = temp_dir.path().join("version.json");
        let now = Utc::now();
        let info = VersionInfo {
            latest_version: "0.1.2".to_owned(),
            last_checked_at: now - Duration::hours(super::CLI_VERSION_REFRESH_INTERVAL_HOURS + 1),
            dismissed_version: None,
        };
        fs::write(
            &version_file,
            serde_json::to_string(&info).expect("failed to serialize version info"),
        )
        .expect("failed to write version info");

        assert_eq!(
            super::plan_cache_refresh_for_file_at(version_file.as_path(), now),
            VersionCacheRefreshPlanning::Refresh(VersionCacheRefreshPlan::new(version_file))
        );
    }

    #[test]
    fn plan_cache_refresh_requests_refresh_when_cache_is_invalid() {
        let temp_dir = tempfile::tempdir().expect("failed to create tempdir");
        let version_file = temp_dir.path().join("version.json");
        fs::write(&version_file, "{not-json").expect("failed to write invalid cache");

        assert_eq!(
            super::plan_cache_refresh_for_file_at(version_file.as_path(), Utc::now()),
            VersionCacheRefreshPlanning::Refresh(VersionCacheRefreshPlan::new(version_file))
        );
    }

    #[test]
    fn plan_cache_refresh_derives_the_cache_file_from_the_resolved_config_path() {
        let now = Utc::now();
        let config_path = Path::new("/tmp/onequery/config.toml");

        assert_eq!(
            super::plan_cache_refresh_for_config_at(config_path, now),
            VersionCacheRefreshPlanning::Refresh(VersionCacheRefreshPlan::new(PathBuf::from(
                "/tmp/onequery/state/version.json"
            )))
        );
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
