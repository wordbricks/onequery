use onequery_cli_core::error::CliError;
use onequery_cli_core::error::ErrorStage;
use serde_json::Value;
use serde_json::json;

use crate::cli::ConfigCommand;
use crate::cli::ConfigGetKey;
use crate::cli::ConfigSetCommand;
use crate::config::config_set_server_command_example;
use crate::config::normalize_server_url as normalize_server_origin_url;
use crate::output::CommandOutput;

use super::CommandContext;
use super::Runtime;

pub(crate) async fn execute<B, T>(
    command: &ConfigCommand,
    context: &CommandContext,
    runtime: &mut Runtime<B, T>,
) -> Result<CommandOutput, CliError> {
    match command {
        ConfigCommand::Get { key } => Ok(render_get_output(*key, runtime)),
        ConfigCommand::Set {
            action: ConfigSetCommand::Server { url },
        } => {
            let normalized = normalize_server_url_for_command(url, &context.command_line)?;
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

fn render_get_output<B, T>(key: ConfigGetKey, runtime: &Runtime<B, T>) -> CommandOutput {
    let value = match key {
        ConfigGetKey::OrgActive => ConfigGetValue::optional_string(
            key,
            runtime.config.data().active_org.as_deref(),
            runtime.config.origins().active_org().describe(),
        ),
        ConfigGetKey::ApiServerUrl => ConfigGetValue::optional_string(
            key,
            runtime.config.data().server_url.as_deref(),
            runtime.config.origins().server_url().describe(),
        ),
        ConfigGetKey::ApiRequestTimeoutSec => ConfigGetValue::u64(
            key,
            runtime.config.data().request_timeout_sec,
            runtime.config.origins().request_timeout_sec().describe(),
        ),
    };

    CommandOutput::structured(
        vec![value.text.clone()],
        json!({
            "kind": "config-get",
            "key": value.key,
            "value": value.json,
            "displayValue": value.text,
            "isSet": value.is_set,
            "origin": value.origin,
            "configPath": runtime.config.path().display().to_string(),
        }),
    )
    .with_text_stdout(format!("{}\n", value.text))
}

struct ConfigGetValue {
    key: &'static str,
    json: Value,
    text: String,
    is_set: bool,
    origin: String,
}

impl ConfigGetValue {
    fn optional_string(key: ConfigGetKey, value: Option<&str>, origin: String) -> Self {
        match value {
            Some(value) => Self {
                key: key.canonical_key(),
                json: Value::String(value.to_owned()),
                text: value.to_owned(),
                is_set: true,
                origin,
            },
            None => Self {
                key: key.canonical_key(),
                json: Value::Null,
                text: "<none>".to_owned(),
                is_set: false,
                origin,
            },
        }
    }

    fn u64(key: ConfigGetKey, value: u64, origin: String) -> Self {
        Self {
            key: key.canonical_key(),
            json: Value::from(value),
            text: value.to_string(),
            is_set: true,
            origin,
        }
    }
}

fn normalize_server_url_for_command(raw_url: &str, command_line: &str) -> Result<String, CliError> {
    normalize_server_origin_url(raw_url).map_err(|failure| {
        CliError::new(
            "invalid server URL",
            command_line,
            ErrorStage::LoadConfig,
            failure.render("server URL"),
            default_server_url_try_next(),
        )
    })
}

fn default_server_url_try_next() -> Vec<String> {
    vec![config_set_server_command_example()]
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use insta::assert_snapshot;
    use pretty_assertions::assert_eq;
    use serde_json::json;

    use crate::cli::ConfigCommand;
    use crate::cli::ConfigGetKey;
    use crate::cli::ConfigSetCommand;
    use crate::commands::ResolvedOrgSource;
    use crate::config::AppConfig;
    use crate::config::ConfigStore;
    use crate::config::default_base_url;
    use crate::credentials::AuthSessionStore;
    use crate::output::EffectiveOutputMode;
    use crate::output::render_output;
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
            command_line: format!("onequery config set server {}", default_base_url()),
            base_url: default_base_url(),
            request_id: None,
            resolved_org: None,
            resolved_org_source: ResolvedOrgSource::None,
            verbose: false,
        };

        let output = execute(
            &ConfigCommand::Set {
                action: ConfigSetCommand::Server {
                    url: default_base_url(),
                },
            },
            &context,
            &mut runtime,
        )
        .await
        .unwrap_or_else(|error| panic!("expected config set server to succeed: {error}"));

        assert_snapshot!(output.lines.join("\n"));
    }

    #[tokio::test]
    async fn get_server_renders_text_value_for_text_mode() {
        let mut runtime = Runtime {
            config: ConfigStore::with_state_for_test(
                PathBuf::from("/tmp/onequery-config-command/config.toml"),
                AppConfig {
                    server_url: Some(default_base_url()),
                    ..AppConfig::default()
                },
            ),
            auth_session: AuthSessionStore::with_file_access_token_for_test(
                PathBuf::from("/tmp/onequery-config-command/auth.json"),
                None,
            ),
            browser: NoopBrowser,
            terminal: NoopTerminal,
        };
        let context = CommandContext {
            command_line: "onequery config get api.server_url".to_owned(),
            base_url: default_base_url(),
            request_id: None,
            resolved_org: None,
            resolved_org_source: ResolvedOrgSource::None,
            verbose: false,
        };

        let output = execute(
            &ConfigCommand::Get {
                key: ConfigGetKey::ApiServerUrl,
            },
            &context,
            &mut runtime,
        )
        .await
        .unwrap_or_else(|error| panic!("expected config get api.server_url to succeed: {error}"));

        assert_eq!(
            render_output(output, EffectiveOutputMode::Text),
            format!("{}\n", default_base_url())
        );
    }

    #[tokio::test]
    async fn get_active_org_reports_none_when_unset() {
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
            command_line: "onequery config get org.active".to_owned(),
            base_url: default_base_url(),
            request_id: None,
            resolved_org: None,
            resolved_org_source: ResolvedOrgSource::None,
            verbose: false,
        };

        let output = execute(
            &ConfigCommand::Get {
                key: ConfigGetKey::OrgActive,
            },
            &context,
            &mut runtime,
        )
        .await
        .unwrap_or_else(|error| panic!("expected config get org.active to succeed: {error}"));

        assert_eq!(render_output(output, EffectiveOutputMode::Text), "<none>\n");
    }

    #[tokio::test]
    async fn get_request_timeout_json_reports_origin() {
        let mut runtime = Runtime {
            config: ConfigStore::with_state_for_test(
                PathBuf::from("/tmp/onequery-config-command/config.toml"),
                AppConfig {
                    request_timeout_sec: 15,
                    ..AppConfig::default()
                },
            ),
            auth_session: AuthSessionStore::with_file_access_token_for_test(
                PathBuf::from("/tmp/onequery-config-command/auth.json"),
                None,
            ),
            browser: NoopBrowser,
            terminal: NoopTerminal,
        };
        let context = CommandContext {
            command_line: "onequery config get api.request_timeout_sec".to_owned(),
            base_url: default_base_url(),
            request_id: None,
            resolved_org: None,
            resolved_org_source: ResolvedOrgSource::None,
            verbose: false,
        };

        let output = execute(
            &ConfigCommand::Get {
                key: ConfigGetKey::ApiRequestTimeoutSec,
            },
            &context,
            &mut runtime,
        )
        .await
        .unwrap_or_else(|error| {
            panic!("expected config get api.request_timeout_sec to succeed: {error}")
        });

        assert_eq!(
            output.into_data(),
            json!({
                "kind": "config-get",
                "key": "api.request_timeout_sec",
                "value": 15,
                "displayValue": "15",
                "isSet": true,
                "origin": "user config file /tmp/onequery-config-command/config.toml",
                "configPath": "/tmp/onequery-config-command/config.toml",
            })
        );
    }

    #[tokio::test]
    async fn set_server_rejects_api_path_suffixes() {
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
            command_line: "onequery config set server http://localhost:4545/api".to_owned(),
            base_url: default_base_url(),
            request_id: None,
            resolved_org: None,
            resolved_org_source: ResolvedOrgSource::None,
            verbose: false,
        };

        let error = execute(
            &ConfigCommand::Set {
                action: ConfigSetCommand::Server {
                    url: "http://localhost:4545/api".to_owned(),
                },
            },
            &context,
            &mut runtime,
        )
        .await
        .expect_err("expected api path suffix to be rejected");

        assert_eq!(error.title, "invalid server URL");
        assert_eq!(
            error.why,
            "server URL must be an origin without a path; found path `/api`"
        );
    }
}
