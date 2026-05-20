use onequery_core::error::CliError;
use onequery_core::error::ErrorStage;
use onequery_source_connect_cli::SourceConnectApiSuccess;
use onequery_source_connect_cli::SourceConnectFailureOutcome;
use onequery_source_connect_cli::SourceConnectHost;
use onequery_source_connect_cli::SourceConnectHostFailure;
use onequery_source_connect_cli::SourceConnectInputError;
use onequery_source_connect_cli::SourceConnectInvocation;
use onequery_source_connect_cli::SourceConnectProvider;
use onequery_source_connect_cli::SourceConnectRenderedData;
use onequery_source_connect_cli::SourceConnectRenderedOutput;
use onequery_source_connect_cli::SourceConnectResult;
use onequery_source_connect_cli::source_connect_input_examples;
use serde_json::Map;
use serde_json::Value;

use crate::cli::SourceConnectArgs;
use crate::output::CommandOutput;
use crate::output::serialize_command_data;
use crate::presentation::api_failure::ApiErrorPresentation;
use crate::presentation::api_failure::present_api_failure_with_context;
use crate::recovery::auth_login_try_next;
use crate::recovery::command_then_retry_try_next;
use crate::recovery::retry_try_next;
use crate::transport::api_failure::ApiFailure;
use crate::transport::source_connect;
use crate::transport::source_connect::SourceConnectGuide;
use crate::workflows::retry::RetryDirective;
use crate::workflows::retry::classify_retry_directive;

use super::CommandContext;
use super::Runtime;
use super::auth_session::ensure_authenticated_org;

const SOURCE_CONNECT_COMMAND: &str = "onequery source connect";

pub(super) async fn execute<B, T>(
    args: &SourceConnectArgs,
    context: &CommandContext,
    runtime: &mut Runtime<B, T>,
) -> Result<CommandOutput, CliError> {
    let invocation = SourceConnectInvocation {
        source: args.source.clone(),
        input: args.input.clone(),
    };
    let mut host = OneQuerySourceConnectHost { context, runtime };
    onequery_source_connect_cli::execute(&invocation, &mut host).await
}

struct OneQuerySourceConnectHost<'a, B, T> {
    context: &'a CommandContext,
    runtime: &'a mut Runtime<B, T>,
}

#[onequery_source_connect_cli::async_trait(?Send)]
impl<B, T> SourceConnectHost for OneQuerySourceConnectHost<'_, B, T> {
    type ApiFailure = ApiFailure;
    type Error = CliError;
    type Output = CommandOutput;

    fn binary_name(&self) -> &'static str {
        "onequery"
    }

    async fn ensure_authenticated_org(&mut self) -> Result<String, Self::Error> {
        ensure_authenticated_org(self.context, self.runtime)
            .await
            .map(|org| org.to_string())
    }

    async fn load_source_connect_guide(
        &mut self,
        org: &str,
        source: SourceConnectProvider,
    ) -> Result<
        SourceConnectApiSuccess<SourceConnectGuide>,
        SourceConnectHostFailure<Self::ApiFailure, Self::Error>,
    > {
        let client = super::auth_session::authenticated_api_client(self.context, self.runtime)
            .map_err(SourceConnectHostFailure::Error)?;
        source_connect::load_source_connect_guide(&client, org, source)
            .await
            .map(|response| SourceConnectApiSuccess {
                payload: response.payload,
                request_id: response.request_id,
            })
            .map_err(SourceConnectHostFailure::Api)
    }

    async fn connect_source(
        &mut self,
        org: &str,
        source: &SourceConnectProvider,
        input: Map<String, Value>,
    ) -> Result<
        SourceConnectApiSuccess<SourceConnectResult>,
        SourceConnectHostFailure<Self::ApiFailure, Self::Error>,
    > {
        let client = super::auth_session::authenticated_api_client(self.context, self.runtime)
            .map_err(SourceConnectHostFailure::Error)?;
        source_connect::connect_source(&client, org, source, input)
            .await
            .map(|response| SourceConnectApiSuccess {
                payload: response.payload,
                request_id: response.request_id,
            })
            .map_err(SourceConnectHostFailure::Api)
    }

    fn classify_failure(&self, failure: &Self::ApiFailure) -> SourceConnectFailureOutcome {
        if classify_retry_directive(failure) == RetryDirective::NeedsReauth {
            SourceConnectFailureOutcome::NeedsReauth
        } else {
            SourceConnectFailureOutcome::Failed
        }
    }

    fn invalid_input_error(&self, error: SourceConnectInputError) -> Self::Error {
        CliError::new(
            "invalid source connect input",
            self.context.command_line.clone(),
            ErrorStage::ReadQueryInput,
            error.why,
            source_connect_input_examples(self.binary_name()),
        )
    }

    fn present_guide_failure(&self, failure: Self::ApiFailure) -> Self::Error {
        present_api_failure_with_context(
            failure,
            self.context,
            ApiErrorPresentation {
                command: &self.context.command_line,
                title: "source connect failed",
                transport_why_prefix: "failed to reach source connect guide endpoint",
                decode_why_prefix: "failed to decode source connect guide response",
                fallback_try_next: retry_try_next(&self.context.command_line),
                unauthorized_try_next: Some(auth_login_try_next()),
            },
        )
    }

    fn present_connect_failure(
        &self,
        source: &SourceConnectProvider,
        failure: Self::ApiFailure,
    ) -> Self::Error {
        present_api_failure_with_context(
            failure,
            self.context,
            ApiErrorPresentation {
                command: &self.context.command_line,
                title: "source connect failed",
                transport_why_prefix: "failed to reach source connect endpoint",
                decode_why_prefix: "failed to decode source connect response",
                fallback_try_next: command_then_retry_try_next(
                    format!("onequery source connect --source {source}"),
                    &self.context.command_line,
                ),
                unauthorized_try_next: Some(auth_login_try_next()),
            },
        )
    }

    fn render_output(
        &self,
        output: SourceConnectRenderedOutput,
        request_id: Option<String>,
    ) -> Result<Self::Output, Self::Error> {
        let output = match output.data {
            SourceConnectRenderedData::Guide(guide) => {
                let data = serialize_command_data(&guide, SOURCE_CONNECT_COMMAND)?;
                CommandOutput::structured(output.lines, data)
            }
            SourceConnectRenderedData::Result(result) => {
                CommandOutput::try_deferred(output.lines, move || {
                    serialize_command_data(&result, SOURCE_CONNECT_COMMAND)
                })
            }
        };

        Ok(output.with_request_id(request_id))
    }

    fn unexpected_transition_error(&self, state: &'static str, event: &'static str) -> Self::Error {
        CliError::internal(
            self.context.command_line.clone(),
            format!("unexpected source connect workflow transition: state={state}, event={event}"),
        )
    }

    fn record_workflow_reduce(&self, step: usize, state_before: &'static str, event: &'static str) {
        if self.context.verbose {
            tracing::info!(
                workflow = "source_connect",
                step,
                state_before,
                event,
                "workflow reduce",
            );
        }
    }

    fn record_workflow_transition(
        &self,
        step: usize,
        state_after: Option<&'static str>,
        terminal_state: Option<&'static str>,
    ) {
        if self.context.verbose {
            tracing::info!(
                workflow = "source_connect",
                step,
                state_after = ?state_after,
                terminal_state = ?terminal_state,
                "workflow transition",
            );
        }
    }

    fn record_workflow_effect_dispatch(&self, step: usize, effect: &'static str) {
        if self.context.verbose {
            tracing::info!(
                workflow = "source_connect",
                step,
                effect,
                "workflow effect dispatch",
            );
        }
    }

    fn record_workflow_effect_emitted_event(&self, step: usize, event: &'static str) {
        if self.context.verbose {
            tracing::info!(
                workflow = "source_connect",
                step,
                event,
                "workflow effect emitted event",
            );
        }
    }
}

