use std::rc::Rc;

use onequery_core::error::CliError;

use crate::cli::ApiArgs;
use crate::identifiers::OrgSlug;
use crate::output::CommandOutput;
use crate::output::TerminalOutput;
use crate::transport::source_api::SourceApiDescriptor;
use crate::transport::source_api::SourceApiDraft;
use crate::transport::source_api::SourceApiPreview;
use crate::workflows::retry::RetryTransition;
use crate::workflows::runner::Transition;
use crate::workflows::runner::WorkflowLabel;

use super::super::SourceApiExecutionPage;
use super::super::plan::ExecutePlan;
use super::super::plan::PlannedCommand;

#[derive(Debug)]
pub(in crate::commands::source_api) enum SourceApiTerminalState {
    Completed { output: TerminalOutput },
    NeedsReauth { error: CliError },
    Failed { error: CliError },
}

impl SourceApiTerminalState {
    pub(in crate::commands::source_api) fn into_result(self) -> Result<CommandOutput, CliError> {
        match self {
            Self::Completed { output } => Ok(output.into_inner()),
            Self::NeedsReauth { error } | Self::Failed { error } => Err(error),
        }
    }
}

#[derive(Debug, Clone)]
pub(super) struct SourceApiWorkflowRequest {
    pub(super) args: Rc<ApiArgs>,
    pub(super) org: OrgSlug,
}

#[derive(Debug, Clone)]
pub(super) struct IdleState {
    pub(super) args: ApiArgs,
}

#[derive(Debug, Clone)]
pub(super) struct CheckingAuthState {
    pub(super) args: Rc<ApiArgs>,
}

#[derive(Debug, Clone)]
pub(super) struct DescribingState {
    pub(super) request: Rc<SourceApiWorkflowRequest>,
}

#[derive(Debug, Clone)]
pub(super) struct BuildingPlanState {
    pub(super) descriptor: Rc<SourceApiDescriptor>,
    pub(super) descriptor_request_id: Option<String>,
    pub(super) request: Rc<SourceApiWorkflowRequest>,
}

#[derive(Debug, Clone)]
pub(super) struct PreviewingState {
    pub(super) draft: SourceApiDraft,
    pub(super) request: Rc<SourceApiWorkflowRequest>,
}

#[derive(Debug, Clone)]
pub(super) struct SourceApiExecutionState {
    pub(super) latest_request_id: Option<String>,
    pub(super) pages: Vec<SourceApiExecutionPage>,
    pub(super) plan: ExecutePlan,
    pub(super) preview: Option<SourceApiPreview>,
    pub(super) request: Rc<SourceApiWorkflowRequest>,
}

#[derive(Debug, Clone)]
pub(super) struct ExecutingPageState {
    pub(super) execution: SourceApiExecutionState,
}

#[derive(Debug, Clone)]
pub(super) struct WaitingToRetrySourceApiState {
    pub(super) next_attempt: u8,
    pub(super) target: SourceApiRetryTarget,
}

#[derive(Debug, Clone)]
pub(super) enum SourceApiRetryTarget {
    Describe {
        request: Rc<SourceApiWorkflowRequest>,
    },
    Preview {
        draft: SourceApiDraft,
        request: Rc<SourceApiWorkflowRequest>,
    },
    ExecuteFirstPage {
        execution: SourceApiExecutionState,
    },
    ResumePage {
        continuation_token: String,
        execution: SourceApiExecutionState,
    },
}

#[derive(Debug)]
pub(super) enum SourceApiEvent {
    Start,
    Authenticated {
        org: OrgSlug,
    },
    AuthFailed {
        error: CliError,
    },
    DescriptorLoaded {
        descriptor: Box<SourceApiDescriptor>,
        request_id: Option<String>,
    },
    DescribeFailed {
        error: CliError,
        retry: RetryTransition,
    },
    PlanBuilt {
        plan: PlannedCommand,
    },
    PlanFailed {
        error: CliError,
    },
    PreviewCompleted {
        preview: SourceApiPreview,
        request_id: Option<String>,
    },
    PreviewFailed {
        error: CliError,
        retry: RetryTransition,
    },
    PageFetched {
        continuation_token: Option<String>,
        page: Box<SourceApiExecutionPage>,
        preview: SourceApiPreview,
        request_id: Option<String>,
    },
    PageFetchFailed {
        error: CliError,
        retry: RetryTransition,
    },
    RetryDelayElapsed,
}

