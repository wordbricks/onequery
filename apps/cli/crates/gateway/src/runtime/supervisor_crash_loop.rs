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
    use proptest::prelude::*;

    use super::SupervisorCrashLoopDecision;
    use super::SupervisorCrashLoopPolicy;
    use std::time::Duration;

    proptest! {
        #[test]
        fn bounded_policy_caps_restarts_with_exponential_backoff(
            max_restarts in 0_u32..128,
            completed_restarts in 0_u32..160,
            initial_backoff_millis in 0_u64..10_000,
            max_backoff_millis in 0_u64..10_000,
        ) {
            let initial_backoff = Duration::from_millis(initial_backoff_millis);
            let max_backoff = Duration::from_millis(max_backoff_millis);
            let policy = SupervisorCrashLoopPolicy::bounded(
                max_restarts,
                initial_backoff,
                max_backoff,
            );
            let decision = policy.decision_after_unexpected_exit(completed_restarts);

            if max_restarts == 0 || completed_restarts >= max_restarts {
                prop_assert_eq!(decision, SupervisorCrashLoopDecision::TerminalFailure);
            } else {
                let attempt = completed_restarts + 1;
                let exponent = attempt.saturating_sub(1).min(31);
                let multiplier = 1_u32.checked_shl(exponent).unwrap_or(u32::MAX);
                let expected_backoff = initial_backoff
                    .saturating_mul(multiplier)
                    .min(max_backoff.max(initial_backoff));

                prop_assert_eq!(
                    decision,
                    SupervisorCrashLoopDecision::Restart {
                        attempt,
                        backoff: expected_backoff,
                    }
                );
            }
        }
    }
}