#[cfg(test)]
fn render_source_connect_result_output_for_test() -> SourceConnectRenderedOutput {
    onequery_source_connect_cli::render_source_connect_result_output(SourceConnectResult {
        source: onequery_source_connect_cli::SourceConnectSourceSummary {
            source_key: "warehouse".to_owned(),
            display_name: None,
            provider: "postgres".to_owned(),
            status: "active".to_owned(),
            interfaces: vec!["query".to_owned()],
        },
        next_command: "onequery source show warehouse".to_owned(),
    })
}

#[cfg(test)]
mod tests {
    use insta::assert_snapshot;
    use pretty_assertions::assert_eq;

    use super::SOURCE_CONNECT_COMMAND;
    use super::SourceConnectRenderedData;
    use super::SourceConnectRenderedOutput;
    use super::render_source_connect_result_output_for_test;
    use crate::output::CommandOutput;
    use crate::transport::source_connect::SourceConnectGuide;
    use onequery_source_connect_cli::SourceConnectResult;
    use onequery_source_connect_cli::SourceConnectSourceSummary;
    use onequery_source_connect_cli::render_source_connect_guide_output;
    use onequery_source_connect_cli::render_source_connect_result_output;

    fn command_output_from_rendered(
        output: SourceConnectRenderedOutput,
    ) -> Result<CommandOutput, onequery_core::error::CliError> {
        match output.data {
            SourceConnectRenderedData::Guide(guide) => Ok(CommandOutput::structured(
                output.lines,
                crate::output::serialize_command_data(&guide, SOURCE_CONNECT_COMMAND)?,
            )),
            SourceConnectRenderedData::Result(result) => {
                Ok(CommandOutput::try_deferred(output.lines, move || {
                    crate::output::serialize_command_data(&result, SOURCE_CONNECT_COMMAND)
                }))
            }
        }
    }

    #[test]
    fn render_source_connect_guide_output_snapshot() {
        let guide = SourceConnectGuide {
            title: "OneQuery Source Connect Guide".to_owned(),
            description: "Create one source connection.".to_owned(),
            format: "markdown".to_owned(),
            content:
                "# OneQuery Source Connect Guide\n\n1. Gather credentials.\n2. Run the command.\n"
                    .to_owned(),
            command: "onequery source connect --source postgres --input '<json>'".to_owned(),
        };

        let output = command_output_from_rendered(render_source_connect_guide_output(guide))
            .expect("expected source connect guide output");
        assert_snapshot!(output.lines.join("\n"));
    }

    #[test]
    fn render_source_connect_result_output_snapshot() {
        let output = command_output_from_rendered(render_source_connect_result_output(
            SourceConnectResult {
                source: SourceConnectSourceSummary {
                    source_key: "warehouse".to_owned(),
                    display_name: None,
                    provider: "postgres".to_owned(),
                    status: "active".to_owned(),
                    interfaces: vec!["query".to_owned()],
                },
                next_command: "onequery source show warehouse".to_owned(),
            },
        ))
        .expect("expected source connect result output");

        assert_snapshot!(output.lines.join("\n"));
    }

    #[test]
    fn rendered_result_output_keeps_expected_lines() {
        let output = render_source_connect_result_output_for_test();
        assert_eq!(
            output.lines,
            vec![
                "Source connected: warehouse".to_owned(),
                "Provider: postgres".to_owned(),
                "Status: active".to_owned(),
                "Interfaces: query".to_owned(),
                "Next: onequery source show warehouse".to_owned(),
            ]
        );
    }
}
