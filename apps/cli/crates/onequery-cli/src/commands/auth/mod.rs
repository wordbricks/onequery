mod effects;
mod presentation;
mod session;
mod workflow;

#[cfg(test)]
mod tests;

use std::path::PathBuf;

use crate::cli::AuthImportArgs;
use crate::cli::AuthSubcommand;
use crate::cli::ReadArgs;
use crate::credentials::ImportedAuthSession;
use crate::output::CommandOutput;
use crate::transport::auth::LoginCompletion;
use crate::transport::auth::LoginSession;
use crate::transport::auth::WhoAmI;
use crate::transport::client::AuthenticatedApiClient;
use crate::transport::org;
use crate::workflows::runner::DEFAULT_MAX_WORKFLOW_STEPS;
use crate::workflows::runner::WorkflowRunConfig;
use crate::workflows::runner::run_reducer_workflow;
use onequery_core::error::CliError;
use onequery_core::error::ErrorStage;

use self::effects::execute_effect;
use self::presentation::render_import_output;
use self::presentation::render_login_output;
use self::workflow::reduce;
use super::CommandContext;
use super::Runtime;
use super::auth_session::PersistedLoginNextStep;

#[derive(Debug, Clone, Eq, PartialEq)]
enum AuthMode {
    Login,
    Import {
        input: PathBuf,
        dry_run: bool,
    },
    Logout {
        dry_run: bool,
        persisted_credentials_present: bool,
        active_org: Option<String>,
    },
    Whoami {
        read: ReadArgs,
    },
}

#[derive(Debug)]
enum AuthState {
    Idle { mode: AuthMode },
    StartingLogin,
    LoadingImportInput { dry_run: bool },
    PersistingImportedSession,
    AttemptingBrowser,
    PollingLogin,
    ResolvingLoginIdentity,
    PersistingToken,
    BootstrappingOrgClient,
    BootstrappingOrgList,
    PersistingBootstrappedOrg,
    RemovingCredentials,
    ClearingActiveOrg,
    CheckingWhoamiAuth { read: ReadArgs },
    FetchingWhoami { read: ReadArgs },
}

#[derive(Debug)]
enum AuthTerminalState {
    Completed { result: Box<CompletedAuthResult> },
    NeedsReauth { error: CliError },
    Failed { error: CliError },
}

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
enum AuthFailureOutcome {
    NeedsReauth,
    Failed,
}

#[derive(Debug)]
enum CompletedAuthResult {
    Import {
        imported: ImportedAuthSession,
    },
    Login {
        completion: LoginCompletion,
        active_org: Option<String>,
        warnings: Vec<CliError>,
    },
    Rendered {
        output: CommandOutput,
    },
}

#[derive(Debug)]
enum AuthEvent {
    Start,
    LoginSessionStarted {
        session: LoginSession,
    },
    LoginSessionStartFailed {
        error: CliError,
    },
    BrowserAttempted {
        session: LoginSession,
    },
    LoginAuthorized {
        access_token: String,
    },
    LoginCompleted {
        completion: LoginCompletion,
    },
    LoginCompletionFailed {
        error: CliError,
    },
    ImportPayloadLoaded {
        imported: ImportedAuthSession,
    },
    ImportPayloadLoadFailed {
        error: CliError,
    },
    ImportedSessionPersisted {
        imported: ImportedAuthSession,
    },
    ImportedSessionPersistFailed {
        error: CliError,
    },
    TokenPersisted {
        completion: LoginCompletion,
        next_step: PersistedLoginNextStep,
    },
    TokenPersistFailed {
        error: CliError,
    },
    BootstrapClientBuilt {
        completion: LoginCompletion,
        client: Box<AuthenticatedApiClient>,
    },
    BootstrapClientBuildFailed {
        completion: LoginCompletion,
        error: CliError,
    },
    BootstrapOrgsLoaded {
        completion: LoginCompletion,
        orgs: Vec<org::OrgSummary>,
    },
    BootstrapOrgsLoadFailed {
        completion: LoginCompletion,
        error: CliError,
    },
    BootstrapOrgPersisted {
        completion: LoginCompletion,
        active_org: String,
    },
    BootstrapOrgPersistFailed {
        completion: LoginCompletion,
        error: CliError,
    },
    LogoutCompleted,
    ActiveOrgCleared,
    ActiveOrgClearFailed {
        error: CliError,
    },
    LogoutFailed {
        error: CliError,
    },
    WhoamiAuthChecked,
    WhoamiAuthFailed {
        error: CliError,
    },
    WhoamiFetched {
        identity: WhoAmI,
        request_id: Option<String>,
    },
    WhoamiFetchFailed {
        error: CliError,
        outcome: AuthFailureOutcome,
    },
}

