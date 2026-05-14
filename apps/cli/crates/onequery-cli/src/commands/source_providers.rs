use onequery_core::error::CliError;

use super::CommandContext;
use super::Runtime;
use super::auth_session::authenticated_api_client;
use super::auth_session::ensure_authenticated_org;
use crate::output::CommandOutput;
use crate::output::append_padded_cell;
use crate::output::serialize_command_data;
use crate::presentation::api_failure::ApiErrorPresentation;
use crate::presentation::api_failure::present_api_failure_with_context;
use crate::recovery::auth_login_then_retry_try_next;
use crate::recovery::auth_login_try_next;
use crate::transport::source;
use crate::transport::source::SourceProviderListPayload;
use crate::transport::source::SourceProviderSummary;

pub(super) async fn execute<B, T>(
    context: &CommandContext,
    runtime: &mut Runtime<B, T>,
) -> Result<CommandOutput, CliError> {
    let org = ensure_authenticated_org(context, runtime).await?;
    let client = authenticated_api_client(context, runtime)?;

    match source::list_source_providers(&client, org.as_str()).await {
        Ok(response) => {
            let output = render_source_provider_list_output(response.payload)?;
            Ok(output.with_request_id(response.request_id))
        }
        Err(failure) => Err(present_api_failure_with_context(
            failure,
            context,
            ApiErrorPresentation {
                command: &context.command_line,
                title: "source providers failed",
                transport_why_prefix: "failed to reach source provider list endpoint",
                decode_why_prefix: "failed to decode source provider list response",
                fallback_try_next: auth_login_then_retry_try_next(&context.command_line),
                unauthorized_try_next: Some(auth_login_try_next()),
            },
        )),
    }
}

fn render_source_provider_list_output(
    payload: SourceProviderListPayload,
) -> Result<CommandOutput, CliError> {
    let providers = payload.providers.as_slice();
    if providers.is_empty() {
        return Ok(CommandOutput::try_deferred(
            vec!["No source providers found.".to_owned()],
            move || serialize_command_data(&payload, "onequery source providers"),
        ));
    }

    let provider_width = column_width(providers, "PROVIDER", |provider| &provider.provider);
    let label_width = column_width(providers, "LABEL", |provider| &provider.label);
    let credential_width = column_width(providers, "CREDENTIAL", |provider| {
        &provider.credential_type
    });
    let interfaces_width = providers
        .iter()
        .map(|provider| format_provider_interfaces(&provider.interfaces).len())
        .max()
        .unwrap_or(10)
        .max("INTERFACES".len());
    let connect_width = bool_column_width("CONNECT");
    let test_width = bool_column_width("TEST");
    let row_capacity = provider_width
        + label_width
        + credential_width
        + interfaces_width
        + connect_width
        + test_width
        + 10;
    let mut lines = Vec::with_capacity(providers.len() + 1);
    let mut header = String::with_capacity(row_capacity);
    append_padded_cell(&mut header, "PROVIDER", provider_width);
    header.push_str("  ");
    append_padded_cell(&mut header, "LABEL", label_width);
    header.push_str("  ");
    append_padded_cell(&mut header, "CREDENTIAL", credential_width);
    header.push_str("  ");
    append_padded_cell(&mut header, "INTERFACES", interfaces_width);
    header.push_str("  ");
    append_padded_cell(&mut header, "CONNECT", connect_width);
    header.push_str("  ");
    append_padded_cell(&mut header, "TEST", test_width);
    lines.push(header);

    for provider in providers {
        let mut row = String::with_capacity(row_capacity);
        append_padded_cell(&mut row, &provider.provider, provider_width);
        row.push_str("  ");
        append_padded_cell(&mut row, &provider.label, label_width);
        row.push_str("  ");
        append_padded_cell(&mut row, &provider.credential_type, credential_width);
        row.push_str("  ");
        append_padded_cell(
            &mut row,
            &format_provider_interfaces(&provider.interfaces),
            interfaces_width,
        );
        row.push_str("  ");
        append_padded_cell(&mut row, bool_label(provider.connectable), connect_width);
        row.push_str("  ");
        append_padded_cell(&mut row, bool_label(provider.testable), test_width);
        lines.push(row);
    }

    Ok(CommandOutput::try_deferred(lines, move || {
        serialize_command_data(&payload, "onequery source providers")
    }))
}

fn column_width(
    providers: &[SourceProviderSummary],
    header: &str,
    value: impl Fn(&SourceProviderSummary) -> &str,
) -> usize {
    providers
        .iter()
        .map(value)
        .map(str::len)
        .max()
        .unwrap_or(header.len())
        .max(header.len())
}

fn bool_column_width(header: &str) -> usize {
    header.len().max("yes".len()).max("no".len())
}

fn bool_label(value: bool) -> &'static str {
    if value { "yes" } else { "no" }
}

fn format_provider_interfaces(interfaces: &[String]) -> String {
    if interfaces.is_empty() {
        return "-".to_owned();
    }

    interfaces.join(",")
}

#[cfg(test)]
mod tests {
    use pretty_assertions::assert_eq;

    use crate::transport::source::SourceProviderListPayload;
    use crate::transport::source::SourceProviderSummary;

    use super::render_source_provider_list_output;

    #[test]
    fn render_source_provider_list_output_includes_provider_ids() {
        let output = render_source_provider_list_output(SourceProviderListPayload {
            providers: vec![
                SourceProviderSummary {
                    provider: "postgres".to_owned(),
                    label: "PostgreSQL".to_owned(),
                    connectable: true,
                    testable: true,
                    interfaces: vec!["query".to_owned()],
                    credential_type: "postgres".to_owned(),
                },
                SourceProviderSummary {
                    provider: "github".to_owned(),
                    label: "GitHub".to_owned(),
                    connectable: true,
                    testable: false,
                    interfaces: vec!["api".to_owned()],
                    credential_type: "github".to_owned(),
                },
            ],
        })
        .expect("expected source provider list output");

        assert_eq!(
            output.lines,
            vec![
                "PROVIDER  LABEL       CREDENTIAL  INTERFACES  CONNECT  TEST".to_owned(),
                "postgres  PostgreSQL  postgres    query       yes      yes ".to_owned(),
                "github    GitHub      github      api         yes      no  ".to_owned(),
            ]
        );
    }
}
