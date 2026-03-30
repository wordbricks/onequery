use crate::error::WtlError;
use crate::observer::Observer;
use crate::policy::ExecutionPlan;
use crate::policy::LoopPolicy;
use crate::policy::PolicyDirective;
use crate::runtime::TurnOutcome;
use crate::runtime::TurnRuntime;

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub struct EngineConfig {
    pub max_iter: usize,
    pub max_retry: usize,
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub enum RunTerminalState {
    Completed,
    Exhausted { message: String },
    Interrupted,
}

#[derive(Debug, Clone, Eq, PartialEq)]
enum RunState<S>
where
    S: Clone + std::fmt::Debug + Eq + PartialEq,
{
    Idle,
    Bootstrapping {
        policy_state: S,
        initial_plan: ExecutionPlan,
    },
    TurnInFlight {
        thread_id: String,
        turn_number: usize,
        retry_count: usize,
        policy_state: S,
    },
}

#[derive(Debug, Clone, Eq, PartialEq)]
enum RunEvent {
    Start,
    SessionStarted { thread_id: String },
    TurnFinished { outcome: TurnOutcome },
    Interrupted,
}

#[derive(Debug, Clone, Eq, PartialEq)]
enum RunEffect {
    BootstrapSession {
        developer_instructions: String,
    },
    StartTurn {
        thread_id: String,
        turn_number: usize,
        plan: ExecutionPlan,
    },
}

#[derive(Debug, Clone, Eq, PartialEq)]
enum Transition<S>
where
    S: Clone + std::fmt::Debug + Eq + PartialEq,
{
    Continue {
        next_state: RunState<S>,
        effect: RunEffect,
    },
    Done(RunTerminalState),
}

#[derive(Debug, Clone)]
struct RunContext<P>
where
    P: LoopPolicy,
{
    config: EngineConfig,
    policy: P,
}

pub async fn run<P, O, R>(
    config: EngineConfig,
    policy: P,
    runtime: &mut R,
    observer: &mut O,
) -> Result<RunTerminalState, WtlError>
where
    P: LoopPolicy,
    O: Observer,
    R: TurnRuntime,
{
    let mut state = RunState::Idle;
    let mut event = RunEvent::Start;
    let context = RunContext { config, policy };

    loop {
        match reduce(state, event, &context) {
            Transition::Continue { next_state, effect } => {
                state = next_state;
                event = tokio::select! {
                    result = execute_effect(effect, runtime, observer) => result?,
                    _ = tokio::signal::ctrl_c() => {
                        let _ = runtime.shutdown().await;
                        RunEvent::Interrupted
                    }
                };
            }
            Transition::Done(terminal_state) => {
                match &terminal_state {
                    RunTerminalState::Completed => observer.on_run_completed()?,
                    RunTerminalState::Exhausted { message } => {
                        observer.on_run_exhausted(message)?
                    }
                    RunTerminalState::Interrupted => observer.on_run_interrupted()?,
                }

                let _ = runtime.shutdown().await;
                return Ok(terminal_state);
            }
        }
    }
}

fn reduce<P>(
    state: RunState<P::State>,
    event: RunEvent,
    context: &RunContext<P>,
) -> Transition<P::State>
where
    P: LoopPolicy,
{
    match (state, event) {
        (RunState::Idle, RunEvent::Start) => Transition::Continue {
            next_state: RunState::Bootstrapping {
                policy_state: context.policy.initial_state(),
                initial_plan: context.policy.initial_plan(),
            },
            effect: RunEffect::BootstrapSession {
                developer_instructions: context.policy.developer_instructions(),
            },
        },
        (
            RunState::Bootstrapping {
                policy_state,
                initial_plan,
            },
            RunEvent::SessionStarted { thread_id },
        ) => Transition::Continue {
            next_state: RunState::TurnInFlight {
                thread_id: thread_id.clone(),
                turn_number: 1,
                retry_count: 0,
                policy_state,
            },
            effect: RunEffect::StartTurn {
                thread_id,
                turn_number: 1,
                plan: initial_plan,
            },
        },
        (
            RunState::TurnInFlight {
                thread_id,
                turn_number,
                retry_count: _retry_count,
                policy_state,
            },
            RunEvent::TurnFinished {
                outcome: TurnOutcome::Success { response },
            },
        ) => match context.policy.evaluate_success(policy_state, &response) {
            PolicyDirective::Complete => Transition::Done(RunTerminalState::Completed),
            PolicyDirective::Continue {
                next_state,
                next_plan,
            } => {
                if turn_number >= context.config.max_iter {
                    return Transition::Done(RunTerminalState::Exhausted {
                        message: "Stopped: maximum iterations reached.".to_owned(),
                    });
                }

                Transition::Continue {
                    next_state: RunState::TurnInFlight {
                        thread_id: thread_id.clone(),
                        turn_number: turn_number + 1,
                        retry_count: 0,
                        policy_state: next_state,
                    },
                    effect: RunEffect::StartTurn {
                        thread_id,
                        turn_number: turn_number + 1,
                        plan: next_plan,
                    },
                }
            }
            PolicyDirective::Retry {
                next_state,
                next_plan,
            } => {
                if turn_number >= context.config.max_iter {
                    return Transition::Done(RunTerminalState::Exhausted {
                        message: "Stopped: maximum iterations reached.".to_owned(),
                    });
                }

                Transition::Continue {
                    next_state: RunState::TurnInFlight {
                        thread_id: thread_id.clone(),
                        turn_number: turn_number + 1,
                        retry_count: 1,
                        policy_state: next_state,
                    },
                    effect: RunEffect::StartTurn {
                        thread_id,
                        turn_number: turn_number + 1,
                        plan: next_plan,
                    },
                }
            }
        },
        (
            RunState::TurnInFlight {
                thread_id,
                turn_number,
                retry_count,
                policy_state,
            },
            RunEvent::TurnFinished {
                outcome: TurnOutcome::Failure(failure),
            },
        ) => {
            if turn_number >= context.config.max_iter {
                return Transition::Done(RunTerminalState::Exhausted {
                    message: "Stopped: maximum iterations reached.".to_owned(),
                });
            }

            if retry_count >= context.config.max_retry {
                return Transition::Done(RunTerminalState::Exhausted {
                    message: "Stopped: maximum retries reached.".to_owned(),
                });
            }

            match context.policy.evaluate_failure(policy_state, &failure) {
                PolicyDirective::Retry {
                    next_state,
                    next_plan,
                }
                | PolicyDirective::Continue {
                    next_state,
                    next_plan,
                } => Transition::Continue {
                    next_state: RunState::TurnInFlight {
                        thread_id: thread_id.clone(),
                        turn_number: turn_number + 1,
                        retry_count: retry_count + 1,
                        policy_state: next_state,
                    },
                    effect: RunEffect::StartTurn {
                        thread_id,
                        turn_number: turn_number + 1,
                        plan: next_plan,
                    },
                },
                PolicyDirective::Complete => Transition::Done(RunTerminalState::Completed),
            }
        }
        (_, RunEvent::Interrupted) => Transition::Done(RunTerminalState::Interrupted),
        (state, event) => Transition::Done(RunTerminalState::Exhausted {
            message: format!("Stopped: invalid state transition: state={state:?}, event={event:?}"),
        }),
    }
}

async fn execute_effect<O, R>(
    effect: RunEffect,
    runtime: &mut R,
    observer: &mut O,
) -> Result<RunEvent, WtlError>
where
    O: Observer,
    R: TurnRuntime,
{
    match effect {
        RunEffect::BootstrapSession {
            developer_instructions,
        } => {
            observer.on_run_started()?;
            let thread_id = runtime.start_session(&developer_instructions).await?;
            Ok(RunEvent::SessionStarted { thread_id })
        }
        RunEffect::StartTurn {
            thread_id,
            turn_number,
            plan,
        } => {
            observer.on_turn_started(turn_number)?;
            let outcome = runtime.run_turn(&thread_id, &plan, observer).await?;
            observer.on_turn_finished()?;
            Ok(RunEvent::TurnFinished { outcome })
        }
    }
}

#[cfg(test)]
mod tests {
    use pretty_assertions::assert_eq;

    use super::EngineConfig;
    use super::RunContext;
    use super::RunEvent;
    use super::RunState;
    use super::RunTerminalState;
    use super::Transition;
    use super::reduce;
    use crate::policy::PolicyState;
    use crate::policy::SimpleLoopPolicy;
    use crate::runtime::TurnFailure;
    use crate::runtime::TurnOutcome;

    fn context() -> RunContext<SimpleLoopPolicy> {
        RunContext {
            config: EngineConfig {
                max_iter: 2,
                max_retry: 1,
            },
            policy: SimpleLoopPolicy::new("ship it".to_owned()),
        }
    }

    #[test]
    fn successful_non_terminal_turn_schedules_next_turn() {
        let initial_plan = context().policy.initial_plan();
        let transition = reduce(
            RunState::TurnInFlight {
                thread_id: "thr_123".to_owned(),
                turn_number: 1,
                retry_count: 0,
                policy_state: PolicyState {
                    successful_turns: 0,
                },
            },
            RunEvent::TurnFinished {
                outcome: TurnOutcome::Success {
                    response: "still working".to_owned(),
                },
            },
            &context(),
        );

        match transition {
            Transition::Continue { next_state, .. } => match next_state {
                RunState::TurnInFlight {
                    turn_number,
                    retry_count,
                    policy_state,
                    ..
                } => {
                    assert_eq!(turn_number, 2);
                    assert_eq!(retry_count, 0);
                    assert_eq!(
                        policy_state,
                        PolicyState {
                            successful_turns: 1
                        }
                    );
                }
                other => panic!("expected turn state, got {other:?}"),
            },
            other => panic!("expected continue transition, got {other:?}"),
        }

        let _ = initial_plan;
    }

    #[test]
    fn completion_marker_finishes_run() {
        let transition = reduce(
            RunState::TurnInFlight {
                thread_id: "thr_123".to_owned(),
                turn_number: 1,
                retry_count: 0,
                policy_state: PolicyState {
                    successful_turns: 0,
                },
            },
            RunEvent::TurnFinished {
                outcome: TurnOutcome::Success {
                    response: "done ##WTL_DONE##".to_owned(),
                },
            },
            &context(),
        );

        assert_eq!(transition, Transition::Done(RunTerminalState::Completed));
    }

    #[test]
    fn retry_limit_exhausts_run() {
        let transition = reduce(
            RunState::TurnInFlight {
                thread_id: "thr_123".to_owned(),
                turn_number: 2,
                retry_count: 1,
                policy_state: PolicyState {
                    successful_turns: 0,
                },
            },
            RunEvent::TurnFinished {
                outcome: TurnOutcome::Failure(TurnFailure {
                    message: "boom".to_owned(),
                    code: None,
                }),
            },
            &context(),
        );

        assert_eq!(
            transition,
            Transition::Done(RunTerminalState::Exhausted {
                message: "Stopped: maximum iterations reached.".to_owned(),
            })
        );
    }
}
