use std::sync::Mutex;
use std::sync::MutexGuard;
use std::sync::OnceLock;

static TRACING_SUBSCRIBER_TEST_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

// Comment: Keep this semantically aligned with the TS sample master key. The
// contract is "valid base64 that decodes to 32 bytes", not this exact literal.
pub(crate) const TEST_MASTER_ENCRYPTION_KEY: &str = "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=";

pub(crate) fn lock_tracing_subscriber() -> MutexGuard<'static, ()> {
    TRACING_SUBSCRIBER_TEST_LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

/// Returns insta settings that collapse any explicit GitHub issue draft URL to
/// a stable `<REPORT_URL>` placeholder. The URL payload is covered by
/// `issue_report::tests`, so higher-level snapshots only need to confirm that a
/// report or issue affordance was rendered in the right place.
pub(crate) fn snapshot_settings_with_issue_url_filter() -> insta::Settings {
    let mut settings = insta::Settings::clone_current();
    settings.add_filter(
        r"https://github\.com/wordbricks/onequery/issues/new\?\S+",
        "<REPORT_URL>",
    );
    settings
}
