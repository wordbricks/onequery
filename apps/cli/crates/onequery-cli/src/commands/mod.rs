mod auth;
mod auth_session;
mod backup;
mod config_cmd;
mod debug;
mod doctor;
mod explain;
mod gateway;
mod json_input;
mod org;
mod query;
mod restore;
mod source;
mod source_api;
mod source_connect;
#[cfg(test)]
pub(crate) mod test_support;
mod upgrade;

use crate::cli::Command;
use crate::cli::Invocation;
use crate::cli::ListReadArgs;
use crate::cli::QueryResultWindowArgs;
use crate::cli::ReadArgs;
use crate::config::ConfigStore;
use crate::config::TypedConfigOverrides;
use crate::config::config_set_server_url_command_example;
use crate::config::default_base_url;
use crate::config::normalize_server_url;
use crate::config::workspace_dev_base_url_for_debug_build;
use crate::credentials::AuthSessionStore;
use crate::identifiers::OrgSlug;
use crate::identifiers::RequestId;
use crate::output::CommandOutput;
use crate::platform::BrowserLauncher;
use crate::platform::PlatformAdapters;
use crate::platform::StderrTerminal;
use crate::platform::SystemBrowserLauncher;
use crate::platform::Terminal;
use crate::process_context::ProcessContext;
use crate::recovery::missing_org_try_next;
use crate::transport::query::QueryRequestWindow;
use crate::transport::read_controls::ReadRequestControls;
use onequery_cli_core::error::CliError;
use onequery_cli_core::error::ErrorStage;

pub(crate) const STARTUP_COMMAND: &str = "onequery";

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub(crate) enum ResolvedOrgSource {
    Flag,
    Config,
    None,
}

impl ResolvedOrgSource {
    pub(crate) fn describe(self) -> &'static str {
        match self {
            Self::Flag => "flag",
            Self::Config => "config",
            Self::None => "none",
        }
    }

    pub(crate) fn effective_org_label(self) -> &'static str {
        match self {
            Self::Flag => "--org",
            Self::Config => "config",
            Self::None => "unresolved",
        }
    }
}

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub(crate) enum ResolvedBaseUrlSource {
    Environment,
    Config,
    WorkspaceDev,
    SelfHostDefault,
}

impl ResolvedBaseUrlSource {
    pub(crate) fn describe(self) -> &'static str {
        match self {
            Self::Environment => "environment override",
            Self::Config => "user config",
            Self::WorkspaceDev => "workspace-dev debug fallback",
            Self::SelfHostDefault => "self-host default",
        }
    }
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub(crate) struct ResolvedBaseUrl {
    value: String,
    source: ResolvedBaseUrlSource,
}

#[derive(Debug, Clone)]
pub(crate) struct CommandContext {
    pub command_line: String,
    pub base_url: String,
    pub request_id: Option<RequestId>,
    pub resolved_org: Option<String>,
    pub resolved_org_source: ResolvedOrgSource,
    pub verbose: bool,
}

#[derive(Debug)]
pub(crate) struct Runtime<B = SystemBrowserLauncher, T = StderrTerminal> {
    pub config: ConfigStore,
    pub auth_session: AuthSessionStore,
    pub browser: B,
    pub terminal: T,
    pub process: ProcessContext,
}

impl Runtime<SystemBrowserLauncher, StderrTerminal> {
    pub(crate) fn load(
        raw_config_overrides: crate::config::RawCliConfigOverrides,
        typed_config_overrides: TypedConfigOverrides,
    ) -> Result<Self, CliError> {
        // CONTEXT: docs/core/SPEC.md recommends a Rust crate layout while the monorepo runtime is
        // Bun-first.
        // Keep Rust state isolated in apps/cli and avoid hidden cross-runtime coupling.
        let config = ConfigStore::load_with_overrides(
            STARTUP_COMMAND,
            raw_config_overrides,
            typed_config_overrides,
        )?;
        let auth_session = AuthSessionStore::load(STARTUP_COMMAND)?;
        let platform = PlatformAdapters::system();
        Ok(Self {
            config,
            auth_session,
            browser: platform.browser,
            terminal: platform.terminal,
            process: ProcessContext::capture(),
        })
    }
}

