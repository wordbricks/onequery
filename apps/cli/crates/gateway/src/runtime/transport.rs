use std::ffi::OsStr;
use std::ffi::OsString;
use std::path::Path;
use std::process::Command as ProcessCommand;
use std::process::Stdio;

use onequery_cli_core::error::CliError;
use onequery_cli_core::error::ErrorStage;

use super::super::PACKAGED_SERVER_JS_RUNTIME_ENV_VAR;
use super::super::REINSTALL_CLI_PACKAGE_COMMAND;
use super::status::describe_exit_status;

const MINIMUM_NODE_MAJOR_VERSION: u32 = 22;

pub(super) fn resolve_runtime_command() -> OsString {
    std::env::var_os(PACKAGED_SERVER_JS_RUNTIME_ENV_VAR)
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| OsString::from("node"))
}

pub(super) fn ensure_runtime_command_support(
    runtime_command: &OsStr,
    runtime_entry_path: &Path,
    command_line: &str,
    retry_command: &str,
) -> Result<(), CliError> {
    let version_output = ProcessCommand::new(runtime_command)
        .arg("--version")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .map_err(|probe_error| {
            let (why, try_next) = match probe_error.kind() {
                std::io::ErrorKind::NotFound => (
                    format!(
                        "JavaScript runtime executable was not found at {} while launching {}",
                        Path::new(runtime_command).display(),
                        runtime_entry_path.display()
                    ),
                    vec![
                        install_node_and_retry_command(retry_command),
                        REINSTALL_CLI_PACKAGE_COMMAND.to_owned(),
                    ],
                ),
                _ => (
                    format!(
                        "failed to run {} --version: {probe_error}",
                        Path::new(runtime_command).display()
                    ),
                    vec![install_node_and_retry_command(retry_command)],
                ),
            };

            CliError::new(
                "failed to validate self-host server runtime",
                command_line,
                ErrorStage::Internal,
                why,
                try_next,
            )
        })?;

    if !version_output.status.success() {
        let stderr = String::from_utf8_lossy(&version_output.stderr);
        let detail = stderr.trim();

        return Err(CliError::new(
            "failed to validate self-host server runtime",
            command_line,
            ErrorStage::Internal,
            if detail.is_empty() {
                format!(
                    "{} --version exited with {}",
                    Path::new(runtime_command).display(),
                    describe_exit_status(version_output.status)
                )
            } else {
                format!(
                    "{} --version failed: {detail}",
                    Path::new(runtime_command).display()
                )
            },
            vec![install_node_and_retry_command(retry_command)],
        ));
    }

    validate_runtime_version_output(
        &String::from_utf8_lossy(&version_output.stdout),
        runtime_command,
        command_line,
        retry_command,
    )
}

fn validate_runtime_version_output(
    version_output: &str,
    runtime_command: &OsStr,
    command_line: &str,
    retry_command: &str,
) -> Result<(), CliError> {
    let Some(major_version) = parse_runtime_major_version(version_output) else {
        return Err(CliError::new(
            "failed to validate self-host server runtime",
            command_line,
            ErrorStage::Internal,
            format!(
                "unable to parse {} --version output: {}",
                Path::new(runtime_command).display(),
                version_output.trim()
            ),
            vec![install_node_and_retry_command(retry_command)],
        ));
    };

    if major_version < MINIMUM_NODE_MAJOR_VERSION {
        return Err(CliError::new(
            "unsupported self-host server runtime",
            command_line,
            ErrorStage::Internal,
            format!(
                "{} reports major version {major_version}, but packaged onequery gateway requires Node.js {MINIMUM_NODE_MAJOR_VERSION}+",
                Path::new(runtime_command).display()
            ),
            vec![install_node_and_retry_command(retry_command)],
        ));
    }

    Ok(())
}

fn parse_runtime_major_version(version_output: &str) -> Option<u32> {
    let trimmed = version_output.trim();
    let trimmed = trimmed.strip_prefix('v').unwrap_or(trimmed);
    let major = trimmed.split('.').next()?;

    if major.is_empty() {
        return None;
    }

    major.parse::<u32>().ok()
}

pub(super) fn retry_command_hint(retry_command: &str) -> String {
    format!("retry {retry_command}")
}

fn install_node_and_retry_command(retry_command: &str) -> String {
    format!("install Node.js 22+ and retry {retry_command}")
}

pub(super) fn spawn_launch_error(
    spawn_error: &std::io::Error,
    runtime_command: &OsStr,
    runtime_entry_path: &Path,
    command_line: &str,
    retry_command: &str,
) -> CliError {
    let (why, try_next) = match spawn_error.kind() {
        std::io::ErrorKind::NotFound => (
            format!(
                "JavaScript runtime executable was not found at {} while launching {}",
                Path::new(runtime_command).display(),
                runtime_entry_path.display()
            ),
            vec![
                install_node_and_retry_command(retry_command),
                REINSTALL_CLI_PACKAGE_COMMAND.to_owned(),
            ],
        ),
        _ => (
            spawn_error.to_string(),
            vec![retry_command_hint(retry_command)],
        ),
    };

    CliError::new(
        "failed to launch self-host server",
        command_line,
        ErrorStage::Internal,
        why,
        try_next,
    )
}

#[cfg(test)]
mod tests {
    use std::ffi::OsString;

    use pretty_assertions::assert_eq;

    use super::parse_runtime_major_version;
    use super::validate_runtime_version_output;

    #[test]
    fn parse_runtime_major_version_accepts_node_style_version_output() {
        assert_eq!(parse_runtime_major_version("v22.13.1\n"), Some(22));
        assert_eq!(parse_runtime_major_version("22.13.1\n"), Some(22));
    }

    #[test]
    fn parse_runtime_major_version_rejects_invalid_version_output() {
        assert_eq!(parse_runtime_major_version(""), None);
        assert_eq!(parse_runtime_major_version("lts"), None);
    }

    #[test]
    fn validate_runtime_version_output_rejects_node_20() {
        let error = validate_runtime_version_output(
            "v20.19.0\n",
            &OsString::from("node"),
            "onequery gateway",
            "onequery gateway",
        )
        .expect_err("expected Node 20 to be rejected");

        assert_eq!(error.title.as_str(), "unsupported self-host server runtime");
        assert_eq!(
            error.why.as_str(),
            "node reports major version 20, but packaged onequery gateway requires Node.js 22+"
        );
        assert_eq!(
            error.try_next,
            vec!["install Node.js 22+ and retry onequery gateway".to_owned()]
        );
    }

    #[test]
    fn validate_runtime_version_output_accepts_node_22() {
        validate_runtime_version_output(
            "v22.13.1\n",
            &OsString::from("node"),
            "onequery gateway",
            "onequery gateway",
        )
        .unwrap_or_else(|error| panic!("expected Node 22 to be accepted: {error}"));
    }
}
