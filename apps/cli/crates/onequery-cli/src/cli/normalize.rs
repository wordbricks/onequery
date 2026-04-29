use std::ffi::OsStr;
use std::ffi::OsString;

use crate::output::EffectiveOutputMode;

pub(super) fn normalize_command_line(args: &[OsString]) -> String {
    let mut normalized = vec!["onequery".to_owned()];
    if args.is_empty() {
        return "onequery".to_owned();
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

    shlex::try_join(normalized.iter().map(String::as_str)).unwrap_or_else(|_| normalized.join(" "))
}

fn abbreviate_sql_arg(raw: &str) -> String {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return "<empty>".to_owned();
    }

    let (excerpt, truncated) = excerpt(trimmed, 48);
    if truncated {
        format!("<excerpt: {excerpt}...>")
    } else {
        format!("<excerpt: {excerpt}>")
    }
}

fn abbreviate_input_arg(raw: &str) -> String {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return "<empty>".to_owned();
    }

    if !(trimmed.starts_with('{') || trimmed.starts_with('[')) && trimmed.len() <= 64 {
        return trimmed.to_owned();
    }

    let (excerpt, truncated) = excerpt(trimmed, 48);
    if truncated {
        format!("{excerpt}…")
    } else {
        excerpt
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

pub(crate) fn requested_output_mode_from_args(args: &[OsString]) -> Option<EffectiveOutputMode> {
    args.iter()
        .skip(1)
        .take_while(|arg| arg.as_os_str() != OsStr::new("--"))
        .fold(None, |requested_output_mode, arg| {
            if arg.as_os_str() == OsStr::new("--json") {
                Some(EffectiveOutputMode::Json)
            } else if arg.as_os_str() == OsStr::new("--text") {
                Some(EffectiveOutputMode::Text)
            } else {
                requested_output_mode
            }
        })
}

pub(crate) fn requested_verbose_from_args(args: &[OsString]) -> bool {
    args.iter()
        .skip(1)
        .take_while(|arg| arg.as_os_str() != OsStr::new("--"))
        .any(|arg| arg.as_os_str() == OsStr::new("--verbose"))
}

#[cfg(test)]
mod tests {
    use std::ffi::OsString;

    use pretty_assertions::assert_eq;

    use crate::output::EffectiveOutputMode;

    use super::normalize_command_line;
    use super::requested_output_mode_from_args;
    use super::requested_verbose_from_args;

    fn argv(args: &[&str]) -> Vec<OsString> {
        args.iter().map(OsString::from).collect()
    }

    #[test]
    fn requested_verbose_from_args_detects_the_global_flag() {
        assert_eq!(
            requested_verbose_from_args(&argv(&["onequery", "--verbose", "query", "exec"])),
            true
        );
    }

    #[test]
    fn normalize_command_line_shell_quotes_abbreviated_sql() {
        assert_eq!(
            normalize_command_line(&argv(&[
                "onequery",
                "query",
                "exec",
                "--source",
                "warehouse",
                "--sql",
                "select 1",
            ])),
            "onequery query exec --source warehouse --sql '<excerpt: select 1>'"
        );
    }

    #[test]
    fn normalize_command_line_shell_quotes_input_paths() {
        assert_eq!(
            normalize_command_line(&argv(&[
                "onequery",
                "auth",
                "import",
                "--input",
                "reports/auth session.json",
            ])),
            "onequery auth import --input 'reports/auth session.json'"
        );
    }

    #[test]
    fn requested_output_mode_from_args_detects_the_global_flag() {
        assert_eq!(
            requested_output_mode_from_args(&argv(&["onequery", "--json", "doctor"])),
            Some(EffectiveOutputMode::Json)
        );
        assert_eq!(
            requested_output_mode_from_args(&argv(&["onequery", "doctor", "--text"])),
            Some(EffectiveOutputMode::Text)
        );
        assert_eq!(
            requested_output_mode_from_args(&argv(&["onequery", "--json", "--", "--text",])),
            Some(EffectiveOutputMode::Json)
        );
    }
}