pub(crate) fn resolve_context<B, T>(
    invocation: &Invocation,
    runtime: &Runtime<B, T>,
) -> Result<CommandContext, CliError> {
    let base_url = resolved_base_url(&runtime.config, &invocation.raw_command)?;
    let org_from_flag = invocation.global.org.as_ref().map(ToString::to_string);
    let org_from_config = runtime
        .config
        .data()
        .active_org
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned);

    let (resolved_org, resolved_org_source) = if let Some(org) = org_from_flag {
        (Some(org), ResolvedOrgSource::Flag)
    } else if let Some(org) = org_from_config {
        (Some(org), ResolvedOrgSource::Config)
    } else {
        (None, ResolvedOrgSource::None)
    };

    let base_url = normalize_server_url(&base_url.value).map_err(|failure| {
        CliError::new(
            "invalid base URL",
            invocation.raw_command.clone(),
            ErrorStage::LoadConfig,
            failure.render("base URL"),
            vec![config_set_server_url_command_example()],
        )
    })?;

    Ok(CommandContext {
        command_line: invocation.raw_command.clone(),
        base_url,
        request_id: invocation.global.request_id.clone(),
        resolved_org,
        resolved_org_source,
        verbose: invocation.global.verbose,
    })
}

pub(crate) fn resolved_base_url(
    config: &ConfigStore,
    command_line: &str,
) -> Result<ResolvedBaseUrl, CliError> {
    if let Ok(override_value) = std::env::var("ONEQUERY_BASE_URL") {
        let candidate = override_value.trim();
        if !candidate.is_empty() {
            // Comment: base URL resolution stays strict so the transport can pass a
            // single app origin into Connect without guessing path semantics.
            return Ok(ResolvedBaseUrl {
                value: candidate.to_owned(),
                source: ResolvedBaseUrlSource::Environment,
            });
        }
    }

    if let Some(server_url) = config.data().server_url.as_deref() {
        let candidate = server_url.trim();
        if !candidate.is_empty() {
            return Ok(ResolvedBaseUrl {
                value: candidate.to_owned(),
                source: ResolvedBaseUrlSource::Config,
            });
        }
    }

    // Comment: debug Cargo builds target the tracked workspace-dev browser origin
    // deterministically, while release builds stay cwd-independent and fall back
    // to the self-host public origin.
    match workspace_dev_base_url_for_debug_build() {
        Ok(Some(workspace_dev_base_url)) => Ok(ResolvedBaseUrl {
            value: workspace_dev_base_url,
            source: ResolvedBaseUrlSource::WorkspaceDev,
        }),
        Ok(None) => Ok(ResolvedBaseUrl {
            value: default_base_url(),
            source: ResolvedBaseUrlSource::SelfHostDefault,
        }),
        Err(failure) => Err(CliError::new(
            "invalid workspace-dev config",
            command_line.to_owned(),
            ErrorStage::LoadConfig,
            failure.render(),
            vec![
                "fix onequery.dev.toml".to_owned(),
                "set ONEQUERY_BASE_URL or run onequery config set api.server_url <origin>"
                    .to_owned(),
            ],
        )),
    }
}

pub(crate) async fn execute<B, T>(
    command: Command,
    context: &CommandContext,
    runtime: &mut Runtime<B, T>,
) -> Result<CommandOutput, CliError>
where
    B: BrowserLauncher,
    T: Terminal,
{
    match command {
        Command::Auth(auth_command) => auth::execute(&auth_command, context, runtime).await,
        Command::Backup(backup_args) => backup::execute(&backup_args, context, runtime).await,
        Command::Config(config_command) => {
            config_cmd::execute(&config_command, context, runtime).await
        }
        Command::Org(org_command) => org::execute(&org_command, context, runtime).await,
        Command::Source(source_command) => source::execute(&source_command, context, runtime).await,
        Command::Query(query_command) => query::execute(query_command, context, runtime).await,
        Command::Restore(restore_args) => restore::execute(&restore_args, context, runtime).await,
        Command::Gateway(gateway_args) => {
            gateway::execute(gateway_args.command(), context, runtime).await
        }
        Command::Upgrade => upgrade::execute(context, runtime).await,
        Command::Api(api_args) => source_api::execute(&api_args, context, runtime).await,
        Command::Explain(_) => Err(CliError::internal(
            context.command_line.clone(),
            "explain commands must run without a loaded runtime",
        )),
        Command::Doctor(_) => Err(CliError::internal(
            context.command_line.clone(),
            "doctor commands must run without a loaded runtime",
        )),
        Command::Debug(debug_command) => debug::execute(&debug_command, context, runtime).await,
    }
}

