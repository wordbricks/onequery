use crate::transport::api_failure::ApiFailure;
use crate::transport::auth::LoginPollOutcome;
use crate::transport::auth::LoginSession;
use crate::workflows::runner::Transition;
use crate::workflows::runner::WorkflowLabel;

const MIN_LOGIN_POLL_INTERVAL_MS: u64 = 250;

#[derive(Debug, Clone)]
pub(crate) enum LoginPollState {
    Idle {
        session: LoginSession,
    },
    Polling {
        session: LoginSession,
        attempt: u32,
        elapsed_ms: u64,
    },
    Waiting {
        session: LoginSession,
        next_attempt: u32,
        elapsed_ms: u64,
    },
}

#[derive(Debug, Eq, PartialEq)]
pub(crate) enum LoginPollTerminalState {
    Authorized { access_token: String },
    Denied,
    Expired,
    TimedOut { expires_in_sec: u64 },
    TransportFailed { failure: ApiFailure },
    InternalError { message: String },
}

#[derive(Debug)]
pub(crate) enum LoginPollEvent {
    Start,
    PollSucceeded { outcome: LoginPollOutcome },
    PollFailed { failure: ApiFailure },
    WaitElapsed,
}

#[derive(Debug, Eq, PartialEq)]
pub(crate) enum LoginPollEffect {
    PollOnce { session: LoginSession },
    WaitBeforeNextPoll { next_attempt: u32, delay_ms: u64 },
}

pub(crate) fn reduce(
    state: LoginPollState,
    event: LoginPollEvent,
) -> Transition<LoginPollState, LoginPollTerminalState, LoginPollEffect> {
    match state {
        LoginPollState::Idle { session } => match event {
            LoginPollEvent::Start => {
                if session.expires_in_sec == 0 {
                    return Transition::done(LoginPollTerminalState::TimedOut {
                        expires_in_sec: 0,
                    });
                }

                // CONTEXT: the reducer runner keeps workflow state/effects on one task and does
                // not require `Send`, so cloning the session here is simpler than thread-safe
                // shared ownership.
                Transition::continue_with_effect(
                    LoginPollState::Polling {
                        session: session.clone(),
                        attempt: 1,
                        elapsed_ms: 0,
                    },
                    LoginPollEffect::PollOnce { session },
                )
            }
            LoginPollEvent::PollSucceeded { .. }
            | LoginPollEvent::PollFailed { .. }
            | LoginPollEvent::WaitElapsed => unexpected_transition("Idle", &event),
        },
        LoginPollState::Polling {
            session,
            attempt,
            elapsed_ms,
        } => match event {
            LoginPollEvent::PollSucceeded {
                outcome: LoginPollOutcome::Authorized { access_token },
            } => Transition::done(LoginPollTerminalState::Authorized { access_token }),
            LoginPollEvent::PollSucceeded {
                outcome: LoginPollOutcome::Denied,
            } => Transition::done(LoginPollTerminalState::Denied),
            LoginPollEvent::PollSucceeded {
                outcome: LoginPollOutcome::Expired,
            } => Transition::done(LoginPollTerminalState::Expired),
            LoginPollEvent::PollSucceeded {
                outcome: LoginPollOutcome::Pending { poll_after_ms },
            } => wait_for_next_attempt(
                session,
                attempt,
                elapsed_ms,
                normalized_poll_delay_ms(poll_after_ms),
            ),
            LoginPollEvent::PollSucceeded {
                outcome: LoginPollOutcome::RateLimited { poll_after_ms },
            } => wait_for_next_attempt(
                session,
                attempt,
                elapsed_ms,
                normalized_poll_delay_ms(poll_after_ms),
            ),
            LoginPollEvent::PollFailed { failure } => {
                Transition::done(LoginPollTerminalState::TransportFailed { failure })
            }
            LoginPollEvent::Start | LoginPollEvent::WaitElapsed => {
                unexpected_transition("Polling", &event)
            }
        },
        LoginPollState::Waiting {
            session,
            next_attempt,
            elapsed_ms,
        } => match event {
            LoginPollEvent::WaitElapsed => Transition::continue_with_effect(
                LoginPollState::Polling {
                    session: session.clone(),
                    attempt: next_attempt,
                    elapsed_ms,
                },
                LoginPollEffect::PollOnce { session },
            ),
            LoginPollEvent::Start
            | LoginPollEvent::PollSucceeded { .. }
            | LoginPollEvent::PollFailed { .. } => unexpected_transition("Waiting", &event),
        },
    }
}

