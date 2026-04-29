use std::rc::Rc;

use crate::commands::CommandContext;
use crate::workflows::runner::Transition;

use super::super::plan::PlannedCommand;
use super::super::render::render_descriptor_output;
use super::super::render::render_dry_run_output;
use super::completion::complete_execution;
use super::completion::completed_state;
use super::completion::failed_state;
use super::completion::unexpected_transition;
use super::completion::verbose_request_id;
use super::retry_policy::retry_or_fail;
use super::state::BuildingPlanState;
use super::state::CheckingAuthState;
use super::state::DescribingState;
use super::state::ExecutingPageState;
use super::state::IdleState;
use super::state::PreviewingState;
use super::state::SourceApiEffect;
use super::state::SourceApiEvent;
use super::state::SourceApiExecutionState;
use super::state::SourceApiRetryTarget;
use super::state::SourceApiState;
use super::state::SourceApiTransition;
use super::state::SourceApiWorkflowRequest;
use super::state::WaitingToRetrySourceApiState;

pub(super) fn reduce(
    state: SourceApiState,
    event: SourceApiEvent,
    context: &CommandContext,
) -> SourceApiTransition {
    match state {
        SourceApiState::Idle(state) => reduce_idle(state, event, context),
        SourceApiState::CheckingAuth(state) => reduce_checking_auth(state, event, context),
        SourceApiState::Describing(state) => reduce_describing(state, event, context),
        SourceApiState::BuildingPlan(state) => reduce_building_plan(state, event, context),
        SourceApiState::Previewing(state) => reduce_previewing(state, event, context),
        SourceApiState::ExecutingPage(state) => reduce_executing_page(state, event, context),
        SourceApiState::WaitingToRetry(state) => reduce_waiting_to_retry(state, event, context),
    }
}

fn reduce_idle(
    state: IdleState,
    event: SourceApiEvent,
    context: &CommandContext,
) -> SourceApiTransition {
    match event {
        SourceApiEvent::Start => {
            let args = Rc::new(state.args);
            Transition::continue_with_effect(
                SourceApiState::CheckingAuth(CheckingAuthState { args }),
                SourceApiEffect::EnsureAuthenticatedOrg,
            )
        }
        SourceApiEvent::Authenticated { .. }
        | SourceApiEvent::AuthFailed { .. }
        | SourceApiEvent::DescriptorLoaded { .. }
        | SourceApiEvent::DescribeFailed { .. }
        | SourceApiEvent::PlanBuilt { .. }
        | SourceApiEvent::PlanFailed { .. }
        | SourceApiEvent::PreviewCompleted { .. }
        | SourceApiEvent::PreviewFailed { .. }
        | SourceApiEvent::PageFetched { .. }
        | SourceApiEvent::PageFetchFailed { .. }
        | SourceApiEvent::RetryDelayElapsed => unexpected_transition(context, "Idle", &event),
    }
}

fn reduce_checking_auth(
    state: CheckingAuthState,
    event: SourceApiEvent,
    context: &CommandContext,
) -> SourceApiTransition {
    match event {
        SourceApiEvent::Authenticated { org } => {
            let request = Rc::new(SourceApiWorkflowRequest {
                args: state.args,
                org,
            });
            Transition::continue_with_effect(
                SourceApiState::Describing(DescribingState {
                    request: Rc::clone(&request),
                }),
                SourceApiEffect::DescribeSourceApi {
                    attempt: 1,
                    request,
                },
            )
        }
        SourceApiEvent::AuthFailed { error } => Transition::done(failed_state(error)),
        SourceApiEvent::Start
        | SourceApiEvent::DescriptorLoaded { .. }
        | SourceApiEvent::DescribeFailed { .. }
        | SourceApiEvent::PlanBuilt { .. }
        | SourceApiEvent::PlanFailed { .. }
        | SourceApiEvent::PreviewCompleted { .. }
        | SourceApiEvent::PreviewFailed { .. }
        | SourceApiEvent::PageFetched { .. }
        | SourceApiEvent::PageFetchFailed { .. }
        | SourceApiEvent::RetryDelayElapsed => {
            unexpected_transition(context, "CheckingAuth", &event)
        }
    }
}

