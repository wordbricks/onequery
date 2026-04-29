mod backends;
mod paths;

#[cfg(test)]
mod tests;

use std::path::Path;
use std::path::PathBuf;

use serde::Deserialize;
use serde::Serialize;
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;

use self::backends::load_auth_session_store;
use crate::transport::auth::LoginCompletion;
use onequery_core::error::CliError;
use onequery_core::error::ErrorStage;

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub(crate) enum AuthSessionSource {
    PersistedFile,
    Environment,
}

#[derive(Debug, Clone, Eq, PartialEq, Deserialize, Serialize)]
struct AuthSessionPrincipal {
    user_id: String,
    email: String,
}

#[derive(Debug, Clone, Eq, PartialEq, Deserialize, Serialize)]
struct PersistedAuthUser {
    id: String,
    email: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    display_name: Option<String>,
}

#[derive(Debug, Clone, Eq, PartialEq, Deserialize, Serialize)]
struct PersistedAuthTokens {
    access_token: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    issued_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    expires_at: Option<String>,
}

#[derive(Debug, Clone, Eq, PartialEq, Deserialize, Serialize)]
struct AuthDotJson {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    user: Option<PersistedAuthUser>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    tokens: Option<PersistedAuthTokens>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    last_refresh: Option<String>,
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub(crate) struct AuthSessionMetadata {
    principal: Option<AuthSessionPrincipal>,
    display_name: Option<String>,
    issued_at: Option<String>,
    expires_at: Option<String>,
    last_refresh: Option<String>,
}

impl AuthSessionMetadata {
    fn empty() -> Self {
        Self {
            principal: None,
            display_name: None,
            issued_at: None,
            expires_at: None,
            last_refresh: None,
        }
    }

    fn from_login_completion(login_completion: &LoginCompletion) -> Self {
        Self {
            principal: Some(AuthSessionPrincipal {
                user_id: login_completion.user.id.clone(),
                email: login_completion.user.email.clone(),
            }),
            display_name: Some(login_completion.user.display_name.clone()),
            issued_at: login_completion.issued_at.clone(),
            expires_at: login_completion.expires_at.clone(),
            last_refresh: current_rfc3339_timestamp(),
        }
    }

    pub(crate) fn principal_user_id(&self) -> Option<&str> {
        self.principal
            .as_ref()
            .map(|principal| principal.user_id.as_str())
    }

    pub(crate) fn principal_email(&self) -> Option<&str> {
        self.principal
            .as_ref()
            .map(|principal| principal.email.as_str())
    }

    pub(crate) fn display_name(&self) -> Option<&str> {
        self.display_name.as_deref()
    }

    pub(crate) fn issued_at(&self) -> Option<&str> {
        self.issued_at.as_deref()
    }

    pub(crate) fn expires_at(&self) -> Option<&str> {
        self.expires_at.as_deref()
    }

    pub(crate) fn last_refresh(&self) -> Option<&str> {
        self.last_refresh.as_deref()
    }
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub(crate) struct ImportedAuthSession {
    pub(crate) user_id: String,
    pub(crate) email: String,
    pub(crate) display_name: Option<String>,
    pub(crate) access_token: String,
    pub(crate) issued_at: Option<String>,
    pub(crate) expires_at: Option<String>,
    pub(crate) last_refresh: Option<String>,
}

impl ImportedAuthSession {
    pub(crate) fn from_raw_json(raw: &str, command_line: &str) -> Result<Self, CliError> {
        // Comment: `onequery auth import` accepts the checked-in `auth.json` shape on purpose so
        // headless agents can round-trip explicit credentials without a second local session format.
        let auth = serde_json::from_str::<AuthDotJson>(raw).map_err(|parse_error| {
            CliError::new(
                "invalid auth import payload",
                command_line,
                ErrorStage::LoadCredentials,
                parse_error.to_string(),
                auth_import_examples(),
            )
        })?;

        Self::from_auth_json(auth, command_line)
    }

