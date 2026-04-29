use onequery_core::error::CliError;
use onequery_core::error::ErrorStage;
use serde_json::json;
use url::Url;

use crate::output::CommandOutput;
use crate::platform::BrowserLauncher;
use crate::platform::Terminal;

use super::CommandContext;
use super::Runtime;
use super::require_org;

pub(crate) async fn execute<B, T>(
    context: &CommandContext,
    runtime: &mut Runtime<B, T>,
) -> Result<CommandOutput, CliError>
where
    B: BrowserLauncher,
    T: Terminal,
{
    let org = require_org(context)?;
    let dashboard_url = dashboard_url(&context.base_url, org.as_str(), &context.command_line)?;

    runtime
        .browser
        .open_url(dashboard_url.as_str())
        .map_err(|open_error| {
            CliError::new(
                "failed to open OneQuery dashboard",
                &context.command_line,
                ErrorStage::Internal,
                format!("could not open browser automatically ({open_error})"),
                vec![format!("open {dashboard_url} manually")],
            )
        })?;

    Ok(CommandOutput::structured(
        vec![
            "Opened OneQuery dashboard in browser.".to_owned(),
            format!("URL: {dashboard_url}"),
        ],
        json!({
            "kind": "web",
            "openedBrowser": true,
            "url": dashboard_url,
        }),
    ))
}

fn dashboard_url(base_url: &str, org_slug: &str, command_line: &str) -> Result<String, CliError> {
    let mut url = Url::parse(base_url).map_err(|url_error| {
        CliError::new(
            "invalid dashboard URL",
            command_line,
            ErrorStage::LoadConfig,
            format!("base URL `{base_url}` is invalid: {url_error}"),
            vec!["run onequery config set api.server_url <origin>".to_owned()],
        )
    })?;
    url.set_query(None);
    url.set_fragment(None);
    url.path_segments_mut()
        .map_err(|_| {
            CliError::new(
                "invalid dashboard URL",
                command_line,
                ErrorStage::LoadConfig,
                format!("base URL `{base_url}` cannot be used as a dashboard origin"),
                vec!["run onequery config set api.server_url <origin>".to_owned()],
            )
        })?
        .clear()
        .push(org_slug);
    Ok(url.to_string())
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;
    use std::sync::Mutex;

    use insta::assert_snapshot;
    use onequery_core::error::ErrorStage;
    use pretty_assertions::assert_eq;

    use crate::commands::ResolvedOrgSource;
    use crate::config::ConfigStore;
    use crate::config::default_base_url;
    use crate::credentials::AuthSessionStore;
    use crate::identifiers::test_org_slug;
    use crate::platform::BrowserLaunchError;
    use crate::platform::BrowserLauncher;
    use crate::platform::Terminal;

    use super::CommandContext;
    use super::Runtime;
    use super::dashboard_url;
    use super::execute;

    #[derive(Debug, Clone)]
    struct RecordingBrowser {
        urls: Arc<Mutex<Vec<String>>>,
        failure: Option<&'static str>,
    }

    impl RecordingBrowser {
        fn succeed() -> Self {
            Self {
                urls: Arc::new(Mutex::new(Vec::new())),
                failure: None,
            }
        }

        fn fail(message: &'static str) -> Self {
            Self {
                urls: Arc::new(Mutex::new(Vec::new())),
                failure: Some(message),
            }
        }

        fn urls(&self) -> Vec<String> {
            self.urls.lock().expect("expected URL lock").clone()
        }
    }

    impl BrowserLauncher for RecordingBrowser {
        fn open_url(&self, url: &str) -> Result<(), BrowserLaunchError> {
            if let Some(message) = self.failure {
                return Err(BrowserLaunchError::Open {
                    message: message.to_owned(),
                });
            }

            self.urls
                .lock()
                .expect("expected URL lock")
                .push(url.to_owned());
            Ok(())
        }
    }

    #[derive(Debug)]
    struct NoopTerminal;

    impl Terminal for NoopTerminal {
        fn stderr_line(&self, _message: &str) {}
    }

    fn test_context() -> CommandContext {
        CommandContext {
            command_line: "onequery web".to_owned(),
            base_url: "https://onequery.example.com".to_owned(),
            request_id: None,
            resolved_org: Some(test_org_slug("acme-west").to_string()),
            resolved_org_source: ResolvedOrgSource::Config,
            verbose: false,
        }
    }

    fn test_runtime(browser: RecordingBrowser) -> Runtime<RecordingBrowser, NoopTerminal> {
        Runtime {
            config: ConfigStore::with_unpersisted_defaults_for_test(
                "/tmp/onequery-web-command/config.toml".into(),
            ),
            auth_session: AuthSessionStore::with_file_access_token_for_test(
                "/tmp/onequery-web-command/auth.json".into(),
                None,
            ),
            browser,
            terminal: NoopTerminal,
            process: onequery_core::process_context::ProcessContext::default(),
        }
    }

    #[tokio::test]
    async fn web_command_opens_active_org_dashboard_output_snapshot() {
        let browser = RecordingBrowser::succeed();
        let mut runtime = test_runtime(browser.clone());
        let output = execute(&test_context(), &mut runtime)
            .await
            .expect("expected web command to succeed");

        assert_snapshot!(output.lines.join("\n"));
        assert_eq!(
            browser.urls(),
            vec!["https://onequery.example.com/acme-west".to_owned()]
        );
    }

    #[tokio::test]
    async fn web_command_requires_active_org() {
        let browser = RecordingBrowser::succeed();
        let mut runtime = test_runtime(browser);
        let mut context = test_context();
        context.resolved_org = None;
        context.resolved_org_source = ResolvedOrgSource::None;

        let error = execute(&context, &mut runtime)
            .await
            .expect_err("expected missing org error");

        assert_eq!(error.stage, ErrorStage::ResolveOrg);
    }

    #[tokio::test]
    async fn web_command_reports_browser_launch_failures() {
        let browser = RecordingBrowser::fail("launch denied");
        let mut runtime = test_runtime(browser);

        let error = execute(&test_context(), &mut runtime)
            .await
            .expect_err("expected browser launch error");

        assert_eq!(
            (error.title.as_str(), error.stage),
            ("failed to open OneQuery dashboard", ErrorStage::Internal)
        );
    }

    #[test]
    fn dashboard_url_uses_org_path() {
        assert_eq!(
            dashboard_url(&default_base_url(), "acme-west", "onequery web")
                .expect("expected dashboard URL"),
            format!("{}/acme-west", default_base_url())
        );
    }
}