fn reduce_describing(
    state: DescribingState,
    event: SourceApiEvent,
    context: &CommandContext,
) -> SourceApiTransition {
    match event {
        SourceApiEvent::DescriptorLoaded {
            descriptor,
            request_id,
        } => {
            let descriptor = Rc::new(*descriptor);
            Transition::continue_with_effect(
                SourceApiState::BuildingPlan(BuildingPlanState {
                    descriptor: Rc::clone(&descriptor),
                    descriptor_request_id: request_id,
                    request: Rc::clone(&state.request),
                }),
                SourceApiEffect::BuildPlan {
                    descriptor,
                    request: state.request,
                },
            )
        }
        SourceApiEvent::DescribeFailed { error, retry } => retry_or_fail(
            error,
            retry,
            SourceApiRetryTarget::Describe {
                request: state.request,
            },
        ),
        SourceApiEvent::Start
        | SourceApiEvent::Authenticated { .. }
        | SourceApiEvent::AuthFailed { .. }
        | SourceApiEvent::PlanBuilt { .. }
        | SourceApiEvent::PlanFailed { .. }
        | SourceApiEvent::PreviewCompleted { .. }
        | SourceApiEvent::PreviewFailed { .. }
        | SourceApiEvent::PageFetched { .. }
        | SourceApiEvent::PageFetchFailed { .. }
        | SourceApiEvent::RetryDelayElapsed => unexpected_transition(context, "Describing", &event),
    }
}

fn reduce_building_plan(
    state: BuildingPlanState,
    event: SourceApiEvent,
    context: &CommandContext,
) -> SourceApiTransition {
    match event {
        SourceApiEvent::PlanBuilt { plan } => match plan {
            PlannedCommand::Describe => {
                match render_descriptor_output((*state.descriptor).clone()) {
                    Ok(output) => Transition::done(completed_state(output.with_request_id(
                        verbose_request_id(context, state.descriptor_request_id),
                    ))),
                    Err(error) => Transition::done(failed_state(error)),
                }
            }
            PlannedCommand::DryRun { draft } => Transition::continue_with_effect(
                SourceApiState::Previewing(PreviewingState {
                    draft: draft.clone(),
                    request: Rc::clone(&state.request),
                }),
                SourceApiEffect::PreviewSourceApi {
                    attempt: 1,
                    draft,
                    request: state.request,
                },
            ),
            PlannedCommand::Execute { plan } => {
                let execution = SourceApiExecutionState {
                    latest_request_id: None,
                    pages: Vec::new(),
                    plan,
                    preview: None,
                    request: state.request,
                };
                Transition::continue_with_effect(
                    SourceApiState::ExecutingPage(ExecutingPageState {
                        execution: execution.clone(),
                    }),
                    SourceApiEffect::ExecuteFirstPage {
                        attempt: 1,
                        execution,
                    },
                )
            }
        },
        SourceApiEvent::PlanFailed { error } => Transition::done(failed_state(error)),
        SourceApiEvent::Start
        | SourceApiEvent::Authenticated { .. }
        | SourceApiEvent::AuthFailed { .. }
        | SourceApiEvent::DescriptorLoaded { .. }
        | SourceApiEvent::DescribeFailed { .. }
        | SourceApiEvent::PreviewCompleted { .. }
        | SourceApiEvent::PreviewFailed { .. }
        | SourceApiEvent::PageFetched { .. }
        | SourceApiEvent::PageFetchFailed { .. }
        | SourceApiEvent::RetryDelayElapsed => {
            unexpected_transition(context, "BuildingPlan", &event)
        }
    }
}

fn reduce_previewing(
    state: PreviewingState,
    event: SourceApiEvent,
    context: &CommandContext,
) -> SourceApiTransition {
    match event {
        SourceApiEvent::PreviewCompleted {
            preview,
            request_id,
        } => match render_dry_run_output(&preview, context.verbose) {
            Ok(output) => Transition::done(completed_state(
                output.with_request_id(verbose_request_id(context, request_id)),
            )),
            Err(error) => Transition::done(failed_state(error)),
        },
        SourceApiEvent::PreviewFailed { error, retry } => retry_or_fail(
            error,
            retry,
            SourceApiRetryTarget::Preview {
                draft: state.draft,
                request: state.request,
            },
        ),
        SourceApiEvent::Start
        | SourceApiEvent::Authenticated { .. }
        | SourceApiEvent::AuthFailed { .. }
        | SourceApiEvent::DescriptorLoaded { .. }
        | SourceApiEvent::DescribeFailed { .. }
        | SourceApiEvent::PlanBuilt { .. }
        | SourceApiEvent::PlanFailed { .. }
        | SourceApiEvent::PageFetched { .. }
        | SourceApiEvent::PageFetchFailed { .. }
        | SourceApiEvent::RetryDelayElapsed => unexpected_transition(context, "Previewing", &event),
    }
}