    fn from_auth_json(auth: AuthDotJson, command_line: &str) -> Result<Self, CliError> {
        let AuthDotJson {
            user,
            tokens,
            last_refresh,
        } = auth;

        let user = user.ok_or_else(|| {
            invalid_auth_import_error(command_line, "payload must include user.id and user.email.")
        })?;
        let tokens = tokens.ok_or_else(|| {
            invalid_auth_import_error(command_line, "payload must include tokens.access_token.")
        })?;

        Ok(Self {
            user_id: require_non_empty_import_field(user.id, "user.id", command_line)?,
            email: require_non_empty_import_field(user.email, "user.email", command_line)?,
            display_name: normalize_optional_import_field(user.display_name),
            access_token: require_non_empty_import_field(
                tokens.access_token,
                "tokens.access_token",
                command_line,
            )?,
            issued_at: normalize_optional_import_field(tokens.issued_at),
            expires_at: normalize_optional_import_field(tokens.expires_at),
            last_refresh: normalize_optional_import_field(last_refresh),
        })
    }
}

#[derive(Debug, Clone, Eq, PartialEq)]
struct AuthSessionSnapshot {
    access_token: Option<String>,
    metadata: AuthSessionMetadata,
}

impl AuthSessionSnapshot {
    fn empty() -> Self {
        Self {
            access_token: None,
            metadata: AuthSessionMetadata::empty(),
        }
    }

    fn from_access_token(access_token: String) -> Self {
        Self {
            access_token: Some(access_token),
            metadata: AuthSessionMetadata::empty(),
        }
    }

    fn from_login_completion(login_completion: &LoginCompletion) -> Self {
        Self {
            access_token: Some(login_completion.access_token.clone()),
            metadata: AuthSessionMetadata::from_login_completion(login_completion),
        }
    }

    fn from_auth_json(auth: AuthDotJson) -> Self {
        let AuthDotJson {
            user,
            tokens,
            last_refresh,
        } = auth;
        let (principal, display_name) = match user {
            Some(user) => (
                Some(AuthSessionPrincipal {
                    user_id: user.id,
                    email: user.email,
                }),
                user.display_name,
            ),
            None => (None, None),
        };
        let (access_token, issued_at, expires_at) = match tokens {
            Some(tokens) => (
                Some(tokens.access_token),
                tokens.issued_at,
                tokens.expires_at,
            ),
            None => (None, None, None),
        };

        Self {
            access_token,
            metadata: AuthSessionMetadata {
                principal,
                display_name,
                issued_at,
                expires_at,
                last_refresh,
            },
        }
    }

    fn to_auth_json(&self) -> Option<AuthDotJson> {
        let access_token = self.access_token.clone()?;
        let user = self
            .metadata
            .principal
            .as_ref()
            .map(|principal| PersistedAuthUser {
                id: principal.user_id.clone(),
                email: principal.email.clone(),
                display_name: self.metadata.display_name.clone(),
            });

        Some(AuthDotJson {
            user,
            tokens: Some(PersistedAuthTokens {
                access_token,
                issued_at: self.metadata.issued_at.clone(),
                expires_at: self.metadata.expires_at.clone(),
            }),
            last_refresh: self.metadata.last_refresh.clone(),
        })
    }

    fn from_imported_auth_session(imported: &ImportedAuthSession) -> Self {
        Self {
            access_token: Some(imported.access_token.clone()),
            metadata: AuthSessionMetadata {
                principal: Some(AuthSessionPrincipal {
                    user_id: imported.user_id.clone(),
                    email: imported.email.clone(),
                }),
                display_name: imported.display_name.clone(),
                issued_at: imported.issued_at.clone(),
                expires_at: imported.expires_at.clone(),
                last_refresh: imported.last_refresh.clone(),
            },
        }
    }
}

// Comment: auth is persisted exclusively as a single `auth.json` blob to match the
// Codex CLI storage model and to keep the CLI auth lifecycle deterministic.
#[derive(Debug, Eq, PartialEq)]
pub(crate) struct AuthSessionStore {
    snapshot: AuthSessionSnapshot,
    path: PathBuf,
    source: AuthSessionSource,
}

impl AuthSessionStore {
    pub(crate) fn load(startup_command: &str) -> Result<Self, CliError> {
        load_auth_session_store(startup_command)
    }

