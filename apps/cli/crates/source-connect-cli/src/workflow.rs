use serde_json::Map;
use serde_json::Value;

use crate::SourceConnectGuide;
use crate::SourceConnectInputError;
use crate::SourceConnectProvider;
use crate::SourceConnectRenderedOutput;
use crate::SourceConnectResult;
use crate::parse_source_connect_input;
use crate::render_source_connect_guide_output;
use crate::render_source_connect_result_output;

const DEFAULT_MAX_WORKFLOW_STEPS: usize = 32;

#[derive(Debug, Clone, Eq, PartialEq)]
pub struct SourceConnectInvocation {
    pub source: SourceConnectProvider,
    pub input: Option<String>,
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub enum SourceConnectMode {
    Guide {
        source: SourceConnectProvider,
    },
    Connect {
        source: SourceConnectProvider,
        input: Map<String, Value>,
    },
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub enum SourceConnectState {
    Idle { mode: SourceConnectMode },
    CheckingAuth { mode: SourceConnectMode },
    LoadingGuide,
    Connecting,
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub enum SourceConnectTerminalState<E> {
    GuideLoaded {
        guide: Box<SourceConnectGuide>,
        request_id: Option<String>,
    },
    SourceConnected {
        result: SourceConnectResult,
        request_id: Option<String>,
    },
    NeedsReauth {
        error: E,
    },
    Failed {
        error: E,
    },
    UnexpectedTransition {
        state: &'static str,
        event: &'static str,
    },
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub enum SourceConnectEvent<E> {
    Start,
    Authenticated {
        org: String,
    },
    AuthFailed {
        error: E,
    },
    GuideLoaded {
        guide: Box<SourceConnectGuide>,
        request_id: Option<String>,
    },
    GuideLoadFailed {
        error: E,
        outcome: SourceConnectFailureOutcome,
    },
    SourceConnected {
        result: SourceConnectResult,
        request_id: Option<String>,
    },
    SourceConnectFailed {
        error: E,
        outcome: SourceConnectFailureOutcome,
    },
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub enum SourceConnectEffect {
    EnsureAuthenticatedOrg,
    FetchGuide {
        org: String,
        source: SourceConnectProvider,
    },
    ConnectSource {
        org: String,
        source: SourceConnectProvider,
        input: Map<String, Value>,
    },
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub enum SourceConnectTransition<E> {
    Continue {
        next_state: SourceConnectState,
        effect: SourceConnectEffect,
    },
    Done(SourceConnectTerminalState<E>),
}

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub enum SourceConnectFailureOutcome {
    NeedsReauth,
    Failed,
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub struct SourceConnectApiSuccess<T> {
    pub payload: T,
    pub request_id: Option<String>,
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub enum SourceConnectHostFailure<A, E> {
    Api(A),
    Error(E),
}

#[crate::async_trait(?Send)]
pub trait SourceConnectHost {
    type ApiFailure;
    type Error;
    type Output;

    fn binary_name(&self) -> &'static str;
    async fn ensure_authenticated_org(&mut self) -> Result<String, Self::Error>;
    async fn load_source_connect_guide(
        &mut self,
        org: &str,
        source: SourceConnectProvider,
    ) -> Result<
        SourceConnectApiSuccess<SourceConnectGuide>,
        SourceConnectHostFailure<Self::ApiFailure, Self::Error>,
    >;
    async fn connect_source(
        &mut self,
        org: &str,
        source: &SourceConnectProvider,
        input: Map<String, Value>,
    ) -> Result<
        SourceConnectApiSuccess<SourceConnectResult>,
        SourceConnectHostFailure<Self::ApiFailure, Self::Error>,
    >;
    fn classify_failure(&self, failure: &Self::ApiFailure) -> SourceConnectFailureOutcome;
    fn invalid_input_error(&self, error: SourceConnectInputError) -> Self::Error;
    fn present_guide_failure(&self, failure: Self::ApiFailure) -> Self::Error;
    fn present_connect_failure(
        &self,
        source: &SourceConnectProvider,
        failure: Self::ApiFailure,
    ) -> Self::Error;
    fn render_output(
        &self,
        output: SourceConnectRenderedOutput,
        request_id: Option<String>,
    ) -> Result<Self::Output, Self::Error>;
    fn unexpected_transition_error(&self, state: &'static str, event: &'static str) -> Self::Error;
    fn max_workflow_steps(&self) -> usize {
        DEFAULT_MAX_WORKFLOW_STEPS
    }
    fn record_workflow_reduce(
        &self,
        _step: usize,
        _state_before: &'static str,
        _event: &'static str,
    ) {
    }
    fn record_workflow_transition(
        &self,
        _step: usize,
        _state_after: Option<&'static str>,
        _terminal_state: Option<&'static str>,
    ) {
    }
    fn record_workflow_effect_dispatch(&self, _step: usize, _effect: &'static str) {}
    fn record_workflow_effect_emitted_event(&self, _step: usize, _event: &'static str) {}
}

pub async fn execute<H>(
    invocation: &SourceConnectInvocation,
    host: &mut H,
) -> Result<H::Output, H::Error>
where
    H: SourceConnectHost,
{
    let source = invocation.source.clone();
    let mode = match invocation.input.as_deref() {
        Some(raw_input) => SourceConnectMode::Connect {
            source,
            input: parse_source_connect_input(raw_input)
                .map_err(|error| host.invalid_input_error(error))?,
        },
        None => SourceConnectMode::Guide { source },
    };

    let mut state = SourceConnectState::Idle { mode };
    let mut event = SourceConnectEvent::Start;

    for step in 1..=host.max_workflow_steps() {
        host.record_workflow_reduce(step, state.workflow_label(), event.workflow_label());
        let transition = reduce(state, event);
        host.record_workflow_transition(
            step,
            transition.next_state_label(),
            transition.terminal_state_label(),
        );

        match transition {
            SourceConnectTransition::Continue { next_state, effect } => {
                state = next_state;
                host.record_workflow_effect_dispatch(step, effect.workflow_label());
                event = execute_effect(effect, host).await;
                host.record_workflow_effect_emitted_event(step, event.workflow_label());
            }
            SourceConnectTransition::Done(terminal_state) => {
                return terminal_state_to_result(terminal_state, host);
            }
        }
    }

    Err(host.unexpected_transition_error("MaxStepsExceeded", "Loop"))
}

pub fn reduce<E>(
    state: SourceConnectState,
    event: SourceConnectEvent<E>,
) -> SourceConnectTransition<E> {
    match state {
        SourceConnectState::Idle { mode } => match event {
            SourceConnectEvent::Start => SourceConnectTransition::Continue {
                next_state: SourceConnectState::CheckingAuth { mode },
                effect: SourceConnectEffect::EnsureAuthenticatedOrg,
            },
            event => SourceConnectTransition::Done(unexpected_transition(
                SourceConnectState::Idle { mode },
                event,
            )),
        },
        SourceConnectState::CheckingAuth { mode } => match event {
            SourceConnectEvent::Authenticated { org } => match mode {
                SourceConnectMode::Guide { source } => SourceConnectTransition::Continue {
                    next_state: SourceConnectState::LoadingGuide,
                    effect: SourceConnectEffect::FetchGuide { org, source },
                },
                SourceConnectMode::Connect { source, input } => SourceConnectTransition::Continue {
                    next_state: SourceConnectState::Connecting,
                    effect: SourceConnectEffect::ConnectSource { org, source, input },
                },
            },
            SourceConnectEvent::AuthFailed { error } => {
                SourceConnectTransition::Done(SourceConnectTerminalState::Failed { error })
            }
            event => SourceConnectTransition::Done(unexpected_transition(
                SourceConnectState::CheckingAuth { mode },
                event,
            )),
        },
        SourceConnectState::LoadingGuide => match event {
            SourceConnectEvent::GuideLoaded { guide, request_id } => {
                SourceConnectTransition::Done(SourceConnectTerminalState::GuideLoaded {
                    guide,
                    request_id,
                })
            }
            SourceConnectEvent::GuideLoadFailed { error, outcome } => {
                failed_terminal_state(error, outcome)
            }
            event => SourceConnectTransition::Done(unexpected_transition(
                SourceConnectState::LoadingGuide,
                event,
            )),
        },
        SourceConnectState::Connecting => match event {
            SourceConnectEvent::SourceConnected { result, request_id } => {
                SourceConnectTransition::Done(SourceConnectTerminalState::SourceConnected {
                    result,
                    request_id,
                })
            }
            SourceConnectEvent::SourceConnectFailed { error, outcome } => {
                failed_terminal_state(error, outcome)
            }
            event => SourceConnectTransition::Done(unexpected_transition(
                SourceConnectState::Connecting,
                event,
            )),
        },
    }
}

fn failed_terminal_state<E>(
    error: E,
    outcome: SourceConnectFailureOutcome,
) -> SourceConnectTransition<E> {
    match outcome {
        SourceConnectFailureOutcome::NeedsReauth => {
            SourceConnectTransition::Done(SourceConnectTerminalState::NeedsReauth { error })
        }
        SourceConnectFailureOutcome::Failed => {
            SourceConnectTransition::Done(SourceConnectTerminalState::Failed { error })
        }
    }
}

fn unexpected_transition<E>(
    state: SourceConnectState,
    event: SourceConnectEvent<E>,
) -> SourceConnectTerminalState<E> {
    SourceConnectTerminalState::UnexpectedTransition {
        state: state.workflow_label(),
        event: event.workflow_label(),
    }
}

async fn execute_effect<H>(
    effect: SourceConnectEffect,
    host: &mut H,
) -> SourceConnectEvent<H::Error>
where
    H: SourceConnectHost,
{
    match effect {
        SourceConnectEffect::EnsureAuthenticatedOrg => {
            match host.ensure_authenticated_org().await {
                Ok(org) => SourceConnectEvent::Authenticated { org },
                Err(error) => SourceConnectEvent::AuthFailed { error },
            }
        }
        SourceConnectEffect::FetchGuide { org, source } => {
            match host.load_source_connect_guide(&org, source).await {
                Ok(response) => SourceConnectEvent::GuideLoaded {
                    guide: Box::new(response.payload),
                    request_id: response.request_id,
                },
                Err(SourceConnectHostFailure::Error(error)) => {
                    SourceConnectEvent::GuideLoadFailed {
                        error,
                        outcome: SourceConnectFailureOutcome::Failed,
                    }
                }
                Err(SourceConnectHostFailure::Api(failure)) => {
                    let outcome = host.classify_failure(&failure);
                    SourceConnectEvent::GuideLoadFailed {
                        error: host.present_guide_failure(failure),
                        outcome,
                    }
                }
            }
        }
        SourceConnectEffect::ConnectSource { org, source, input } => {
            match host.connect_source(&org, &source, input).await {
                Ok(response) => SourceConnectEvent::SourceConnected {
                    result: response.payload,
                    request_id: response.request_id,
                },
                Err(SourceConnectHostFailure::Error(error)) => {
                    SourceConnectEvent::SourceConnectFailed {
                        error,
                        outcome: SourceConnectFailureOutcome::Failed,
                    }
                }
                Err(SourceConnectHostFailure::Api(failure)) => {
                    let outcome = host.classify_failure(&failure);
                    SourceConnectEvent::SourceConnectFailed {
                        error: host.present_connect_failure(&source, failure),
                        outcome,
                    }
                }
            }
        }
    }
}

fn terminal_state_to_result<H>(
    terminal_state: SourceConnectTerminalState<H::Error>,
    host: &H,
) -> Result<H::Output, H::Error>
where
    H: SourceConnectHost,
{
    match terminal_state {
        SourceConnectTerminalState::GuideLoaded { guide, request_id } => {
            host.render_output(render_source_connect_guide_output(*guide), request_id)
        }
        SourceConnectTerminalState::SourceConnected { result, request_id } => {
            host.render_output(render_source_connect_result_output(result), request_id)
        }
        SourceConnectTerminalState::NeedsReauth { error }
        | SourceConnectTerminalState::Failed { error } => Err(error),
        SourceConnectTerminalState::UnexpectedTransition { state, event } => {
            Err(host.unexpected_transition_error(state, event))
        }
    }
}

impl<E> SourceConnectTransition<E> {
    pub fn next_state_label(&self) -> Option<&'static str> {
        match self {
            Self::Continue { next_state, .. } => Some(next_state.workflow_label()),
            Self::Done { .. } => None,
        }
    }

    pub fn terminal_state_label(&self) -> Option<&'static str> {
        match self {
            Self::Continue { .. } => None,
            Self::Done(terminal_state) => Some(terminal_state.workflow_label()),
        }
    }
}

impl SourceConnectState {
    pub fn workflow_label(&self) -> &'static str {
        match self {
            Self::Idle { .. } => "Idle",
            Self::CheckingAuth { .. } => "CheckingAuth",
            Self::LoadingGuide => "LoadingGuide",
            Self::Connecting => "Connecting",
        }
    }
}

impl<E> SourceConnectTerminalState<E> {
    pub fn workflow_label(&self) -> &'static str {
        match self {
            Self::GuideLoaded { .. } => "GuideLoaded",
            Self::SourceConnected { .. } => "SourceConnected",
            Self::NeedsReauth { .. } => "NeedsReauth",
            Self::Failed { .. } => "Failed",
            Self::UnexpectedTransition { .. } => "UnexpectedTransition",
        }
    }
}

impl<E> SourceConnectEvent<E> {
    pub fn workflow_label(&self) -> &'static str {
        match self {
            Self::Start => "Start",
            Self::Authenticated { .. } => "Authenticated",
            Self::AuthFailed { .. } => "AuthFailed",
            Self::GuideLoaded { .. } => "GuideLoaded",
            Self::GuideLoadFailed { .. } => "GuideLoadFailed",
            Self::SourceConnected { .. } => "SourceConnected",
            Self::SourceConnectFailed { .. } => "SourceConnectFailed",
        }
    }
}

impl SourceConnectEffect {
    pub fn workflow_label(&self) -> &'static str {
        match self {
            Self::EnsureAuthenticatedOrg => "EnsureAuthenticatedOrg",
            Self::FetchGuide { .. } => "FetchGuide",
            Self::ConnectSource { .. } => "ConnectSource",
        }
    }
}

#[cfg(test)]
mod tests {
    use pretty_assertions::assert_eq;

    use super::SourceConnectEffect;
    use super::SourceConnectEvent;
    use super::SourceConnectFailureOutcome;
    use super::SourceConnectMode;
    use super::SourceConnectState;
    use super::SourceConnectTerminalState;
    use super::SourceConnectTransition;
    use super::reduce;
    use crate::SourceConnectProvider;

    #[test]
    fn source_connect_starts_in_guide_mode_without_input() {
        let transition = reduce::<String>(
            SourceConnectState::Idle {
                mode: SourceConnectMode::Guide {
                    source: SourceConnectProvider::new_for_test("postgres"),
                },
            },
            SourceConnectEvent::Start,
        );

        match transition {
            SourceConnectTransition::Continue {
                next_state: SourceConnectState::CheckingAuth { mode },
                effect: SourceConnectEffect::EnsureAuthenticatedOrg,
            } => assert!(matches!(
                mode,
                SourceConnectMode::Guide { source }
                    if source == SourceConnectProvider::new_for_test("postgres")
            )),
            other => panic!("expected guide-mode transition, got {other:?}"),
        }
    }

    #[test]
    fn unauthorized_source_connect_failure_transitions_to_explicit_reauth_terminal_state() {
        let transition = reduce(
            SourceConnectState::LoadingGuide,
            SourceConnectEvent::GuideLoadFailed {
                error: "stored credentials are no longer authorized".to_owned(),
                outcome: SourceConnectFailureOutcome::NeedsReauth,
            },
        );

        assert_eq!(
            transition,
            SourceConnectTransition::Done(SourceConnectTerminalState::NeedsReauth {
                error: "stored credentials are no longer authorized".to_owned(),
            })
        );
    }

    #[test]
    fn unexpected_events_return_labeled_transition_state() {
        let transition = reduce::<String>(
            SourceConnectState::Connecting,
            SourceConnectEvent::GuideLoaded {
                guide: Box::new(crate::SourceConnectGuide {
                    title: "title".to_owned(),
                    description: "description".to_owned(),
                    format: "markdown".to_owned(),
                    content: "content".to_owned(),
                    command: "onequery source connect --source postgres".to_owned(),
                }),
                request_id: None,
            },
        );

        assert_eq!(
            transition,
            SourceConnectTransition::Done(SourceConnectTerminalState::UnexpectedTransition {
                state: "Connecting",
                event: "GuideLoaded",
            })
        );
    }
}
