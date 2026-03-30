use crate::cli::ListReadArgs;
use crate::cli::ReadArgs;
use crate::output::CommandOutput;
use crate::output::append_padded_cell;
use crate::output::pretty_json_lines;
use crate::output::render_separator_row;
use crate::output::serialize_command_data;
use crate::transport::query::QueryResult;
use crate::transport::query::QueryResultWindow;
use crate::transport::query::QueryValidationResult;
use crate::transport::read_controls::PageInfo;
use onequery_cli_core::error::CliError;

pub(super) fn render_query_output(
    result: QueryResult,
    read: &ListReadArgs,
) -> Result<CommandOutput, CliError> {
    let output_metadata = result.output_metadata.clone();

    if read.has_field_selection() {
        let data = serialize_command_data(&result, "oneq query")?;
        return Ok(CommandOutput::structured(pretty_json_lines(&data), data)
            .with_untrusted_output_metadata(output_metadata));
    }

    let source = result
        .source
        .as_ref()
        .and_then(|source| source.name.as_deref())
        .unwrap_or("-");
    let provider = result
        .source
        .as_ref()
        .and_then(|source| source.provider_kind.as_deref())
        .unwrap_or("-");
    let row_count = result
        .row_count
        .unwrap_or_else(|| result.rows.as_ref().map_or(0, Vec::len));
    let elapsed_ms = result.elapsed_ms.unwrap_or(0);

    let mut lines = vec![
        format!("Source: {source} ({provider})"),
        format!("Rows: {row_count}"),
        format!("Time: {elapsed_ms} ms"),
    ];

    lines.push(String::new());
    lines.extend(render_table(&result));

    if result.truncated.unwrap_or(false) {
        lines.push(String::new());
        lines.push("Note: results were truncated by server limits.".to_owned());
    }

    append_page_lines(
        &mut lines,
        &result.page,
        read.pagination.page_all
            || read.pagination.page_size.is_some()
            || read.pagination.cursor().is_some(),
    );

    Ok(
        CommandOutput::try_deferred(lines, move || serialize_command_data(&result, "oneq query"))
            .with_untrusted_output_metadata(output_metadata),
    )
}

pub(super) fn render_query_validation_output(
    result: QueryValidationResult,
    read: &ReadArgs,
) -> Result<CommandOutput, CliError> {
    if read.has_field_selection() {
        let data = serialize_command_data(&result, "oneq query validate")?;
        return Ok(CommandOutput::structured(pretty_json_lines(&data), data));
    }

    let source_name = result
        .source
        .as_ref()
        .and_then(|source| source.name.as_deref())
        .unwrap_or("-");
    let provider = result
        .source
        .as_ref()
        .and_then(|source| source.provider_kind.as_deref())
        .unwrap_or("-");
    let normalized_sql = result
        .normalized_sql
        .as_deref()
        .or_else(|| {
            result
                .request
                .as_ref()
                .and_then(|request| request.sql.as_deref())
        })
        .unwrap_or("-");

    let mut lines = vec![
        format!("Source: {source_name} ({provider})"),
        format!(
            "Truncated: {}",
            if result.truncated.unwrap_or(false) {
                "yes"
            } else {
                "no"
            }
        ),
        String::new(),
        "Normalized SQL:".to_owned(),
        normalized_sql.to_owned(),
    ];

    if let Some(window) = &result.declared_result_window {
        lines.push(String::new());
        lines.push("Declared result window:".to_owned());
        append_result_window_lines(&mut lines, window);
    }

    Ok(CommandOutput::try_deferred(lines, move || {
        serialize_command_data(&result, "oneq query validate")
    }))
}

fn append_result_window_lines(lines: &mut Vec<String>, window: &QueryResultWindow) {
    lines.push(format!(
        "  maxRows: {}",
        display_optional_usize(window.max_rows)
    ));
    lines.push(format!(
        "  maxBytes: {}",
        display_optional_usize(window.max_bytes)
    ));
    lines.push(format!(
        "  cellMaxChars: {}",
        display_optional_usize(window.cell_max_chars)
    ));
    lines.push(format!(
        "  timeoutMs: {}",
        display_optional_u64(window.timeout_ms)
    ));
}

fn display_optional_usize(value: Option<usize>) -> String {
    value.map_or_else(|| "-".to_owned(), |value| value.to_string())
}

fn display_optional_u64(value: Option<u64>) -> String {
    value.map_or_else(|| "-".to_owned(), |value| value.to_string())
}

fn render_table(result: &QueryResult) -> Vec<String> {
    let Some(columns) = result.columns.as_ref() else {
        return vec!["<no columns>".to_owned()];
    };
    if columns.is_empty() {
        return vec!["<no columns>".to_owned()];
    }

    let mut widths: Vec<usize> = columns
        .iter()
        .map(|column| column.name.as_deref().unwrap_or("-").len())
        .collect();
    for row in result.rows.as_deref().unwrap_or(&[]) {
        for (index, cell) in row.iter().enumerate() {
            if let Some(width) = widths.get_mut(index) {
                *width = (*width).max(cell.len());
            }
        }
    }

    let mut lines = Vec::with_capacity(result.rows.as_ref().map_or(0, Vec::len) + 2);
    let row_capacity = widths.iter().sum::<usize>() + widths.len().saturating_sub(1) * 2;
    let mut header = String::with_capacity(row_capacity);
    for (index, (column, width)) in columns.iter().zip(widths.iter()).enumerate() {
        if index > 0 {
            header.push_str("  ");
        }
        append_padded_cell(&mut header, column.name.as_deref().unwrap_or("-"), *width);
    }
    lines.push(header);

    lines.push(render_separator_row(&widths));

    for row in result.rows.as_deref().unwrap_or(&[]) {
        let mut rendered_row = String::with_capacity(row_capacity);
        for (index, width) in widths.iter().enumerate() {
            if index > 0 {
                rendered_row.push_str("  ");
            }
            let cell = row.get(index).map_or("", String::as_str);
            append_padded_cell(&mut rendered_row, cell, *width);
        }
        lines.push(rendered_row);
    }

    lines
}

fn append_page_lines(lines: &mut Vec<String>, page: &PageInfo, force_render: bool) {
    if !force_render && !page.has_more {
        return;
    }

    lines.push(String::new());
    if page.has_more {
        lines.push(format!("Page: {} returned, more available", page.returned));
        if let Some(next_cursor) = &page.next_cursor {
            lines.push(format!("Next cursor: {next_cursor}"));
        }
        return;
    }

    lines.push(format!("Page: {} returned", page.returned));
}
