use serde_json::json;

use onequery_cli_core::error::CliError;

use crate::cli::DebugSubcommand;
use crate::output::CommandOutput;

use super::CommandContext;
use super::ResolvedOrgSource;
use super::Runtime;

pub(crate) async fn execute<B, T>(
    command: &DebugSubcommand,
    context: &CommandContext,
    runtime: &mut Runtime<B, T>,
) -> Result<CommandOutput, CliError> {
    let output = match command {
        DebugSubcommand::Config => render_config_output(context, runtime),
        DebugSubcommand::AuthSession => render_auth_session_output(runtime),
    };

    Ok(output)
}

fn render_config_output<B, T>(context: &CommandContext, runtime: &Runtime<B, T>) -> CommandOutput {
    let mut lines = vec![
        "Debug: config".to_owned(),
        format!("Config path: {}", runtime.config.path().display()),
        format!("Base URL: {}", context.base_url),
        format!(
            "Resolved org: {}",
            display_optional(context.resolved_org.as_deref())
        ),
        format!(
            "Resolved org source: {}",
            resolved_org_source_label(context.resolved_org_source)
        ),
        "Values:".to_owned(),
        format!(
            "  active_org: {} ({})",
            display_optional(runtime.config.data().active_org.as_deref()),
            runtime.config.origins().active_org().describe()
        ),
        format!(
            "  server_url: {} ({})",
            display_optional(runtime.config.data().server_url.as_deref()),
            runtime.config.origins().server_url().describe()
        ),
        format!(
            "  request_timeout_sec: {} ({})",
            runtime.config.data().request_timeout_sec,
            runtime.config.origins().request_timeout_sec().describe()
        ),
        "Typed overrides:".to_owned(),
        format!(
            "  request_timeout_sec: {}",
            display_optional_u64(runtime.config.typed_overrides().request_timeout_sec())
        ),
        "Layers:".to_owned(),
    ];

    lines.extend(runtime.config.layer_stack().layers().iter().map(|layer| {
        let source = match layer.source() {
            crate::config::ConfigLayerSource::Defaults => "source=defaults".to_owned(),
            crate::config::ConfigLayerSource::UserFile { path } => {
                format!("source=user_file path={}", path.display())
            }
            crate::config::ConfigLayerSource::CliOverrides => "source=cli_overrides".to_owned(),
        };
        let status = match layer.status() {
            crate::config::ConfigLayerStatus::Enabled => "status=enabled".to_owned(),
            crate::config::ConfigLayerStatus::Disabled { reason } => {
                format!("status=disabled reason={reason}")
            }
        };

        format!(
            "  - {source} {status} fingerprint={} raw_toml_present={}",
            display_optional(layer.fingerprint()),
            layer.raw_toml().is_some()
        )
    }));

    CommandOutput::structured(
        lines,
        json!({
            "kind": "config",
            "configPath": runtime.config.path().display().to_string(),
            "baseUrl": context.base_url,
            "resolvedOrg": context.resolved_org,
            "resolvedOrgSource": resolved_org_source_label(context.resolved_org_source),
            "values": {
                "activeOrg": runtime.config.data().active_org,
                "serverUrl": runtime.config.data().server_url,
                "requestTimeoutSec": runtime.config.data().request_timeout_sec,
            },
            "origins": {
                "activeOrg": runtime.config.origins().active_org().describe(),
                "serverUrl": runtime.config.origins().server_url().describe(),
                "requestTimeoutSec": runtime.config.origins().request_timeout_sec().describe(),
            },
            "typedOverrides": {
                "requestTimeoutSec": runtime.config.typed_overrides().request_timeout_sec(),
            },
            "layers": runtime.config.layer_stack().layers().iter().map(|layer| {
                let (source, path) = match layer.source() {
                    crate::config::ConfigLayerSource::Defaults => ("defaults", None),
                    crate::config::ConfigLayerSource::UserFile { path } => {
                        ("user_file", Some(path.display().to_string()))
                    }
                    crate::config::ConfigLayerSource::CliOverrides => ("cli_overrides", None),
                };
                let (status, disabled_reason) = match layer.status() {
                    crate::config::ConfigLayerStatus::Enabled => ("enabled", None),
                    crate::config::ConfigLayerStatus::Disabled { reason } => {
                        ("disabled", Some(reason.as_str()))
                    }
                };

                json!({
                    "source": source,
                    "path": path,
                    "status": status,
                    "disabledReason": disabled_reason,
                    "fingerprint": layer.fingerprint(),
                    "rawTomlPresent": layer.raw_toml().is_some(),
                })
            }).collect::<Vec<_>>(),
        }),
    )
}

