use crate::cli::ListReadArgs;
use crate::cli::ReadArgs;
use crate::output::CommandOutput;
use crate::output::append_padded_cell;
use crate::output::pretty_json_lines;
use crate::output::render_separator_row;
use crate::output::serialize_command_data;
use crate::transport::query::DeclaredQueryResultWindow;
use crate::transport::query::QueryResult;
use crate::transport::query::QueryValidationResult;
use crate::transport::read_controls::PageInfo;
use onequery_cli_core::error::CliError;

pub(super) fn render_query_output(
    result: QueryResult,
    read: &ListReadArgs,
) -> Result<CommandOutput, CliError> {
    let output_metadata = result.output_metadata.clone();

    if read.has_field_selection() {
        let data = serialize_command_data(&result, "onequery query")?;
        return Ok(CommandOutput::structured(pretty_json_lines(&data), data)
            .with_sanitization_metadata(output_metadata));
    }

    let source = &result.source.source_key;
    let provider = &result.source.provider;

    let mut lines = vec![
        format!("Source: {source} ({provider})"),
        format!("Rows: {}", result.row_count),
        format!("Time: {} ms", result.elapsed_ms),
    ];

    lines.push(String::new());
    lines.extend(render_table(&result));

    if result.truncated {
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

    Ok(CommandOutput::try_deferred(lines, move || {
        serialize_command_data(&result, "onequery query")
    })
    .with_sanitization_metadata(output_metadata))
}

pub(super) fn render_query_validation_output(
    result: QueryValidationResult,
    read: &ReadArgs,
) -> Result<CommandOutput, CliError> {
    if read.has_field_selection() {
        let data = serialize_command_data(&result, "onequery query validate")?;
        return Ok(CommandOutput::structured(pretty_json_lines(&data), data));
    }

    let source_name = &result.source.source_key;
    let provider = &result.source.provider;

    let mut lines = vec![
        format!("Source: {source_name} ({provider})"),
        format!(
            "SQL normalized: {}",
            if result.sql_normalized { "yes" } else { "no" }
        ),
        String::new(),
        "Normalized SQL:".to_owned(),
        result.normalized_sql.clone(),
    ];

    lines.push(String::new());
    lines.push("Declared result window:".to_owned());
    append_result_window_lines(&mut lines, &result.declared_result_window);

    Ok(CommandOutput::try_deferred(lines, move || {
        serialize_command_data(&result, "onequery query validate")
    }))
}

fn append_result_window_lines(lines: &mut Vec<String>, window: &DeclaredQueryResultWindow) {
    lines.push(format!("  maxRows: {}", window.max_rows));
    lines.push(format!("  maxBytes: {}", window.max_bytes));
    lines.push(format!("  cellMaxChars: {}", window.cell_max_chars));
    lines.push(format!("  timeoutMs: {}", window.timeout_ms));
}

fn render_table(result: &QueryResult) -> Vec<String> {
    if result.columns.is_empty() {
        return vec!["<no columns>".to_owned()];
    }

    let columns = &result.columns;
    let mut widths: Vec<usize> = columns.iter().map(|column| column.name.len()).collect();
    for row in &result.rows {
        for (index, cell) in row.iter().enumerate() {
            if let Some(width) = widths.get_mut(index) {
                *width = (*width).max(cell.len());
            }
        }
    }

    let mut lines = Vec::with_capacity(result.rows.len() + 2);
    let row_capacity = widths.iter().sum::<usize>() + widths.len().saturating_sub(1) * 2;
    let mut header = String::with_capacity(row_capacity);
    for (index, (column, width)) in columns.iter().zip(widths.iter()).enumerate() {
        if index > 0 {
            header.push_str("  ");
        }
        append_padded_cell(&mut header, &column.name, *width);
    }
    lines.push(header);

    lines.push(render_separator_row(&widths));

    for row in &result.rows {
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
    if !force_render && !page.has_next_page() {
        return;
    }

    lines.push(String::new());
    if page.has_next_page() {
        lines.push(format!(
            "Page: {} returned, more available",
            page.returned_count
        ));
        if let Some(next_cursor) = &page.next_cursor {
            lines.push(format!("Next cursor: {next_cursor}"));
        }
        return;
    }

    lines.push(format!("Page: {} returned", page.returned_count));
}
