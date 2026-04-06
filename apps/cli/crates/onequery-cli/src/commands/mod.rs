mod auth;
mod auth_session;
mod backup;
mod config_cmd;
mod debug;
mod json_input;
mod org;
mod query;
mod restore;
mod schema;
mod serve;
mod source;
mod source_connect;
#[cfg(test)]
pub(crate) mod test_support;
mod use_cmd;

use url::Url;

use crate::cli::Command;
use crate::cli::Invocation;
use crate::cli::ListReadArgs;
use crate::cli::QueryResultWindowArgs;
use crate::cli::ReadArgs;
use crate::config::ConfigStore;
use crate::config::TypedConfigOverrides;
use crate::config::default_base_url;
use crate::credentials::AuthSessionStore;
use crate::output::CommandOutput;
use crate::platform::BrowserLauncher;
use crate::platform::PlatformAdapters;
use crate::platform::StderrTerminal;
use crate::platform::SystemBrowserLauncher;
use crate::platform::Terminal;
use crate::transport::query::QueryResultWindow;
use crate::transport::read_controls::ReadRequestControls;
use crate::version;
use onequery_cli_core::error::CliError;
use onequery_cli_core::error::ErrorStage;

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub(crate) enum ResolvedOrgSource {
    Flag,
    Config,
    None,
}

#[derive(Debug, Clone)]
pub(crate) struct CommandContext {
    pub command_line: String,
    pub base_url: String,
    pub request_id: Option<String>,
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
}

impl Runtime<SystemBrowserLauncher, StderrTerminal> {
    pub(crate) fn load(
        raw_config_overrides: crate::config::RawCliConfigOverrides,
        typed_config_overrides: TypedConfigOverrides,
    ) -> Result<Self, CliError> {
        // CONTEXT: docs/core/SPEC.md recommends a Rust crate layout while the monorepo runtime is
        // Bun-first.
        // Keep Rust state isolated in apps/cli and avoid hidden cross-runtime coupling.
        let startup_command = "onequery";
        let config = ConfigStore::load_with_overrides(
            startup_command,
            raw_config_overrides,
            typed_config_overrides,
        )?;
        version::refresh_cache_on_startup(startup_command);
        let auth_session = AuthSessionStore::load(startup_command)?;
        let platform = PlatformAdapters::system();
        Ok(Self {
            config,
            auth_session,
            browser: platform.browser,
            terminal: platform.terminal,
        })
    }
}

pub(crate) fn resolve_context<B, T>(
    invocation: &Invocation,
    runtime: &Runtime<B, T>,
) -> Result<CommandContext, CliError> {
    let base_url = resolved_base_url(&runtime.config);
    let org_from_flag = invocation
        .global
        .org
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned);
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

    if base_url.trim().is_empty() {
        return Err(CliError::new(
            "invalid base URL",
            invocation.raw_command.clone(),
            ErrorStage::LoadConfig,
            "compiled default base URL is empty",
            vec!["rebuild onequery with a valid default base URL".to_owned()],
        ));
    }

    Url::parse(&base_url).map_err(|url_error| {
        CliError::new(
            "invalid base URL",
            invocation.raw_command.clone(),
            ErrorStage::LoadConfig,
            format!("{url_error}: {base_url}"),
            vec!["rebuild onequery with a valid default base URL".to_owned()],
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

fn resolved_base_url(config: &ConfigStore) -> String {
    if let Ok(override_value) = std::env::var("ONEQUERY_BASE_URL") {
        let candidate = override_value.trim();
        if !candidate.is_empty() {
            // Comment: transport path composition normalizes host-only URLs,
            // proxy-prefixed URLs, and values that already include `/api/cli`.
            return candidate.to_owned();
        }
    }

    if let Some(server_url) = config.data().server_url.as_deref() {
        let candidate = server_url.trim();
        if !candidate.is_empty() {
            return candidate.to_owned();
        }
    }

    default_base_url()
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
        Command::Serve(serve_command) => serve::execute(serve_command, context, runtime).await,
        Command::Use(use_args) => use_cmd::execute(&use_args, context, runtime).await,
        Command::Schema(schema_command) => schema::execute(&schema_command).await,
        Command::Debug(debug_command) => debug::execute(&debug_command, context, runtime).await,
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
            "run onequery serve, backup, and restore on macOS, Linux, or Windows".to_owned(),
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

pub(crate) fn require_org(context: &CommandContext) -> Result<&str, CliError> {
    match context.resolved_org.as_deref() {
        Some(org) => crate::identifiers::normalize_org_slug(org).ok_or_else(|| {
            CliError::new(
                "invalid org",
                context.command_line.clone(),
                ErrorStage::ResolveOrg,
                "org must be a slug like acme-west",
                vec!["onequery org use <org_slug>".to_owned()],
            )
        }),
        None => Err(CliError::new(
            "no active org selected",
            context.command_line.clone(),
            ErrorStage::ResolveOrg,
            "no org was passed with --org and no active org is stored in config.toml.",
            vec![
                "onequery org list".to_owned(),
                "onequery org use <org>".to_owned(),
            ],
        )),
    }
}

pub(crate) fn read_controls_from_read_args(read: &ReadArgs) -> ReadRequestControls {
    ReadRequestControls {
        fields: read.fields().map(ToOwned::to_owned),
        ..ReadRequestControls::default()
    }
}

pub(crate) fn read_controls_from_list_args(read: &ListReadArgs) -> ReadRequestControls {
    ReadRequestControls {
        fields: read.read.fields().map(ToOwned::to_owned),
        page_size: read.pagination.page_size,
        cursor: read.pagination.cursor().map(ToOwned::to_owned),
        page_all: read.pagination.page_all,
    }
}

pub(crate) fn query_result_window_from_args(args: &QueryResultWindowArgs) -> QueryResultWindow {
    QueryResultWindow {
        max_rows: args.max_rows,
        max_bytes: args.max_bytes,
        cell_max_chars: args.cell_max_chars,
        timeout_ms: args.timeout_ms,
    }
}
