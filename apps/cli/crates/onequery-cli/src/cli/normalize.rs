use std::ffi::OsString;

use crate::output::RequestedOutputMode;

pub(super) fn normalize_command_line(args: &[OsString]) -> String {
    let mut normalized = vec!["onequery".to_owned()];
    if args.is_empty() {
        return normalized.join(" ");
    }

    let mut index = 1;
    while index < args.len() {
        let token = args[index].to_string_lossy().into_owned();
        if token == "--sql" {
            normalized.push(token);
            if let Some(next_value) = args.get(index + 1) {
                normalized.push(abbreviate_sql_arg(next_value.to_string_lossy().as_ref()));
                index += 2;
                continue;
            }
            index += 1;
            continue;
        }
        if token == "--input" {
            normalized.push(token);
            if let Some(next_value) = args.get(index + 1) {
                normalized.push(abbreviate_input_arg(next_value.to_string_lossy().as_ref()));
                index += 2;
                continue;
            }
            index += 1;
            continue;
        }
        if token == "-c" || token == "--config" {
            normalized.push(token);
            if let Some(next_value) = args.get(index + 1) {
                normalized.push(abbreviate_config_override_arg(
                    next_value.to_string_lossy().as_ref(),
                ));
                index += 2;
                continue;
            }
            index += 1;
            continue;
        }
        if let Some(raw_sql) = token.strip_prefix("--sql=") {
            normalized.push(format!("--sql={}", abbreviate_sql_arg(raw_sql)));
            index += 1;
            continue;
        }
        if let Some(raw_input) = token.strip_prefix("--input=") {
            normalized.push(format!("--input={}", abbreviate_input_arg(raw_input)));
            index += 1;
            continue;
        }
        if let Some(raw_override) = token.strip_prefix("--config=") {
            normalized.push(format!(
                "--config={}",
                abbreviate_config_override_arg(raw_override)
            ));
            index += 1;
            continue;
        }

        normalized.push(token);
        index += 1;
    }

    normalized.join(" ")
}

fn abbreviate_sql_arg(raw: &str) -> String {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return "\"<empty>\"".to_owned();
    }

    let (excerpt, truncated) = excerpt(trimmed, 48);
    if truncated {
        format!("\"<excerpt: {excerpt}...>\"")
    } else {
        format!("\"<excerpt: {excerpt}>\"")
    }
}

fn abbreviate_input_arg(raw: &str) -> String {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return "\"<empty>\"".to_owned();
    }

    if !(trimmed.starts_with('{') || trimmed.starts_with('[')) && trimmed.len() <= 64 {
        return trimmed.to_owned();
    }

    let (excerpt, truncated) = excerpt(trimmed, 48);
    if truncated {
        format!("\"{excerpt}…\"")
    } else {
        format!("\"{excerpt}\"")
    }
}

fn abbreviate_config_override_arg(raw: &str) -> String {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return "<invalid>".to_owned();
    }

    let Some((raw_key, _)) = trimmed.split_once('=') else {
        return "<invalid>".to_owned();
    };
    let key = raw_key.trim();
    if key.is_empty() {
        return "<invalid>".to_owned();
    }

    format!("{key}=<redacted>")
}

fn excerpt(raw: &str, limit: usize) -> (String, bool) {
    let mut characters = raw.chars();
    let excerpt = characters.by_ref().take(limit).collect();
    (excerpt, characters.next().is_some())
}

pub(crate) fn requested_output_from_args(args: &[OsString]) -> Option<RequestedOutputMode> {
    let mut index = 1;
    while index < args.len() {
        let token = args[index].to_string_lossy();
        if token == "--output" {
            let value = args.get(index + 1)?;
            return parse_requested_output_token(value.to_string_lossy().as_ref());
        }
        if let Some(value) = token.strip_prefix("--output=") {
            return parse_requested_output_token(value);
        }
        index += 1;
    }

    None
}

fn parse_requested_output_token(raw: &str) -> Option<RequestedOutputMode> {
    match raw.trim() {
        "text" => Some(RequestedOutputMode::Text),
        "json" => Some(RequestedOutputMode::Json),
        _ => None,
    }
}
