use std::time::Duration;

#[derive(Debug, Clone, Copy, Eq, PartialEq, Default)]
pub(super) enum SupervisorCrashLoopPolicy {
    #[default]
    Disabled,
    Bounded(SupervisorCrashLoopBounds),
}

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub(super) struct SupervisorCrashLoopBounds {
    max_restarts: u32,
    initial_backoff: Duration,
    max_backoff: Duration,
}

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub(super) enum SupervisorCrashLoopDecision {
    TerminalFailure,
    Restart { attempt: u32, backoff: Duration },
}

impl SupervisorCrashLoopPolicy {
    pub(super) const fn disabled() -> Self {
        Self::Disabled
    }

    pub(super) fn bounded(
        max_restarts: u32,
        initial_backoff: Duration,
        max_backoff: Duration,
    ) -> Self {
        if max_restarts == 0 {
            return Self::Disabled;
        }

        Self::Bounded(SupervisorCrashLoopBounds {
            max_restarts,
            initial_backoff,
            max_backoff: max_backoff.max(initial_backoff),
        })
    }

    pub(super) fn decision_after_unexpected_exit(
        self,
        completed_restarts: u32,
    ) -> SupervisorCrashLoopDecision {
        let Self::Bounded(bounds) = self else {
            return SupervisorCrashLoopDecision::TerminalFailure;
        };

        if completed_restarts >= bounds.max_restarts {
            return SupervisorCrashLoopDecision::TerminalFailure;
        }

        let attempt = completed_restarts.saturating_add(1);
        SupervisorCrashLoopDecision::Restart {
            attempt,
            backoff: bounds.backoff_for_attempt(attempt),
        }
    }
}

impl SupervisorCrashLoopBounds {
    fn backoff_for_attempt(self, attempt: u32) -> Duration {
        let exponent = attempt.saturating_sub(1).min(31);
        let multiplier = 1_u32.checked_shl(exponent).unwrap_or(u32::MAX);

        self.initial_backoff
            .saturating_mul(multiplier)
            .min(self.max_backoff)
    }
}

#[cfg(test)]
mod tests {
    use pretty_assertions::assert_eq;

    use super::SupervisorCrashLoopDecision;
    use super::SupervisorCrashLoopPolicy;
    use std::time::Duration;

    #[test]
    fn disabled_policy_keeps_unexpected_exit_terminal() {
        assert_eq!(
            SupervisorCrashLoopPolicy::disabled().decision_after_unexpected_exit(0),
            SupervisorCrashLoopDecision::TerminalFailure
        );
    }

    #[test]
    fn bounded_policy_caps_restarts_with_exponential_backoff() {
        let policy = SupervisorCrashLoopPolicy::bounded(
            3,
            Duration::from_millis(100),
            Duration::from_millis(250),
        );

        assert_eq!(
            policy.decision_after_unexpected_exit(0),
            SupervisorCrashLoopDecision::Restart {
                attempt: 1,
                backoff: Duration::from_millis(100),
            }
        );
        assert_eq!(
            policy.decision_after_unexpected_exit(1),
            SupervisorCrashLoopDecision::Restart {
                attempt: 2,
                backoff: Duration::from_millis(200),
            }
        );
        assert_eq!(
            policy.decision_after_unexpected_exit(2),
            SupervisorCrashLoopDecision::Restart {
                attempt: 3,
                backoff: Duration::from_millis(250),
            }
        );
        assert_eq!(
            policy.decision_after_unexpected_exit(3),
            SupervisorCrashLoopDecision::TerminalFailure
        );
    }
}