fn reduce_executing_page(
    state: ExecutingPageState,
    event: SourceApiEvent,
    context: &CommandContext,
) -> SourceApiTransition {
    match event {
        SourceApiEvent::PageFetched {
            continuation_token,
            page,
            preview,
            request_id,
        } => {
            let mut execution = state.execution;
            execution.latest_request_id = request_id;
            if execution.preview.is_none() {
                execution.preview = Some(preview);
            }
            execution.pages.push(*page);

            let resume_token =
                continuation_token.filter(|token| should_resume(&execution, Some(token.as_str())));
            if let Some(continuation_token) = resume_token {
                return Transition::continue_with_effect(
                    SourceApiState::ExecutingPage(ExecutingPageState {
                        execution: execution.clone(),
                    }),
                    SourceApiEffect::ResumePage {
                        attempt: 1,
                        continuation_token,
                        execution,
                    },
                );
            }

            complete_execution(execution, context)
        }
        SourceApiEvent::PageFetchFailed { error, retry } => {
            let retry_target = if state.execution.pages.is_empty() {
                SourceApiRetryTarget::ExecuteFirstPage {
                    execution: state.execution,
                }
            } else {
                let Some(continuation_token) = state
                    .execution
                    .pages
                    .last()
                    .and_then(|page| page.continuation_token.clone())
                else {
                    return Transition::done(failed_state(error));
                };

                SourceApiRetryTarget::ResumePage {
                    continuation_token,
                    execution: state.execution,
                }
            };
            retry_or_fail(error, retry, retry_target)
        }
        SourceApiEvent::Start
        | SourceApiEvent::Authenticated { .. }
        | SourceApiEvent::AuthFailed { .. }
        | SourceApiEvent::DescriptorLoaded { .. }
        | SourceApiEvent::DescribeFailed { .. }
        | SourceApiEvent::PlanBuilt { .. }
        | SourceApiEvent::PlanFailed { .. }
        | SourceApiEvent::PreviewCompleted { .. }
        | SourceApiEvent::PreviewFailed { .. }
        | SourceApiEvent::RetryDelayElapsed => {
            unexpected_transition(context, "ExecutingPage", &event)
        }
    }
}

fn reduce_waiting_to_retry(
    state: WaitingToRetrySourceApiState,
    event: SourceApiEvent,
    context: &CommandContext,
) -> SourceApiTransition {
    match event {
        SourceApiEvent::RetryDelayElapsed => match state.target {
            SourceApiRetryTarget::Describe { request } => Transition::continue_with_effect(
                SourceApiState::Describing(DescribingState {
                    request: Rc::clone(&request),
                }),
                SourceApiEffect::DescribeSourceApi {
                    attempt: state.next_attempt,
                    request,
                },
            ),
            SourceApiRetryTarget::Preview { draft, request } => Transition::continue_with_effect(
                SourceApiState::Previewing(PreviewingState {
                    draft: draft.clone(),
                    request: Rc::clone(&request),
                }),
                SourceApiEffect::PreviewSourceApi {
                    attempt: state.next_attempt,
                    draft,
                    request,
                },
            ),
            SourceApiRetryTarget::ExecuteFirstPage { execution } => {
                Transition::continue_with_effect(
                    SourceApiState::ExecutingPage(ExecutingPageState {
                        execution: execution.clone(),
                    }),
                    SourceApiEffect::ExecuteFirstPage {
                        attempt: state.next_attempt,
                        execution,
                    },
                )
            }
            SourceApiRetryTarget::ResumePage {
                continuation_token,
                execution,
            } => Transition::continue_with_effect(
                SourceApiState::ExecutingPage(ExecutingPageState {
                    execution: execution.clone(),
                }),
                SourceApiEffect::ResumePage {
                    attempt: state.next_attempt,
                    continuation_token,
                    execution,
                },
            ),
        },
        SourceApiEvent::Start
        | SourceApiEvent::Authenticated { .. }
        | SourceApiEvent::AuthFailed { .. }
        | SourceApiEvent::DescriptorLoaded { .. }
        | SourceApiEvent::DescribeFailed { .. }
        | SourceApiEvent::PlanBuilt { .. }
        | SourceApiEvent::PlanFailed { .. }
        | SourceApiEvent::PreviewCompleted { .. }
        | SourceApiEvent::PreviewFailed { .. }
        | SourceApiEvent::PageFetched { .. }
        | SourceApiEvent::PageFetchFailed { .. } => {
            unexpected_transition(context, "WaitingToRetry", &event)
        }
    }
}

