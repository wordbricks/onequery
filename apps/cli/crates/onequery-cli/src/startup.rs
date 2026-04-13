use std::time::Duration;

use crate::version;

const VERSION_CACHE_REFRESH_COMPLETION_TIMEOUT: Duration = Duration::from_millis(300);
const VERSION_CACHE_REFRESH_LABEL: &str = "cli_version_cache_refresh";

#[derive(Debug, Clone, Default, Eq, PartialEq)]
pub(crate) struct StartupPlan {
    version_cache_refresh: Option<version::VersionCacheRefreshPlan>,
}

pub(crate) fn plan(command_line: &str) -> StartupPlan {
    StartupPlan {
        version_cache_refresh: version::plan_cache_refresh(command_line),
    }
}

#[must_use = "startup effects must be finished before process exit to keep their lifetime bounded"]
pub(crate) struct PendingStartupEffects {
    version_cache_refresh: Option<RunningVersionCacheRefresh>,
}

pub(crate) fn start(plan: StartupPlan) -> PendingStartupEffects {
    PendingStartupEffects {
        version_cache_refresh: plan
            .version_cache_refresh
            .map(RunningVersionCacheRefresh::spawn),
    }
}

impl PendingStartupEffects {
    pub(crate) async fn finish(self) {
        if let Some(version_cache_refresh) = self.version_cache_refresh {
            version_cache_refresh.finish().await;
        }
    }
}

struct RunningVersionCacheRefresh {
    handle: tokio::task::JoinHandle<version::VersionResult<()>>,
    completion_timeout: Duration,
}

impl RunningVersionCacheRefresh {
    fn spawn(plan: version::VersionCacheRefreshPlan) -> Self {
        Self {
            handle: tokio::spawn(async move { version::run_cache_refresh(plan).await }),
            completion_timeout: VERSION_CACHE_REFRESH_COMPLETION_TIMEOUT,
        }
    }

    async fn finish(self) {
        let mut handle = self.handle;
        match tokio::time::timeout(self.completion_timeout, &mut handle).await {
            Ok(Ok(Ok(()))) => {}
            Ok(Ok(Err(error))) => {
                tracing::info!(
                    effect = VERSION_CACHE_REFRESH_LABEL,
                    error = %error,
                    "startup advisory effect failed"
                );
            }
            Ok(Err(join_error)) => {
                tracing::info!(
                    effect = VERSION_CACHE_REFRESH_LABEL,
                    error = %join_error,
                    "startup advisory effect failed"
                );
            }
            Err(_) => {
                handle.abort();
                tracing::info!(
                    effect = VERSION_CACHE_REFRESH_LABEL,
                    timeout_ms = self.completion_timeout.as_millis(),
                    "startup advisory effect timed out"
                );
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use tokio::time::sleep;

    use super::PendingStartupEffects;
    use super::RunningVersionCacheRefresh;

    #[tokio::test]
    async fn finish_returns_within_the_completion_timeout_for_slow_refresh_tasks() {
        let pending_effects = PendingStartupEffects {
            version_cache_refresh: Some(RunningVersionCacheRefresh {
                handle: tokio::spawn(async {
                    sleep(Duration::from_secs(60)).await;
                    Ok(())
                }),
                completion_timeout: Duration::from_millis(10),
            }),
        };

        tokio::time::timeout(Duration::from_millis(100), pending_effects.finish())
            .await
            .expect("startup finish should stay bounded");
    }

    #[tokio::test]
    async fn finish_accepts_failed_refresh_tasks_without_panicking() {
        let pending_effects = PendingStartupEffects {
            version_cache_refresh: Some(RunningVersionCacheRefresh {
                handle: tokio::spawn(async {
                    Err(crate::version::VersionError::ParseLatestTag {
                        tag_name: "v1.2.3".to_owned(),
                    })
                }),
                completion_timeout: Duration::from_millis(10),
            }),
        };

        pending_effects.finish().await;
    }
}