    pub(crate) fn access_token(&self) -> Option<&str> {
        self.snapshot.access_token.as_deref()
    }

    pub(crate) fn metadata(&self) -> &AuthSessionMetadata {
        &self.snapshot.metadata
    }

    pub(crate) fn source(&self) -> AuthSessionSource {
        self.source
    }

    pub(crate) fn auth_path(&self) -> &Path {
        &self.path
    }

    pub(crate) fn record_refreshed_session(
        &mut self,
        login_completion: &LoginCompletion,
        command_line: &str,
    ) -> Result<(), CliError> {
        let next_snapshot = AuthSessionSnapshot::from_login_completion(login_completion);

        if self.source == AuthSessionSource::Environment {
            self.snapshot = next_snapshot;
            return Ok(());
        }

        backends::persist_snapshot(&self.path, &next_snapshot, command_line)?;
        self.snapshot = next_snapshot;
        Ok(())
    }

    pub(crate) fn persist_login_completion(
        &mut self,
        login_completion: &LoginCompletion,
        command_line: &str,
    ) -> Result<(), CliError> {
        let next_snapshot = AuthSessionSnapshot::from_login_completion(login_completion);
        backends::persist_snapshot(&self.path, &next_snapshot, command_line)?;
        self.snapshot = next_snapshot;
        self.source = AuthSessionSource::PersistedFile;
        Ok(())
    }

    pub(crate) fn persist_imported_session(
        &mut self,
        imported: &ImportedAuthSession,
        command_line: &str,
    ) -> Result<(), CliError> {
        let next_snapshot = AuthSessionSnapshot::from_imported_auth_session(imported);
        backends::persist_snapshot(&self.path, &next_snapshot, command_line)?;
        self.snapshot = next_snapshot;
        self.source = AuthSessionSource::PersistedFile;
        Ok(())
    }

    pub(crate) fn clear_session(&mut self, command_line: &str) -> Result<(), CliError> {
        backends::clear_session(&self.path, command_line)?;
        self.snapshot = AuthSessionSnapshot::empty();
        self.source = AuthSessionSource::PersistedFile;
        Ok(())
    }

    #[cfg(test)]
    pub(crate) fn with_file_access_token_for_test(path: PathBuf, token: Option<String>) -> Self {
        let mut snapshot = AuthSessionSnapshot::empty();
        snapshot.access_token = token;
        Self {
            snapshot,
            path,
            source: AuthSessionSource::PersistedFile,
        }
    }

    #[cfg(test)]
    pub(crate) fn with_env_access_token_for_test(path: PathBuf, token: String) -> Self {
        Self {
            snapshot: AuthSessionSnapshot::from_access_token(token),
            path,
            source: AuthSessionSource::Environment,
        }
    }
}

fn current_rfc3339_timestamp() -> Option<String> {
    OffsetDateTime::now_utc().format(&Rfc3339).ok()
}

fn invalid_auth_import_error(command_line: &str, why: impl Into<String>) -> CliError {
    CliError::new(
        "invalid auth import payload",
        command_line,
        ErrorStage::LoadCredentials,
        why,
        auth_import_examples(),
    )
}

fn require_non_empty_import_field(
    value: String,
    field: &str,
    command_line: &str,
) -> Result<String, CliError> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(invalid_auth_import_error(
            command_line,
            format!("{field} must be a non-empty string."),
        ));
    }

    Ok(trimmed.to_owned())
}

fn normalize_optional_import_field(value: Option<String>) -> Option<String> {
    value.and_then(|raw| {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_owned())
        }
    })
}

fn auth_import_examples() -> Vec<String> {
    vec![
        "cat auth.json | onequery auth import --input -".to_owned(),
        "onequery auth import --input auth.json".to_owned(),
    ]
}
