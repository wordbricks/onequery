use onequery_core::error::CliError;

use crate::transport::api_failure::ApiFailure;
use crate::workflows::retry::RetryTransition;
use crate::workflows::retry::classify_retry_directive;
use crate::workflows::retry::plan_retry_transition;
use crate::workflows::runner::Transition;

use super::completion::failed_state;
use super::state::SourceApiEffect;
use super::state::SourceApiRetryTarget;
use super::state::SourceApiState;
use super::state::SourceApiTerminalState;
use super::state::SourceApiTransition;
use super::state::WaitingToRetrySourceApiState;

pub(super) const SOURCE_API_MAX_ATTEMPTS: u8 = 3;
pub(super) const SOURCE_API_RETRY_DELAY_MS: u64 = 250;

pub(super) fn retry_or_fail(
    error: CliError,
    retry: RetryTransition,
    target: SourceApiRetryTarget,
) -> SourceApiTransition {
    match retry {
        RetryTransition::RetryScheduled {
            next_attempt,
            delay_ms,
            ..
        } => Transition::continue_with_effect(
            SourceApiState::WaitingToRetry(WaitingToRetrySourceApiState {
                next_attempt,
                target,
            }),
            SourceApiEffect::WaitBeforeRetry {
                delay_ms,
                next_attempt,
            },
        ),
        RetryTransition::NeedsReauth => {
            Transition::done(SourceApiTerminalState::NeedsReauth { error })
        }
        RetryTransition::RetryExhausted { .. } | RetryTransition::RetryNotAllowed => {
            Transition::done(failed_state(error))
        }
    }
}

pub(super) fn plan_source_api_retry(attempt: u8, failure: &ApiFailure) -> RetryTransition {
    plan_retry_transition(
        attempt,
        SOURCE_API_MAX_ATTEMPTS,
        SOURCE_API_RETRY_DELAY_MS,
        classify_retry_directive(failure),
    )
}
