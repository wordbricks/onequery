use std::sync::Mutex;
use std::sync::MutexGuard;
use std::sync::OnceLock;

static TRACING_SUBSCRIBER_TEST_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

pub(crate) fn lock_tracing_subscriber() -> MutexGuard<'static, ()> {
    TRACING_SUBSCRIBER_TEST_LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}