pub(crate) fn execute_without_runtime(invocation: &Invocation) -> Result<CommandOutput, CliError> {
    match &invocation.command {
        Command::Explain(args) => explain::execute(args),
        Command::Doctor(command) => doctor::execute(
            command,
            &invocation.raw_command,
            invocation.global.requested_output_mode,
        ),
        _ => Err(CliError::internal(
            invocation.raw_command.clone(),
            format!(
                "command `{}` unexpectedly bypassed runtime loading",
                invocation.command.command_path()
            ),
        )),
    }
}

pub(crate) fn ensure_self_host_runtime_supported(command_line: &str) -> Result<(), CliError> {
    if cfg!(unix) || cfg!(windows) {
        return Ok(());
    }

    Err(CliError::new(
        "self-host runtime is not supported on this platform",
        command_line,
        ErrorStage::Internal,
        "the published self-host runtime currently supports macOS, Linux, and Windows".to_owned(),
        vec![
            "run onequery gateway, backup, and restore on macOS, Linux, or Windows".to_owned(),
            "use a supported host and point remote clients at that server".to_owned(),
        ],
    ))
}

pub(crate) fn is_process_running(pid: u32) -> bool {
    #[cfg(unix)]
    {
        unsafe { libc::kill(pid as i32, 0) == 0 }
    }

    #[cfg(windows)]
    {
        use windows_sys::Win32::Foundation::CloseHandle;
        use windows_sys::Win32::Foundation::WAIT_TIMEOUT;
        use windows_sys::Win32::System::Threading::OpenProcess;
        use windows_sys::Win32::System::Threading::PROCESS_SYNCHRONIZE;
        use windows_sys::Win32::System::Threading::WaitForSingleObject;

        let handle = unsafe { OpenProcess(PROCESS_SYNCHRONIZE, 0, pid) };
        if handle.is_null() {
            return false;
        }

        let wait_result = unsafe { WaitForSingleObject(handle, 0) };
        let _ = unsafe { CloseHandle(handle) };
        wait_result == WAIT_TIMEOUT
    }

    #[cfg(not(any(unix, windows)))]
    {
        let _ = pid;
        false
    }
}

#[cfg(test)]
pub(crate) fn with_command_snapshot_path(test: impl FnOnce()) {
    let mut settings = insta::Settings::clone_current();
    settings.set_snapshot_path("../snapshots");
    settings.bind(test);
}

pub(crate) fn require_org(context: &CommandContext) -> Result<OrgSlug, CliError> {
    match context.resolved_org.as_deref() {
        Some(org) => OrgSlug::try_from(org).map_err(|error| {
            CliError::new(
                "invalid org",
                context.command_line.clone(),
                ErrorStage::ResolveOrg,
                error.to_string(),
                vec!["onequery org use <org_slug>".to_owned()],
            )
        }),
        None => Err(CliError::new(
            "no active org selected",
            context.command_line.clone(),
            ErrorStage::ResolveOrg,
            "no org was passed with --org and no active org is stored in config.toml.",
            missing_org_try_next(),
        )),
    }
}

pub(crate) fn read_controls_from_read_args(_read: &ReadArgs) -> ReadRequestControls {
    ReadRequestControls::default()
}

pub(crate) fn read_controls_from_list_args(read: &ListReadArgs) -> ReadRequestControls {
    ReadRequestControls {
        page_size: read.pagination.page_size.map(std::num::NonZeroUsize::get),
        cursor: read.pagination.cursor().map(ToOwned::to_owned),
        page_all: read.pagination.page_all,
    }
}

pub(crate) fn query_result_window_from_args(args: &QueryResultWindowArgs) -> QueryRequestWindow {
    QueryRequestWindow {
        max_rows: args.max_rows.map(std::num::NonZeroUsize::get),
        max_bytes: args.max_bytes.map(std::num::NonZeroUsize::get),
        cell_max_chars: args.cell_max_chars.map(std::num::NonZeroUsize::get),
        timeout_ms: args.timeout_ms.map(std::num::NonZeroU64::get),
    }
}