fn render_auth_session_output<B, T>(runtime: &Runtime<B, T>) -> CommandOutput {
    let metadata = runtime.auth_session.metadata();
    CommandOutput::structured(
        vec![
            "Debug: auth-session".to_owned(),
            format!("Auth path: {}", runtime.auth_session.auth_path().display()),
            format!(
                "Access token present: {}",
                runtime.auth_session.access_token().is_some()
            ),
            "Metadata:".to_owned(),
            format!(
                "  principal_user_id: {}",
                display_optional(metadata.principal_user_id())
            ),
            format!(
                "  principal_email: {}",
                display_optional(metadata.principal_email())
            ),
            format!(
                "  display_name: {}",
                display_optional(metadata.display_name())
            ),
            format!("  issued_at: {}", display_optional(metadata.issued_at())),
            format!("  expires_at: {}", display_optional(metadata.expires_at())),
            format!(
                "  last_refresh: {}",
                display_optional(metadata.last_refresh())
            ),
        ],
        json!({
            "kind": "auth-session",
            "authPath": runtime.auth_session.auth_path().display().to_string(),
            "accessTokenPresent": runtime.auth_session.access_token().is_some(),
            "metadata": {
                "principalUserId": metadata.principal_user_id(),
                "principalEmail": metadata.principal_email(),
                "displayName": metadata.display_name(),
                "issuedAt": metadata.issued_at(),
                "expiresAt": metadata.expires_at(),
                "lastRefresh": metadata.last_refresh(),
            },
        }),
    )
}

fn display_optional(value: Option<&str>) -> &str {
    value.unwrap_or("<none>")
}

fn display_optional_u64(value: Option<u64>) -> String {
    value.map_or_else(|| "<none>".to_owned(), |value| value.to_string())
}

fn resolved_org_source_label(source: ResolvedOrgSource) -> &'static str {
    match source {
        ResolvedOrgSource::Flag => "flag",
        ResolvedOrgSource::Config => "config",
        ResolvedOrgSource::None => "none",
    }
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::PathBuf;

    use insta::assert_snapshot;
    use uuid::Uuid;

    use crate::config::AppConfig;
    use crate::config::ConfigStore;
    use crate::config::DEFAULT_BASE_URL;
    use crate::credentials::AuthSessionStore;
    use crate::transport::auth::LoginCompletion;
    use crate::transport::auth::UserProfile;

    use super::CommandContext;
    use super::ResolvedOrgSource;
    use super::Runtime;
    use super::render_auth_session_output;
    use super::render_config_output;
    use crate::platform::BrowserLaunchError;
    use crate::platform::BrowserLauncher;
    use crate::platform::Terminal;

    #[derive(Debug)]
    struct NoopBrowser;

    impl BrowserLauncher for NoopBrowser {
        fn open_url(&self, _url: &str) -> Result<(), BrowserLaunchError> {
            Ok(())
        }
    }

    #[derive(Debug)]
    struct NoopTerminal;

    impl Terminal for NoopTerminal {
        fn stderr_line(&self, _message: &str) {}
    }

    #[test]
    fn render_debug_config_output_snapshot() {
        let runtime = Runtime {
            config: ConfigStore::with_state_for_test(
                PathBuf::from("/tmp/onequery-debug-config/config.toml"),
                AppConfig {
                    active_org: Some("acme".to_owned()),
                    server_url: Some(DEFAULT_BASE_URL.to_owned()),
                    request_timeout_sec: 90,
                },
            ),
            auth_session: AuthSessionStore::with_file_access_token_for_test(
                PathBuf::from("/tmp/onequery-debug-config/auth.json"),
                None,
            ),
            browser: NoopBrowser,
            terminal: NoopTerminal,
        };
        let context = CommandContext {
            command_line: "oneq debug config".to_owned(),
            base_url: DEFAULT_BASE_URL.to_owned(),
            request_id: None,
            resolved_org: Some("acme".to_owned()),
            resolved_org_source: ResolvedOrgSource::Config,
            verbose: false,
        };

        let output = render_config_output(&context, &runtime);

        assert_snapshot!(output.lines.join("\n"));
    }

    #[test]
    fn render_debug_auth_session_output_snapshot() {
        let test_dir =
            std::env::temp_dir().join(format!("onequery-debug-auth-session-{}", Uuid::new_v4()));
        let auth_path = test_dir.join("auth.json");
        let mut auth_session =
            AuthSessionStore::with_file_access_token_for_test(auth_path.clone(), None);
        auth_session
            .persist_login_completion(
                &LoginCompletion {
                    access_token: "token_test_123".to_owned(),
                    auth_mode: None,
                    user: UserProfile {
                        id: "usr_123".to_owned(),
                        email: "alice@example.com".to_owned(),
                        display_name: "Alice Example".to_owned(),
                    },
                    issued_at: Some("2026-03-10T00:00:00.000Z".to_owned()),
                    expires_at: Some("2026-03-17T00:00:00.000Z".to_owned()),
                },
                "oneq debug auth-session",
            )
            .unwrap_or_else(|error| panic!("expected test auth session persistence: {error}"));

        let runtime = Runtime {
            config: ConfigStore::with_state_for_test(
                PathBuf::from("/tmp/onequery-debug-config/config.toml"),
                AppConfig::default(),
            ),
            auth_session,
            browser: NoopBrowser,
            terminal: NoopTerminal,
        };

        let output = render_auth_session_output(&runtime);
        let rendered = output
            .lines
            .join("\n")
            .replace(
                &auth_path.display().to_string(),
                "/tmp/onequery-debug-auth/auth.json",
            )
            .replace(
                runtime
                    .auth_session
                    .metadata()
                    .last_refresh()
                    .expect("expected test auth session last refresh"),
                "2026-03-10T00:00:00Z",
            );

        assert_snapshot!(rendered);

        fs::remove_dir_all(&test_dir).unwrap_or_else(|error| {
            panic!("expected temp auth session cleanup to succeed: {error}");
        });
    }
}
