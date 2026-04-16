use crate::transport::api_failure::ApiFailure;

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub(crate) enum RetryDirective {
    RetryAllowed,
    RetryNotAllowed,
    NeedsReauth,
}

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub(crate) enum RetryTransition {
    RetryScheduled {
        next_attempt: u8,
        max_attempts: u8,
        delay_ms: u64,
    },
    RetryExhausted {
        attempts: u8,
        max_attempts: u8,
    },
    NeedsReauth,
    RetryNotAllowed,
}

pub(crate) fn classify_retry_directive(failure: &ApiFailure) -> RetryDirective {
    match failure {
        ApiFailure::Problem(problem) if problem.is_auth_error() => RetryDirective::NeedsReauth,
        _ if failure.is_retryable() => RetryDirective::RetryAllowed,
        _ => RetryDirective::RetryNotAllowed,
    }
}

pub(crate) fn plan_retry_transition(
    attempt: u8,
    max_attempts: u8,
    delay_ms: u64,
    directive: RetryDirective,
) -> RetryTransition {
    match directive {
        RetryDirective::RetryAllowed if attempt < max_attempts => RetryTransition::RetryScheduled {
            next_attempt: attempt.saturating_add(1),
            max_attempts,
            delay_ms,
        },
        RetryDirective::RetryAllowed => RetryTransition::RetryExhausted {
            attempts: attempt,
            max_attempts,
        },
        RetryDirective::NeedsReauth => RetryTransition::NeedsReauth,
        RetryDirective::RetryNotAllowed => RetryTransition::RetryNotAllowed,
    }
}

#[cfg(test)]
mod tests {
    use onequery_cli_core::error::ErrorStage;
    use pretty_assertions::assert_eq;

    use crate::transport::api_failure::ApiFailure;
    use crate::transport::api_failure::ApiProblem;
    use crate::transport::api_failure::TransportFailure;
    use crate::transport::api_failure::TransportFailureKind;
    use crate::transport::generated::types;

    use super::RetryDirective;
    use super::RetryTransition;
    use super::classify_retry_directive;
    use super::plan_retry_transition;

    #[test]
    fn unauthorized_failures_require_reauth_even_if_they_are_not_retryable() {
        let directive = classify_retry_directive(&ApiFailure::Problem(ApiProblem {
            title: "Not Logged In".to_owned(),
            detail: "stored credentials are no longer authorized".to_owned(),
            code: types::ProblemCode::PROBLEM_CODE_NOT_LOGGED_IN,
            retryable: false,
            retry_after_ms: None,
            stage: ErrorStage::Auth,
            hint: None,
            request_id: None,
            validation_issues: Vec::new(),
        }));

        assert_eq!(directive, RetryDirective::NeedsReauth);
    }

    #[test]
    fn transient_transport_failures_are_classified_as_retry_allowed() {
        assert_eq!(
            classify_retry_directive(&ApiFailure::Transport(TransportFailure {
                kind: TransportFailureKind::SendRequest,
                stage: ErrorStage::Http,
                message: "timeout".to_owned(),
                retryable: true,
            })),
            RetryDirective::RetryAllowed
        );
    }

    #[test]
    fn retry_allowed_failures_schedule_the_next_attempt_before_max_attempts() {
        assert_eq!(
            plan_retry_transition(1, 3, 250, RetryDirective::RetryAllowed),
            RetryTransition::RetryScheduled {
                next_attempt: 2,
                max_attempts: 3,
                delay_ms: 250,
            }
        );
    }

    #[test]
    fn retryable_failures_become_exhausted_at_max_attempts() {
        assert_eq!(
            plan_retry_transition(3, 3, 250, RetryDirective::RetryAllowed),
            RetryTransition::RetryExhausted {
                attempts: 3,
                max_attempts: 3,
            }
        );
    }
}