fn wait_for_next_attempt(
    session: LoginSession,
    attempt: u32,
    elapsed_ms: u64,
    delay_ms: u64,
) -> Transition<LoginPollState, LoginPollTerminalState, LoginPollEffect> {
    let next_elapsed_ms = elapsed_ms.saturating_add(delay_ms);
    if next_elapsed_ms >= poll_expiry_ms(&session) {
        return Transition::done(LoginPollTerminalState::TimedOut {
            expires_in_sec: session.expires_in_sec,
        });
    }

    let next_attempt = attempt.saturating_add(1);

    Transition::continue_with_effect(
        LoginPollState::Waiting {
            session,
            next_attempt,
            elapsed_ms: next_elapsed_ms,
        },
        LoginPollEffect::WaitBeforeNextPoll {
            next_attempt,
            delay_ms,
        },
    )
}

fn unexpected_transition(
    state_name: &str,
    event: &LoginPollEvent,
) -> Transition<LoginPollState, LoginPollTerminalState, LoginPollEffect> {
    Transition::done(LoginPollTerminalState::InternalError {
        message: format!(
            "unexpected login poll workflow transition: state={state_name}, event={}",
            event.workflow_label()
        ),
    })
}

fn normalized_poll_delay_ms(delay_ms: u64) -> u64 {
    delay_ms.max(MIN_LOGIN_POLL_INTERVAL_MS)
}

fn poll_expiry_ms(session: &LoginSession) -> u64 {
    session.expires_in_sec.saturating_mul(1000)
}

impl WorkflowLabel for LoginPollState {
    fn workflow_label(&self) -> &'static str {
        match self {
            Self::Idle { .. } => "Idle",
            Self::Polling { .. } => "Polling",
            Self::Waiting { .. } => "Waiting",
        }
    }
}

impl WorkflowLabel for LoginPollTerminalState {
    fn workflow_label(&self) -> &'static str {
        match self {
            Self::Authorized { .. } => "Authorized",
            Self::Denied => "Denied",
            Self::Expired => "Expired",
            Self::TimedOut { .. } => "TimedOut",
            Self::TransportFailed { .. } => "TransportFailed",
            Self::InternalError { .. } => "InternalError",
        }
    }
}

impl WorkflowLabel for LoginPollEvent {
    fn workflow_label(&self) -> &'static str {
        match self {
            Self::Start => "Start",
            Self::PollSucceeded { .. } => "PollSucceeded",
            Self::PollFailed { .. } => "PollFailed",
            Self::WaitElapsed => "WaitElapsed",
        }
    }
}

impl WorkflowLabel for LoginPollEffect {
    fn workflow_label(&self) -> &'static str {
        match self {
            Self::PollOnce { .. } => "PollOnce",
            Self::WaitBeforeNextPoll { .. } => "WaitBeforeNextPoll",
        }
    }
}

#[cfg(test)]
mod tests {
    use pretty_assertions::assert_eq;

    use crate::transport::auth::LoginPollOutcome;
    use crate::transport::auth::LoginSession;
    use crate::workflows::runner::TransitionProgress;

    use super::LoginPollEffect;
    use super::LoginPollEvent;
    use super::LoginPollState;
    use super::LoginPollTerminalState;
    use super::reduce;

    fn sample_session() -> LoginSession {
        LoginSession {
            device_code: "device-code-123".to_owned(),
            user_code: "ABCD1234".to_owned(),
            verification_uri: "https://example.test/device".to_owned(),
            verification_uri_complete: "https://example.test/device?user_code=ABCD1234".to_owned(),
            expires_in_sec: 3,
        }
    }

    #[test]
    fn start_enters_polling_with_the_initial_server_interval() {
        let transition = reduce(
            LoginPollState::Idle {
                session: sample_session(),
            },
            LoginPollEvent::Start,
        );

        match transition.into_progress() {
            TransitionProgress::Continue {
                next_state:
                    LoginPollState::Polling {
                        session,
                        attempt,
                        elapsed_ms,
                    },
                effect:
                    LoginPollEffect::PollOnce {
                        session: effect_session,
                    },
            } => assert_eq!(
                (session, effect_session, attempt, elapsed_ms),
                (sample_session(), sample_session(), 1, 0)
            ),
            other => panic!("expected login poll to start polling, got {other:?}"),
        }
    }