#[derive(Debug)]
pub(super) enum SourceApiEffect {
    EnsureAuthenticatedOrg,
    DescribeSourceApi {
        attempt: u8,
        request: Rc<SourceApiWorkflowRequest>,
    },
    BuildPlan {
        descriptor: Rc<SourceApiDescriptor>,
        request: Rc<SourceApiWorkflowRequest>,
    },
    PreviewSourceApi {
        attempt: u8,
        draft: SourceApiDraft,
        request: Rc<SourceApiWorkflowRequest>,
    },
    ExecuteFirstPage {
        attempt: u8,
        execution: SourceApiExecutionState,
    },
    ResumePage {
        attempt: u8,
        continuation_token: String,
        execution: SourceApiExecutionState,
    },
    WaitBeforeRetry {
        delay_ms: u64,
        next_attempt: u8,
    },
}

#[derive(Debug)]
pub(super) enum SourceApiState {
    Idle(IdleState),
    CheckingAuth(CheckingAuthState),
    Describing(DescribingState),
    BuildingPlan(BuildingPlanState),
    Previewing(PreviewingState),
    ExecutingPage(ExecutingPageState),
    WaitingToRetry(WaitingToRetrySourceApiState),
}

pub(super) type SourceApiTransition =
    Transition<SourceApiState, SourceApiTerminalState, SourceApiEffect>;

impl WorkflowLabel for SourceApiState {
    fn workflow_label(&self) -> &'static str {
        match self {
            Self::Idle(_) => "Idle",
            Self::CheckingAuth(_) => "CheckingAuth",
            Self::Describing(_) => "Describing",
            Self::BuildingPlan(_) => "BuildingPlan",
            Self::Previewing(_) => "Previewing",
            Self::ExecutingPage(_) => "ExecutingPage",
            Self::WaitingToRetry(_) => "WaitingToRetry",
        }
    }
}

impl WorkflowLabel for SourceApiTerminalState {
    fn workflow_label(&self) -> &'static str {
        match self {
            Self::Completed { .. } => "Completed",
            Self::NeedsReauth { .. } => "NeedsReauth",
            Self::Failed { .. } => "Failed",
        }
    }
}

impl WorkflowLabel for SourceApiEvent {
    fn workflow_label(&self) -> &'static str {
        source_api_event_name(self)
    }
}

impl WorkflowLabel for SourceApiEffect {
    fn workflow_label(&self) -> &'static str {
        match self {
            Self::EnsureAuthenticatedOrg => "EnsureAuthenticatedOrg",
            Self::DescribeSourceApi { .. } => "DescribeSourceApi",
            Self::BuildPlan { .. } => "BuildPlan",
            Self::PreviewSourceApi { .. } => "PreviewSourceApi",
            Self::ExecuteFirstPage { .. } => "ExecuteFirstPage",
            Self::ResumePage { .. } => "ResumePage",
            Self::WaitBeforeRetry { .. } => "WaitBeforeRetry",
        }
    }
}

pub(super) fn source_api_event_name(event: &SourceApiEvent) -> &'static str {
    match event {
        SourceApiEvent::Start => "Start",
        SourceApiEvent::Authenticated { .. } => "Authenticated",
        SourceApiEvent::AuthFailed { .. } => "AuthFailed",
        SourceApiEvent::DescriptorLoaded { .. } => "DescriptorLoaded",
        SourceApiEvent::DescribeFailed { .. } => "DescribeFailed",
        SourceApiEvent::PlanBuilt { .. } => "PlanBuilt",
        SourceApiEvent::PlanFailed { .. } => "PlanFailed",
        SourceApiEvent::PreviewCompleted { .. } => "PreviewCompleted",
        SourceApiEvent::PreviewFailed { .. } => "PreviewFailed",
        SourceApiEvent::PageFetched { .. } => "PageFetched",
        SourceApiEvent::PageFetchFailed { .. } => "PageFetchFailed",
        SourceApiEvent::RetryDelayElapsed => "RetryDelayElapsed",
    }
}