fn should_resume(execution: &SourceApiExecutionState, continuation_token: Option<&str>) -> bool {
    if continuation_token.is_none() || !execution.plan.execution.paginate {
        return false;
    }

    let max_pages = execution.plan.execution.max_pages.unwrap_or(u32::MAX);
    (execution.pages.len() as u32) < max_pages
}

#[cfg(test)]
mod tests {
    use onequery_core::error::CliError;
    use pretty_assertions::assert_eq;

    use crate::cli::ApiArgs;
    use crate::commands::CommandContext;
    use crate::commands::ResolvedOrgSource;
    use crate::identifiers::test_org_slug;
    use crate::identifiers::test_source_key;
    use crate::transport::source_api::SourceApiDraft;
    use crate::transport::source_api::SourceApiPreview;
    use crate::transport::source_api::SourceApiSource;
    use crate::workflows::retry::RetryTransition;
    use crate::workflows::runner::TransitionProgress;

    use super::super::super::SourceApiExecutionPage;
    use super::super::super::plan::ExecutePlan;
    use super::super::super::plan::PlannedCommand;
    use super::super::super::plan::SourceApiExecutionOptions;
    use super::super::super::plan::SourceApiRenderOptions;
    use super::super::state::BuildingPlanState;
    use super::super::state::CheckingAuthState;
    use super::super::state::ExecutingPageState;
    use super::super::state::IdleState;
    use super::super::state::SourceApiEffect;
    use super::super::state::SourceApiEvent;
    use super::super::state::SourceApiExecutionState;
    use super::super::state::SourceApiRetryTarget;
    use super::super::state::SourceApiState;
    use super::super::state::SourceApiTerminalState;
    use super::super::state::SourceApiWorkflowRequest;
    use super::super::state::WaitingToRetrySourceApiState;
    use super::reduce_building_plan;
    use super::reduce_checking_auth;
    use super::reduce_executing_page;
    use super::reduce_idle;
    use super::reduce_waiting_to_retry;

    fn sample_context() -> CommandContext {
        CommandContext {
            command_line: "onequery api --source stripe customers".to_owned(),
            base_url: "https://example.com".to_owned(),
            request_id: None,
            resolved_org: Some("acme".to_owned()),
            resolved_org_source: ResolvedOrgSource::Flag,
            verbose: false,
        }
    }

    fn sample_args() -> ApiArgs {
        ApiArgs {
            source: test_source_key("stripe"),
            op: None,
            target: Some("customers".to_owned()),
            method: None,
            headers: Vec::new(),
            raw_fields: Vec::new(),
            fields: Vec::new(),
            input: None,
            paginate: true,
            slurp: false,
            max_pages: None,
            include: false,
            silent: false,
            jq: None,
            dry_run: false,
        }
    }

    fn sample_render_options() -> SourceApiRenderOptions {
        SourceApiRenderOptions {
            include: false,
            silent: false,
            slurp: false,
            jq: None,
            verbose: false,
        }
    }

    fn sample_execution_options() -> SourceApiExecutionOptions {
        SourceApiExecutionOptions {
            paginate: true,
            max_pages: Some(2),
        }
    }

    fn sample_execution_state() -> SourceApiExecutionState {
        sample_execution_state_with(sample_execution_options())
    }

    fn sample_execution_state_with(
        execution: SourceApiExecutionOptions,
    ) -> SourceApiExecutionState {
        SourceApiExecutionState {
            latest_request_id: None,
            pages: Vec::new(),
            plan: ExecutePlan {
                draft: SourceApiDraft::default(),
                execution,
                render: sample_render_options(),
            },
            preview: None,
            request: std::rc::Rc::new(SourceApiWorkflowRequest {
                args: std::rc::Rc::new(sample_args()),
                org: test_org_slug("acme"),
            }),
        }
    }