    #[test]
    fn pending_poll_waits_for_the_next_attempt() {
        let transition = reduce(
            LoginPollState::Polling {
                session: sample_session(),
                attempt: 1,
                elapsed_ms: 0,
            },
            LoginPollEvent::PollSucceeded {
                outcome: LoginPollOutcome::Pending {
                    poll_after_ms: 1_000,
                },
            },
        );

        match transition.into_progress() {
            TransitionProgress::Continue {
                next_state:
                    LoginPollState::Waiting {
                        session,
                        next_attempt,
                        elapsed_ms,
                    },
                effect:
                    LoginPollEffect::WaitBeforeNextPoll {
                        next_attempt: effect_attempt,
                        delay_ms: effect_delay_ms,
                    },
            } => assert_eq!(
                (
                    session,
                    next_attempt,
                    elapsed_ms,
                    effect_attempt,
                    effect_delay_ms,
                ),
                (sample_session(), 2, 1_000, 2, 1_000)
            ),
            other => panic!("expected login poll to wait before next attempt, got {other:?}"),
        }
    }

    #[test]
    fn rate_limited_poll_uses_the_server_next_poll_delay() {
        let session = LoginSession {
            expires_in_sec: 10,
            ..sample_session()
        };
        let transition = reduce(
            LoginPollState::Polling {
                session,
                attempt: 1,
                elapsed_ms: 0,
            },
            LoginPollEvent::PollSucceeded {
                outcome: LoginPollOutcome::RateLimited {
                    poll_after_ms: 6_000,
                },
            },
        );

        match transition.into_progress() {
            TransitionProgress::Continue {
                next_state:
                    LoginPollState::Waiting {
                        next_attempt,
                        elapsed_ms,
                        ..
                    },
                effect:
                    LoginPollEffect::WaitBeforeNextPoll {
                        next_attempt: effect_attempt,
                        delay_ms: effect_delay_ms,
                    },
            } => assert_eq!(
                (next_attempt, elapsed_ms, effect_attempt, effect_delay_ms,),
                (2, 6_000, 2, 6_000)
            ),
            other => panic!("expected login poll rate limit wait, got {other:?}"),
        }
    }

    #[test]
    fn pending_poll_times_out_once_the_expiry_budget_is_spent() {
        let transition = reduce(
            LoginPollState::Polling {
                session: sample_session(),
                attempt: 3,
                elapsed_ms: 2_000,
            },
            LoginPollEvent::PollSucceeded {
                outcome: LoginPollOutcome::Pending {
                    poll_after_ms: 1_000,
                },
            },
        );

        match transition.into_progress() {
            TransitionProgress::Done {
                terminal_state: LoginPollTerminalState::TimedOut { expires_in_sec },
            } => assert_eq!(expires_in_sec, 3),
            other => panic!("expected login poll timeout, got {other:?}"),
        }
    }

    #[test]
    fn authorized_poll_returns_the_access_token() {
        let transition = reduce(
            LoginPollState::Polling {
                session: sample_session(),
                attempt: 1,
                elapsed_ms: 0,
            },
            LoginPollEvent::PollSucceeded {
                outcome: LoginPollOutcome::Authorized {
                    access_token: "token".to_owned(),
                },
            },
        );

        match transition.into_progress() {
            TransitionProgress::Done {
                terminal_state: LoginPollTerminalState::Authorized { access_token },
            } => assert_eq!(access_token, "token"),
            other => panic!("expected authorized login poll terminal state, got {other:?}"),
        }
    }

    #[test]
    fn denied_poll_ends_the_workflow() {
        let transition = reduce(
            LoginPollState::Polling {
                session: sample_session(),
                attempt: 1,
                elapsed_ms: 0,
            },
            LoginPollEvent::PollSucceeded {
                outcome: LoginPollOutcome::Denied,
            },
        );

        match transition.into_progress() {
            TransitionProgress::Done {
                terminal_state: LoginPollTerminalState::Denied,
            } => {}
            other => panic!("expected denied login poll terminal state, got {other:?}"),
        }
    }
}
