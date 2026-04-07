//! Error types and helpers shared by the OneQuery CLI crates.

use std::ops::Deref;

use thiserror::Error;

/// Classifies the stage of the CLI lifecycle that produced a failure.
#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub enum ErrorStage {
    /// Command-line parsing and validation failed before execution started.
    ParseCommand,
    /// Reading or validating local configuration failed.
    LoadConfig,
    /// Reading or validating stored credentials failed.
    LoadCredentials,
    /// Authentication or session management failed.
    Auth,
    /// Resolving the effective organization failed.
    ResolveOrg,
    /// Resolving a source before execution failed.
    ResolveSource,
    /// Reading SQL or other query input failed.
    ReadQueryInput,
    /// Executing a query against the CLI API failed.
    ExecuteQuery,
    /// A generic HTTP transport failure occurred.
    Http,
    /// Rendering CLI output failed.
    Render,
    /// An internal invariant or unexpected transition failed.
    Internal,
}

impl ErrorStage {
    /// Returns the stable wire-format identifier used by CLI problem responses.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::ParseCommand => "parse_command",
            Self::LoadConfig => "load_config",
            Self::LoadCredentials => "load_credentials",
            Self::Auth => "auth",
            Self::ResolveOrg => "resolve_org",
            Self::ResolveSource => "resolve_source",
            Self::ReadQueryInput => "read_query_input",
            Self::ExecuteQuery => "execute_query",
            Self::Http => "http",
            Self::Render => "render",
            Self::Internal => "internal",
        }
    }

    /// Maps a server-provided stage string to a local [`ErrorStage`].
    ///
    /// Unknown stage identifiers fall back to the caller-provided default.
    ///
    /// # Examples
    ///
    /// ```
    /// use onequery_cli_core::error::ErrorStage;
    ///
    /// let stage = ErrorStage::from_api_stage("load_config", ErrorStage::Internal);
    /// let unknown = ErrorStage::from_api_stage("mystery_stage", ErrorStage::Render);
    ///
    /// assert_eq!(stage, ErrorStage::LoadConfig);
    /// assert_eq!(stage.as_str(), "load_config");
    /// assert_eq!(unknown, ErrorStage::Render);
    /// ```
    pub fn from_api_stage(raw_stage: &str, fallback: Self) -> Self {
        match raw_stage {
            "parse_command" => Self::ParseCommand,
            "load_config" => Self::LoadConfig,
            "load_credentials" => Self::LoadCredentials,
            "auth" => Self::Auth,
            "resolve_org" => Self::ResolveOrg,
            "resolve_source" => Self::ResolveSource,
            "read_query_input" => Self::ReadQueryInput,
            "execute_query" => Self::ExecuteQuery,
            "http" => Self::Http,
            "render" => Self::Render,
            "internal" => Self::Internal,
            _ => fallback,
        }
    }
}

