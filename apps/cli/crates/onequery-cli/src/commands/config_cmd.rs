use std::path::Path;

use onequery_cli_core::error::CliError;
use onequery_cli_core::error::ErrorStage;
use serde_json::Value;
use serde_json::json;

use crate::cli::ConfigCommand;
use crate::cli::ConfigKey;
use crate::cli::ConfigSetKey;
use crate::config::ConfigValueOrigin;
use crate::config::config_set_request_timeout_sec_command_example;
use crate::config::config_set_server_url_command_example;
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
        ConfigCommand::Set { key, value } => execute_set_command(*key, value, context, runtime),
    }
}

fn execute_set_command<B, T>(
    key: ConfigSetKey,
    raw_value: &str,
    context: &CommandContext,
    runtime: &mut Runtime<B, T>,
) -> Result<CommandOutput, CliError> {
    let changed = match key {
        ConfigSetKey::ApiServerUrl => {
            let normalized = normalize_server_url_for_command(raw_value, &context.command_line)?;
            let changed = persisted_value_changed(
                runtime.config.data().server_url.as_deref(),
                Some(normalized.as_str()),
                runtime.config.origins().server_url(),
                runtime.config.path(),
            );
            runtime
                .config
                .set_server_url(Some(normalized), &context.command_line)?;
            changed
        }
        ConfigSetKey::ApiRequestTimeoutSec => {
            let request_timeout_sec =
                parse_request_timeout_sec_for_command(raw_value, &context.command_line)?;
            let changed = persisted_value_changed(
                runtime.config.data().request_timeout_sec,
                request_timeout_sec,
                runtime.config.origins().request_timeout_sec(),
                runtime.config.path(),
            );
            runtime
                .config
                .set_request_timeout_sec(request_timeout_sec, &context.command_line)?;
            changed
        }
    };

    Ok(
        read_config_value(key.config_key(), runtime)
            .into_set_output(changed, runtime.config.path()),
    )
}

fn persisted_value_changed<T: PartialEq>(
    current: T,
    next: T,
    origin: &ConfigValueOrigin,
    config_path: &Path,
) -> bool {
    current != next
        || !matches!(origin, ConfigValueOrigin::UserFile { path } if path == config_path)
}

fn render_get_output<B, T>(key: ConfigKey, runtime: &Runtime<B, T>) -> CommandOutput {
    read_config_value(key, runtime).into_get_output(runtime.config.path())
}

fn read_config_value<B, T>(key: ConfigKey, runtime: &Runtime<B, T>) -> ConfigValueView {
    match key {
        ConfigKey::OrgActive => ConfigValueView::optional_string(
            key,
            runtime.config.data().active_org.as_deref(),
            runtime.config.origins().active_org().describe(),
        ),
        ConfigKey::ApiServerUrl => ConfigValueView::optional_string(
            key,
            runtime.config.data().server_url.as_deref(),
            runtime.config.origins().server_url().describe(),
        ),
        ConfigKey::ApiRequestTimeoutSec => ConfigValueView::u64(
            key,
            runtime.config.data().request_timeout_sec,
            runtime.config.origins().request_timeout_sec().describe(),
        ),
    }
}

struct ConfigValueView {
    key: &'static str,
    json: Value,
    display_value: String,
    is_set: bool,
    origin: String,
}

impl ConfigValueView {
    fn optional_string(key: ConfigKey, value: Option<&str>, origin: String) -> Self {
        match value {
            Some(value) => Self {
                key: key.canonical_key(),
                json: Value::String(value.to_owned()),
                display_value: value.to_owned(),
                is_set: true,
                origin,
            },
            None => Self {
                key: key.canonical_key(),
                json: Value::Null,
                display_value: "<none>".to_owned(),
                is_set: false,
                origin,
            },
        }
    }

    fn u64(key: ConfigKey, value: u64, origin: String) -> Self {
        Self {
            key: key.canonical_key(),
            json: Value::from(value),
            display_value: value.to_string(),
            is_set: true,
            origin,
        }
    }