#[derive(Debug)]
enum AuthEffect {
    StartLoginSession,
    LoadImportPayload {
        input: PathBuf,
    },
    OpenBrowser {
        session: LoginSession,
    },
    PollLogin {
        session: LoginSession,
    },
    ResolveLoginIdentity {
        access_token: String,
    },
    PersistToken {
        completion: LoginCompletion,
    },
    PersistImportedSession {
        imported: ImportedAuthSession,
    },
    BuildBootstrapClient {
        completion: LoginCompletion,
    },
    FetchBootstrapOrgs {
        completion: LoginCompletion,
        client: Box<AuthenticatedApiClient>,
    },
    PersistBootstrappedOrg {
        completion: LoginCompletion,
        org: String,
    },
    RemoveCredentials,
    ClearActiveOrg,
    EnsureAuthenticated,
    FetchWhoami,
}

pub(super) async fn execute<B, T>(
    command: &AuthSubcommand,
    context: &CommandContext,
    runtime: &mut Runtime<B, T>,
) -> Result<CommandOutput, CliError>
where
    B: crate::platform::BrowserLauncher,
    T: crate::platform::Terminal,
{
    let mode = match command {
        AuthSubcommand::Login => AuthMode::Login,
        AuthSubcommand::Import(AuthImportArgs { input, dry_run }) => AuthMode::Import {
            input: input.clone(),
            dry_run: *dry_run,
        },
        AuthSubcommand::Logout { dry_run } => AuthMode::Logout {
            dry_run: *dry_run,
            persisted_credentials_present: runtime.auth_session.auth_path().exists(),
            active_org: runtime
                .config
                .data()
                .active_org
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToOwned::to_owned),
        },
        AuthSubcommand::Whoami { read } => {
            validate_whoami_read_args(read, context)?;
            AuthMode::Whoami { read: read.clone() }
        }
        AuthSubcommand::Session { action } => {
            return session::execute(action, context, runtime).await;
        }
    };

    let final_state = run_reducer_workflow(
        AuthState::Idle { mode },
        AuthEvent::Start,
        WorkflowRunConfig {
            context,
            runtime,
            workflow_name: "auth",
            command_line: &context.command_line,
            verbose: context.verbose,
            max_steps: DEFAULT_MAX_WORKFLOW_STEPS,
        },
        reduce,
        |effect, context, runtime| Box::pin(execute_effect(effect, context, runtime)),
    )
    .await?;

    match final_state {
        AuthTerminalState::Completed { result } => match *result {
            CompletedAuthResult::Import { imported } => Ok(render_import_output(&imported)),
            CompletedAuthResult::Login {
                completion,
                active_org,
                warnings,
            } => Ok(render_login_output(&completion, active_org, &warnings)),
            CompletedAuthResult::Rendered { output } => Ok(output),
        },
        AuthTerminalState::NeedsReauth { error } | AuthTerminalState::Failed { error } => {
            Err(error)
        }
    }
}

const WHOAMI_ALLOWED_FIELDS: [&str; 10] = [
    "authMode",
    "user",
    "user.id",
    "user.email",
    "user.displayName",
    "authenticated",
    "effectiveOrg",
    "effectiveOrgSource",
    "issuedAt",
    "expiresAt",
];

fn validate_whoami_read_args(read: &ReadArgs, context: &CommandContext) -> Result<(), CliError> {
    let Some(fields) = read.fields() else {
        return Ok(());
    };

    let unsupported = fields
        .split(',')
        .map(str::trim)
        .filter(|field| !field.is_empty())
        .filter(|field| !WHOAMI_ALLOWED_FIELDS.contains(field))
        .map(ToOwned::to_owned)
        .collect::<Vec<_>>();

    if unsupported.is_empty() {
        return Ok(());
    }

    Err(CliError::new(
        "invalid fields selection",
        context.command_line.clone(),
        ErrorStage::Auth,
        format!(
            "unsupported auth whoami field selection: {}",
            unsupported.join(", ")
        ),
        vec![format!(
            "retry with one or more of: {}",
            WHOAMI_ALLOWED_FIELDS.join(", ")
        )],
    ))
}