/// Top-level CLI error wrapper.
///
/// The boxed inner payload keeps the public error type small to clone and move while preserving a
/// structured error model for renderers and exit-code handling.
#[derive(Debug, Clone, Error)]
#[error(transparent)]
pub struct CliError(#[from] Box<CliErrorData>);

/// Structured CLI error data used for rendering, retries, and exit-code selection.
#[derive(Debug, Clone, Error)]
#[error("{title}")]
pub struct CliErrorData {
    /// Short user-facing summary line.
    pub title: String,
    /// Command line that triggered the failure.
    pub command: String,
    /// Stable command path used by the structured CLI envelope when known.
    pub command_path: Option<String>,
    /// Lifecycle stage that failed.
    pub stage: ErrorStage,
    /// Detailed explanation of the failure.
    pub why: String,
    /// Follow-up actions the user can try next.
    pub try_next: Vec<String>,
    /// Request identifier returned by the server when available.
    pub request_id: Option<String>,
    /// Optional hint returned by the server or synthesized by the CLI.
    pub hint: Option<String>,
    /// Stable machine-readable error code when available.
    pub code: Option<String>,
    /// HTTP status returned by the API when the failure originated from the API.
    pub status: Option<u16>,
    /// Whether retrying the same operation may succeed.
    pub retryable: bool,
    /// Server-provided retry delay when available.
    pub retry_after_ms: Option<u64>,
    /// Structured validation issues returned by the server when available.
    pub validation_issues: Vec<CliValidationIssue>,
}

/// Structured validation issue returned by the CLI API.
#[derive(Debug, Clone, Eq, PartialEq)]
pub struct CliValidationIssue {
    /// Request field that failed validation.
    pub field: String,
    /// Human-readable validation message.
    pub message: String,
    /// Stable machine-readable validation code.
    pub code: String,
}

impl CliError {
    /// Builds a new structured CLI error.
    pub fn new(
        title: impl Into<String>,
        command: impl Into<String>,
        stage: ErrorStage,
        why: impl Into<String>,
        try_next: Vec<String>,
    ) -> Self {
        Self(Box::new(CliErrorData {
            title: title.into(),
            command: command.into(),
            command_path: None,
            stage,
            why: why.into(),
            try_next,
            request_id: None,
            hint: None,
            code: None,
            status: None,
            retryable: false,
            retry_after_ms: None,
            validation_issues: Vec::new(),
        }))
    }

    /// Attaches a stable command path to the error envelope when known.
    pub fn with_command_path(mut self, command_path: Option<String>) -> Self {
        self.0.command_path = command_path.filter(|value| !value.trim().is_empty());
        self
    }

    /// Attaches a non-empty request identifier to the error.
    pub fn with_request_id(mut self, request_id: Option<String>) -> Self {
        self.0.request_id = request_id.filter(|id| !id.trim().is_empty());
        self
    }

    /// Attaches a non-empty hint to the error.
    pub fn with_hint(mut self, hint: Option<String>) -> Self {
        self.0.hint = hint.filter(|value| !value.trim().is_empty());
        self
    }

    /// Attaches the stable machine-readable error code when available.
    pub fn with_code(mut self, code: Option<String>) -> Self {
        self.0.code = code.filter(|value| !value.trim().is_empty());
        self
    }

    /// Attaches the HTTP status when the failure originated from an API problem response.
    pub fn with_status(mut self, status: Option<u16>) -> Self {
        self.0.status = status;
        self
    }

    /// Attaches whether retrying the same operation may succeed.
    pub fn with_retryable(mut self, retryable: bool) -> Self {
        self.0.retryable = retryable;
        self
    }

    /// Attaches a server-provided retry delay when available.
    pub fn with_retry_after_ms(mut self, retry_after_ms: Option<u64>) -> Self {
        self.0.retry_after_ms = retry_after_ms;
        self
    }

    /// Attaches structured validation issues to the error.
    pub fn with_validation_issues(mut self, validation_issues: Vec<CliValidationIssue>) -> Self {
        self.0.validation_issues = validation_issues;
        self
    }

    /// Returns the process exit code associated with the error stage.
    pub fn exit_code(&self) -> i32 {
        match self.stage {
            ErrorStage::ParseCommand => 2,
            ErrorStage::Auth => 3,
            ErrorStage::ResolveOrg => 4,
            ErrorStage::ResolveSource => 5,
            ErrorStage::ReadQueryInput | ErrorStage::ExecuteQuery => 6,
            ErrorStage::Http => 7,
            ErrorStage::LoadConfig | ErrorStage::LoadCredentials => 8,
            ErrorStage::Render | ErrorStage::Internal => 10,
        }
    }

    /// Builds an internal-error variant with the standard recovery hint.
    pub fn internal(command: impl Into<String>, why: impl Into<String>) -> Self {
        Self::new(
            "internal error",
            command,
            ErrorStage::Internal,
            why,
            vec!["onequery help".to_owned()],
        )
    }
}

impl Deref for CliError {
    type Target = CliErrorData;

    /// Returns the structured inner error payload.
    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

#[cfg(test)]
mod tests {
    use pretty_assertions::assert_eq;

    use super::CliError;
    use super::ErrorStage;

    #[test]
    fn from_api_stage_falls_back_for_unknown_values() {
        assert_eq!(
            ErrorStage::from_api_stage("mystery_stage", ErrorStage::Render),
            ErrorStage::Render
        );
    }

    #[test]
    fn exit_code_matches_documented_stage_groups() {
        let exit_codes = [
            (ErrorStage::ParseCommand, 2),
            (ErrorStage::Auth, 3),
            (ErrorStage::ResolveOrg, 4),
            (ErrorStage::ResolveSource, 5),
            (ErrorStage::ReadQueryInput, 6),
            (ErrorStage::ExecuteQuery, 6),
            (ErrorStage::Http, 7),
            (ErrorStage::LoadConfig, 8),
            (ErrorStage::LoadCredentials, 8),
            (ErrorStage::Render, 10),
            (ErrorStage::Internal, 10),
        ]
        .into_iter()
        .map(|(stage, expected_exit_code)| {
            let error = CliError::new("title", "onequery test", stage, "why", vec![]);
            (stage, error.exit_code(), expected_exit_code)
        })
        .collect::<Vec<_>>();

        assert_eq!(
            exit_codes,
            vec![
                (ErrorStage::ParseCommand, 2, 2),
                (ErrorStage::Auth, 3, 3),
                (ErrorStage::ResolveOrg, 4, 4),
                (ErrorStage::ResolveSource, 5, 5),
                (ErrorStage::ReadQueryInput, 6, 6),
                (ErrorStage::ExecuteQuery, 6, 6),
                (ErrorStage::Http, 7, 7),
                (ErrorStage::LoadConfig, 8, 8),
                (ErrorStage::LoadCredentials, 8, 8),
                (ErrorStage::Render, 10, 10),
                (ErrorStage::Internal, 10, 10),
            ]
        );
    }
}