    fn into_get_output(self, config_path: &Path) -> CommandOutput {
        let Self {
            key,
            json,
            display_value,
            is_set,
            origin,
        } = self;
        let text_stdout = format!("{display_value}\n");

        CommandOutput::structured(
            vec![display_value.clone()],
            json!({
                "kind": "config-get",
                "key": key,
                "value": json,
                "displayValue": display_value,
                "isSet": is_set,
                "origin": origin,
                "configPath": config_path.display().to_string(),
            }),
        )
        .with_text_stdout(text_stdout)
    }

    fn into_set_output(self, changed: bool, config_path: &Path) -> CommandOutput {
        let Self {
            key,
            json,
            display_value,
            origin,
            ..
        } = self;
        let status = if changed {
            format!("{key} updated.")
        } else {
            format!("{key} unchanged.")
        };

        CommandOutput::structured(
            vec![
                status,
                format!("Value: {display_value}"),
                format!("Origin: {origin}"),
            ],
            json!({
                "kind": "config-set",
                "key": key,
                "value": json,
                "displayValue": display_value,
                "changed": changed,
                "origin": origin,
                "configPath": config_path.display().to_string(),
            }),
        )
    }
}

fn normalize_server_url_for_command(raw_url: &str, command_line: &str) -> Result<String, CliError> {
    normalize_server_origin_url(raw_url).map_err(|failure| {
        CliError::new(
            "invalid config value",
            command_line,
            ErrorStage::LoadConfig,
            failure.render(ConfigSetKey::ApiServerUrl.canonical_key()),
            vec![config_set_server_url_command_example()],
        )
    })
}