    fn sample_page(continuation_token: Option<String>) -> SourceApiExecutionPage {
        SourceApiExecutionPage {
            source: SourceApiSource::default(),
            operation: "list_customers".to_owned(),
            selector: None,
            status: 200,
            headers: Vec::new(),
            content_type: "application/json".to_owned(),
            body: None,
            continuation_token,
        }
    }

    #[test]
    fn start_defers_auth_to_effect() {
        let context = sample_context();
        let transition = reduce_idle(
            IdleState {
                args: sample_args(),
            },
            SourceApiEvent::Start,
            &context,
        );

        match transition.into_progress() {
            TransitionProgress::Continue {
                next_state: SourceApiState::CheckingAuth(CheckingAuthState { args }),
                effect: SourceApiEffect::EnsureAuthenticatedOrg,
            } => assert_eq!(args.source.as_str(), "stripe"),
            other => panic!("expected auth transition, got {other:?}"),
        }
    }

    #[test]
    fn authenticated_org_materializes_describe_request() {
        let context = sample_context();
        let args = std::rc::Rc::new(sample_args());
        let transition = reduce_checking_auth(
            CheckingAuthState { args },
            SourceApiEvent::Authenticated {
                org: test_org_slug("acme"),
            },
            &context,
        );

        match transition.into_progress() {
            TransitionProgress::Continue {
                next_state: SourceApiState::Describing(state),
                effect: SourceApiEffect::DescribeSourceApi { attempt, request },
            } => {
                assert_eq!(state.request.org.as_str(), "acme");
                assert_eq!(request.args.source.as_str(), "stripe");
                assert_eq!(attempt, 1);
            }
            other => panic!("expected describe transition, got {other:?}"),
        }
    }

    #[test]
    fn execute_plan_starts_first_page_effect() {
        let context = sample_context();
        let request = std::rc::Rc::new(SourceApiWorkflowRequest {
            args: std::rc::Rc::new(sample_args()),
            org: test_org_slug("acme"),
        });
        let transition = reduce_building_plan(
            BuildingPlanState {
                descriptor: std::rc::Rc::new(Default::default()),
                descriptor_request_id: None,
                request,
            },
            SourceApiEvent::PlanBuilt {
                plan: PlannedCommand::Execute {
                    plan: ExecutePlan {
                        draft: SourceApiDraft::default(),
                        execution: sample_execution_options(),
                        render: sample_render_options(),
                    },
                },
            },
            &context,
        );

        match transition.into_progress() {
            TransitionProgress::Continue {
                next_state: SourceApiState::ExecutingPage(ExecutingPageState { execution }),
                effect:
                    SourceApiEffect::ExecuteFirstPage {
                        attempt,
                        execution: effect_execution,
                    },
            } => {
                assert_eq!(execution.pages.len(), 0);
                assert_eq!(effect_execution.plan.execution.max_pages, Some(2));
                assert_eq!(attempt, 1);
            }
            other => panic!("expected first-page transition, got {other:?}"),
        }
    }

    #[test]
    fn continuation_page_transitions_to_resume_effect() {
        let context = sample_context();
        let transition = reduce_executing_page(
            ExecutingPageState {
                execution: sample_execution_state(),
            },
            SourceApiEvent::PageFetched {
                continuation_token: Some("next".to_owned()),
                page: Box::new(sample_page(Some("next".to_owned()))),
                preview: SourceApiPreview::default(),
                request_id: Some("req_1".to_owned()),
            },
            &context,
        );

        match transition.into_progress() {
            TransitionProgress::Continue {
                next_state: SourceApiState::ExecutingPage(ExecutingPageState { execution }),
                effect:
                    SourceApiEffect::ResumePage {
                        attempt,
                        continuation_token,
                        execution: effect_execution,
                    },
            } => {
                assert_eq!(execution.pages.len(), 1);
                assert_eq!(effect_execution.pages.len(), 1);
                assert_eq!(continuation_token, "next");
                assert_eq!(attempt, 1);
            }
            other => panic!("expected resume transition, got {other:?}"),
        }
    }

