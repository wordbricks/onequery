use serde_json::json;
use url::Url;
use onequery_cli_core::error::CliError;
use onequery_cli_core::error::ErrorStage;

use crate::cli::ConfigCommand;
use crate::config::CONFIG_SET_SERVER_COMMAND_EXAMPLE;
use crate::output::CommandOutput;

use super::CommandContext;
use super::Runtime;

pub(crate) async fn execute<B, T>(
    command: &ConfigCommand,
    context: &CommandContext,
    runtime: &mut Runtime<B, T>,
) -> Result<CommandOutput, CliError> {
    match command {
        ConfigCommand::SetServer { url } => {
            let normalized = normalize_server_url(url, &context.command_line)?;
            let changed = runtime.config.data().server_url.as_deref() != Some(normalized.as_str());

            runtime
                .config
                .set_server_url(Some(normalized.clone()), &context.command_line)?;

            Ok(CommandOutput::structured(
                vec![
                    if changed {
                        "Server URL updated.".to_owned()
                    } else {
                        "Server URL unchanged.".to_owned()
                    },
                    format!("Server URL: {normalized}"),
                    format!("Config path: {}", runtime.config.path().display()),
                ],
                json!({
                    "kind": "config-set-server",
                    "serverUrl": normalized,
                    "changed": changed,
                    "sourceOfTruth": "config",
                    "configPath": runtime.config.path().display().to_string(),
                }),
            ))
        }
    }
}

fn normalize_server_url(raw_url: &str, command_line: &str) -> Result<String, CliError> {
    let normalized = raw_url.trim();
    if normalized.is_empty() {
        return Err(CliError::new(
            "invalid server URL",
            command_line,
            ErrorStage::LoadConfig,
            "server URL cannot be empty",
            default_server_url_try_next(),
        ));
    }

    let parsed = Url::parse(normalized).map_err(|parse_error| {
        CliError::new(
            "invalid server URL",
            command_line,
            ErrorStage::LoadConfig,
            parse_error.to_string(),
            default_server_url_try_next(),
        )
    })?;

    if parsed.host_str().is_none() {
        return Err(CliError::new(
            "invalid server URL",
            command_line,
            ErrorStage::LoadConfig,
            "server URL must include a hostname",
            default_server_url_try_next(),
        ));
    }

    Ok(parsed.to_string().trim_end_matches('/').to_owned())
}

fn default_server_url_try_next() -> Vec<String> {
    vec![CONFIG_SET_SERVER_COMMAND_EXAMPLE.to_owned()]
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use insta::assert_snapshot;

    use crate::cli::ConfigCommand;
    use crate::commands::ResolvedOrgSource;
    use crate::config::AppConfig;
    use crate::config::ConfigStore;
    use crate::config::DEFAULT_BASE_URL;
    use crate::credentials::AuthSessionStore;
    use crate::platform::BrowserLaunchError;
    use crate::platform::BrowserLauncher;
    use crate::platform::Terminal;

    use super::CommandContext;
    use super::Runtime;
    use super::execute;

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

    #[tokio::test]
    async fn set_server_output_snapshot() {
        let mut runtime = Runtime {
            config: ConfigStore::with_state_for_test(
                PathBuf::from("/tmp/onequery-config-command/config.toml"),
                AppConfig::default(),
            ),
            auth_session: AuthSessionStore::with_file_access_token_for_test(
                PathBuf::from("/tmp/onequery-config-command/auth.json"),
                None,
            ),
            browser: NoopBrowser,
            terminal: NoopTerminal,
        };
        let context = CommandContext {
            command_line: format!("oneq config set server {DEFAULT_BASE_URL}"),
            base_url: DEFAULT_BASE_URL.to_owned(),
            request_id: None,
            resolved_org: None,
            resolved_org_source: ResolvedOrgSource::None,
            verbose: false,
        };

        let output = execute(
            &ConfigCommand::SetServer {
                url: DEFAULT_BASE_URL.to_owned(),
            },
            &context,
            &mut runtime,
        )
        .await
        .unwrap_or_else(|error| panic!("expected config set server to succeed: {error}"));

        assert_snapshot!(output.lines.join("\n"));
    }
}
