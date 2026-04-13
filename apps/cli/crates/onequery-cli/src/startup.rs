use std::path::Path;
use std::time::Duration;

use crate::version;

const VERSION_CACHE_REFRESH_COMPLETION_TIMEOUT: Duration = Duration::from_millis(300);
const VERSION_CACHE_REFRESH_LABEL: &str = "cli_version_cache_refresh";

#[derive(Debug, Clone, Eq, PartialEq)]
pub(crate) struct StartupPlan {
    version_cache_refresh: version::VersionCacheRefreshPlanning,
}

pub(crate) fn plan(config_path: &Path) -> StartupPlan {
    StartupPlan {
        version_cache_refresh: version::plan_cache_refresh(config_path),
    }
}

#[must_use = "startup effects must be finished before process exit to keep their lifetime bounded"]
pub(crate) struct PendingStartupEffects {
    version_cache_refresh: PendingVersionCacheRefresh,
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub(crate) struct StartupOutcome {
    version_cache_refresh: VersionCacheRefreshOutcome,
}

impl StartupOutcome {
    pub(crate) fn report(self) {
        match self.version_cache_refresh {
            VersionCacheRefreshOutcome::FreshCache | VersionCacheRefreshOutcome::Refreshed => {}
            VersionCacheRefreshOutcome::Failed { error } => {
                tracing::info!(
                    effect = VERSION_CACHE_REFRESH_LABEL,
                    error,
                    "startup advisory effect failed"
                );
            }
            VersionCacheRefreshOutcome::TimedOut { timeout_ms } => {
                tracing::info!(
                    effect = VERSION_CACHE_REFRESH_LABEL,
                    timeout_ms,
                    "startup advisory effect timed out"
                );
            }
        }
    }
}

pub(crate) fn start(plan: StartupPlan) -> PendingStartupEffects {
    PendingStartupEffects {
        version_cache_refresh: match plan.version_cache_refresh {
            version::VersionCacheRefreshPlanning::FreshCache => {
                PendingVersionCacheRefresh::FreshCache
            }
            version::VersionCacheRefreshPlanning::Refresh(plan) => {
                PendingVersionCacheRefresh::Running(RunningVersionCacheRefresh::spawn(plan))
            }
        },
    }
}

impl PendingStartupEffects {
    pub(crate) async fn finish(self) -> StartupOutcome {
        StartupOutcome {
            version_cache_refresh: self.version_cache_refresh.finish().await,
        }
    }
}

#[derive(Debug, Clone, Eq, PartialEq)]
enum VersionCacheRefreshOutcome {
    FreshCache,
    Refreshed,
    Failed { error: String },
    TimedOut { timeout_ms: u128 },
}

enum PendingVersionCacheRefresh {
    FreshCache,
    Running(RunningVersionCacheRefresh),
}

impl PendingVersionCacheRefresh {
    async fn finish(self) -> VersionCacheRefreshOutcome {
        match self {
            Self::FreshCache => VersionCacheRefreshOutcome::FreshCache,
            PendingVersionCacheRefresh::Running(version_cache_refresh) => {
                version_cache_refresh.finish().await
            }
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

    async fn finish(self) -> VersionCacheRefreshOutcome {
        let mut handle = self.handle;
        match tokio::time::timeout(self.completion_timeout, &mut handle).await {
            Ok(Ok(Ok(()))) => VersionCacheRefreshOutcome::Refreshed,
            Ok(Ok(Err(error))) => VersionCacheRefreshOutcome::Failed {
                error: error.to_string(),
            },
            Ok(Err(join_error)) => VersionCacheRefreshOutcome::Failed {
                error: join_error.to_string(),
            },
            Err(_) => {
                handle.abort();
                VersionCacheRefreshOutcome::TimedOut {
                    timeout_ms: self.completion_timeout.as_millis(),
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use std::path::Path;
    use std::time::Duration;

    use tokio::time::sleep;

    use super::PendingStartupEffects;
    use super::PendingVersionCacheRefresh;
    use super::RunningVersionCacheRefresh;
    use super::StartupOutcome;
    use super::VersionCacheRefreshOutcome;
    use pretty_assertions::assert_eq;

    #[tokio::test]
    async fn finish_returns_within_the_completion_timeout_for_slow_refresh_tasks() {
        let pending_effects = PendingStartupEffects {
            version_cache_refresh: PendingVersionCacheRefresh::Running(
                RunningVersionCacheRefresh {
                    handle: tokio::spawn(async {
                        sleep(Duration::from_secs(60)).await;
                        Ok(())
                    }),
                    completion_timeout: Duration::from_millis(10),
                },
            ),
        };

        let outcome = tokio::time::timeout(Duration::from_millis(100), pending_effects.finish())
            .await
            .expect("startup finish should stay bounded");

        assert_eq!(
            outcome,
            StartupOutcome {
                version_cache_refresh: VersionCacheRefreshOutcome::TimedOut { timeout_ms: 10 },
            }
        );
    }

    #[tokio::test]
    async fn finish_accepts_failed_refresh_tasks_without_panicking() {
        let pending_effects = PendingStartupEffects {
            version_cache_refresh: PendingVersionCacheRefresh::Running(
                RunningVersionCacheRefresh {
                    handle: tokio::spawn(async {
                        Err(crate::version::VersionError::ParseLatestTag {
                            tag_name: "v1.2.3".to_owned(),
                        })
                    }),
                    completion_timeout: Duration::from_millis(10),
                },
            ),
        };

        assert_eq!(
            pending_effects.finish().await,
            StartupOutcome {
                version_cache_refresh: VersionCacheRefreshOutcome::Failed {
                    error: "failed to parse latest CLI release tag 'v1.2.3'".to_owned(),
                },
            }
        );
    }

    #[tokio::test]
    async fn finish_reports_fresh_cache_without_spawning_work() {
        assert_eq!(
            PendingStartupEffects {
                version_cache_refresh: PendingVersionCacheRefresh::FreshCache,
            }
            .finish()
            .await,
            StartupOutcome {
                version_cache_refresh: VersionCacheRefreshOutcome::FreshCache,
            }
        );
    }

    #[test]
    fn plan_delegates_to_the_version_refresh_planner() {
        let config_path = Path::new("/tmp/onequery/config.toml");

        assert_eq!(
            super::plan(config_path),
            super::StartupPlan {
                version_cache_refresh: crate::version::plan_cache_refresh(config_path),
            }
        );
    }
}