    #[test]
    fn retry_delay_replays_original_target() {
        let context = sample_context();
        let transition = reduce_waiting_to_retry(
            WaitingToRetrySourceApiState {
                next_attempt: 2,
                target: SourceApiRetryTarget::ExecuteFirstPage {
                    execution: sample_execution_state(),
                },
            },
            SourceApiEvent::RetryDelayElapsed,
            &context,
        );

        match transition.into_progress() {
            TransitionProgress::Continue {
                next_state: SourceApiState::ExecutingPage(ExecutingPageState { .. }),
                effect:
                    SourceApiEffect::ExecuteFirstPage {
                        attempt,
                        execution: _,
                    },
            } => assert_eq!(attempt, 2),
            other => panic!("expected retried first-page transition, got {other:?}"),
        }
    }

    #[test]
    fn retryable_page_failure_enters_waiting_state() {
        let context = sample_context();
        let error =
            CliError::internal(context.command_line.clone(), "temporary source API failure");
        let transition = reduce_executing_page(
            ExecutingPageState {
                execution: sample_execution_state(),
            },
            SourceApiEvent::PageFetchFailed {
                error,
                retry: RetryTransition::RetryScheduled {
                    next_attempt: 2,
                    max_attempts: 3,
                    delay_ms: 250,
                },
            },
            &context,
        );

        match transition.into_progress() {
            TransitionProgress::Continue {
                next_state:
                    SourceApiState::WaitingToRetry(WaitingToRetrySourceApiState {
                        next_attempt,
                        target: SourceApiRetryTarget::ExecuteFirstPage { .. },
                    }),
                effect:
                    SourceApiEffect::WaitBeforeRetry {
                        next_attempt: effect_attempt,
                        delay_ms,
                    },
            } => {
                assert_eq!(next_attempt, 2);
                assert_eq!(effect_attempt, 2);
                assert_eq!(delay_ms, 250);
            }
            other => panic!("expected waiting-to-retry transition, got {other:?}"),
        }
    }

    #[test]
    fn disabled_auto_pagination_completes_with_continuation_token() {
        let context = sample_context();
        let transition = reduce_executing_page(
            ExecutingPageState {
                execution: sample_execution_state_with(SourceApiExecutionOptions {
                    paginate: false,
                    max_pages: None,
                }),
            },
            SourceApiEvent::PageFetched {
                continuation_token: Some("next".to_owned()),
                page: Box::new(sample_page(Some("next".to_owned()))),
                preview: SourceApiPreview::default(),
                request_id: Some("req_1".to_owned()),
            },
            &context,
        );

        match transition.into_progress() {
            TransitionProgress::Done {
                terminal_state: SourceApiTerminalState::Completed { output },
            } => {
                let output = output.into_inner();
                assert_eq!(output.request_id, None);
            }
            other => panic!("expected completed terminal transition, got {other:?}"),
        }
    }

    #[test]
    fn max_pages_caps_automatic_pagination() {
        let context = sample_context();
        let transition = reduce_executing_page(
            ExecutingPageState {
                execution: sample_execution_state_with(SourceApiExecutionOptions {
                    paginate: true,
                    max_pages: Some(1),
                }),
            },
            SourceApiEvent::PageFetched {
                continuation_token: Some("next".to_owned()),
                page: Box::new(sample_page(Some("next".to_owned()))),
                preview: SourceApiPreview::default(),
                request_id: Some("req_1".to_owned()),
            },
            &context,
        );

        match transition.into_progress() {
            TransitionProgress::Done {
                terminal_state: SourceApiTerminalState::Completed { .. },
            } => {}
            other => panic!("expected max-page terminal transition, got {other:?}"),
        }
    }

    #[test]
    fn reauth_page_failure_enters_needs_reauth_terminal_state() {
        let context = sample_context();
        let error = CliError::internal(context.command_line.clone(), "stored credentials expired");
        let transition = reduce_executing_page(
            ExecutingPageState {
                execution: sample_execution_state(),
            },
            SourceApiEvent::PageFetchFailed {
                error,
                retry: RetryTransition::NeedsReauth,
            },
            &context,
        );

        match transition.into_progress() {
            TransitionProgress::Done {
                terminal_state: SourceApiTerminalState::NeedsReauth { error },
            } => assert_eq!(error.title, "internal error"),
            other => panic!("expected needs-reauth terminal transition, got {other:?}"),
        }
    }
}
