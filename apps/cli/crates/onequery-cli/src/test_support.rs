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
