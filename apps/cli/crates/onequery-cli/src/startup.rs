use crate::version;

#[derive(Debug, Clone, Default, Eq, PartialEq)]
pub(crate) struct StartupPlan {
    version_cache_refresh: Option<version::VersionCacheRefreshPlan>,
}

pub(crate) fn plan(command_line: &str) -> StartupPlan {
    StartupPlan {
        version_cache_refresh: version::plan_cache_refresh(command_line),
    }
}

pub(crate) fn dispatch(plan: StartupPlan) {
    let StartupPlan {
        version_cache_refresh,
    } = plan;

    if let Some(version_cache_refresh) = version_cache_refresh {
        tokio::spawn(async move {
            version::run_cache_refresh(version_cache_refresh).await;
        });
    }
}