fn parse_request_timeout_sec_for_command(
    raw_value: &str,
    command_line: &str,
) -> Result<u64, CliError> {
    let request_timeout_sec = raw_value.parse::<u64>().map_err(|error| {
        CliError::new(
            "invalid config value",
            command_line,
            ErrorStage::LoadConfig,
            format!(
                "{} must be a positive integer: {error}",
                ConfigSetKey::ApiRequestTimeoutSec.canonical_key()
            ),
            vec![config_set_request_timeout_sec_command_example()],
        )
    })?;

    if request_timeout_sec == 0 {
        return Err(CliError::new(
            "invalid config value",
            command_line,
            ErrorStage::LoadConfig,
            format!(
                "{} must be greater than 0",
                ConfigSetKey::ApiRequestTimeoutSec.canonical_key()
            ),
            vec![config_set_request_timeout_sec_command_example()],
        ));
    }

    Ok(request_timeout_sec)
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::Path;
    use std::path::PathBuf;

    use insta::assert_snapshot;
    use pretty_assertions::assert_eq;
    use serde_json::json;

    use crate::cli::ConfigCommand;
    use crate::cli::ConfigKey;
    use crate::cli::ConfigSetKey;
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

    fn fresh_unpersisted_config_path(test_dir_name: &str) -> PathBuf {
        let config_path = PathBuf::from("/tmp")
            .join(test_dir_name)
            .join("config.toml");
        clear_test_config_parent(&config_path);
        config_path
    }

    fn clear_test_config_parent(config_path: &Path) {
        if let Some(parent_dir) = config_path.parent() {
            fs::remove_dir_all(parent_dir).ok();
        }
    }

    #[tokio::test]
    async fn set_api_server_url_output_snapshot() {
        let config_path =
            fresh_unpersisted_config_path("onequery-config-command-set-api-server-url");
        let mut runtime = Runtime {
            config: ConfigStore::with_unpersisted_defaults_for_test(config_path),
            auth_session: AuthSessionStore::with_file_access_token_for_test(
                PathBuf::from("/tmp/onequery-config-command/auth.json"),
                None,
            ),
            browser: NoopBrowser,
            terminal: NoopTerminal,
            process: crate::process_context::ProcessContext::default(),
        };
        let context = CommandContext {
            command_line: format!("onequery config set api.server_url {}", default_base_url()),
            base_url: default_base_url(),
            request_id: None,
            resolved_org: None,
            resolved_org_source: ResolvedOrgSource::None,
            verbose: false,
        };

        let output = execute(
            &ConfigCommand::Set {
                key: ConfigSetKey::ApiServerUrl,
                value: default_base_url(),
            },
            &context,
            &mut runtime,
        )
        .await
        .unwrap_or_else(|error| panic!("expected config set api.server_url to succeed: {error}"));

        assert_snapshot!(output.lines.join("\n"));
    }

    #[tokio::test]
    async fn get_api_server_url_renders_text_value_for_text_mode() {
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
            process: crate::process_context::ProcessContext::default(),
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
                key: ConfigKey::ApiServerUrl,
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
            process: crate::process_context::ProcessContext::default(),
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
                key: ConfigKey::OrgActive,
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
            process: crate::process_context::ProcessContext::default(),
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
                key: ConfigKey::ApiRequestTimeoutSec,
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
    async fn set_request_timeout_reports_persisted_change_for_default_value() {
        let config_path =
            fresh_unpersisted_config_path("onequery-config-command-set-request-timeout-default");
        let mut runtime = Runtime {
            config: ConfigStore::with_unpersisted_defaults_for_test(config_path.clone()),
            auth_session: AuthSessionStore::with_file_access_token_for_test(
                PathBuf::from("/tmp/onequery-config-command/auth.json"),
                None,
            ),
            browser: NoopBrowser,
            terminal: NoopTerminal,
            process: crate::process_context::ProcessContext::default(),
        };
        let context = CommandContext {
            command_line: "onequery config set api.request_timeout_sec 60".to_owned(),
            base_url: default_base_url(),
            request_id: None,
            resolved_org: None,
            resolved_org_source: ResolvedOrgSource::None,
            verbose: false,
        };

        let output = execute(
            &ConfigCommand::Set {
                key: ConfigSetKey::ApiRequestTimeoutSec,
                value: "60".to_owned(),
            },
            &context,
            &mut runtime,
        )
        .await
        .unwrap_or_else(|error| {
            panic!("expected config set api.request_timeout_sec to succeed: {error}")
        });

        assert_eq!(
            output.into_data(),
            json!({
                "kind": "config-set",
                "key": "api.request_timeout_sec",
                "value": 60,
                "displayValue": "60",
                "changed": true,
                "origin": format!("user config file {}", config_path.display()),
                "configPath": config_path.display().to_string(),
            })
        );
    }

    #[tokio::test]
    async fn set_api_server_url_rejects_api_path_suffixes() {
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
            process: crate::process_context::ProcessContext::default(),
        };
        let context = CommandContext {
            command_line: "onequery config set api.server_url http://localhost:4545/api".to_owned(),
            base_url: default_base_url(),
            request_id: None,
            resolved_org: None,
            resolved_org_source: ResolvedOrgSource::None,
            verbose: false,
        };

        let error = execute(
            &ConfigCommand::Set {
                key: ConfigSetKey::ApiServerUrl,
                value: "http://localhost:4545/api".to_owned(),
            },
            &context,
            &mut runtime,
        )
        .await
        .expect_err("expected api path suffix to be rejected");

        assert_eq!(error.title, "invalid config value");
        assert_eq!(
            error.why,
            "api.server_url must be an origin without a path; found path `/api`"
        );
    }

    #[tokio::test]
    async fn set_request_timeout_rejects_zero() {
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
            process: crate::process_context::ProcessContext::default(),
        };
        let context = CommandContext {
            command_line: "onequery config set api.request_timeout_sec 0".to_owned(),
            base_url: default_base_url(),
            request_id: None,
            resolved_org: None,
            resolved_org_source: ResolvedOrgSource::None,
            verbose: false,
        };

        let error = execute(
            &ConfigCommand::Set {
                key: ConfigSetKey::ApiRequestTimeoutSec,
                value: "0".to_owned(),
            },
            &context,
            &mut runtime,
        )
        .await
        .expect_err("expected zero timeout to be rejected");

        assert_eq!(error.title, "invalid config value");
        assert_eq!(error.why, "api.request_timeout_sec must be greater than 0");
    }
}
