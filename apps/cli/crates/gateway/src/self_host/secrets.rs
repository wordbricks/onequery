use std::path::Path;

use base64::Engine as _;
use getrandom::fill as fill_random_bytes;
use onequery_cli_core::error::CliError;
use onequery_cli_core::error::ErrorStage;
use serde::Deserialize;
use serde::Serialize;

pub(super) const MASTER_ENCRYPTION_KEY_BYTE_LENGTH: usize = 32;

#[derive(Debug, Clone, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct SecretsConfig {
    #[serde(default, skip_serializing_if = "SmtpSecrets::is_empty")]
    pub(crate) smtp: SmtpSecrets,
    pub(crate) auth: AuthSecrets,
    pub(crate) crypto: CryptoSecrets,
    pub(crate) connectors: ConnectorSecrets,
}

#[derive(Debug, Clone, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct AuthSecrets {
    pub(crate) secret: String,
}

#[derive(Debug, Clone, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct CryptoSecrets {
    pub(crate) master_encryption_key: String,
}

#[derive(Debug, Clone, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct ConnectorSecrets {
    pub(crate) enrollment_token: String,
}

#[derive(Debug, Clone, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(default, deny_unknown_fields)]
pub(crate) struct SmtpSecrets {
    pub(crate) password: Option<String>,
}

impl SmtpSecrets {
    fn is_empty(&self) -> bool {
        self.password.is_none()
    }
}

impl SecretsConfig {
    pub(super) fn generate(command_line: &str) -> Result<Self, CliError> {
        Ok(Self {
            smtp: SmtpSecrets::default(),
            auth: AuthSecrets {
                secret: generate_auth_secret(command_line)?,
            },
            crypto: CryptoSecrets {
                master_encryption_key: generate_master_encryption_key(command_line)?,
            },
            connectors: ConnectorSecrets {
                enrollment_token: generate_connector_enrollment_token(command_line)?,
            },
        })
    }
}

fn generate_auth_secret(command_line: &str) -> Result<String, CliError> {
    generate_base64url_secret(command_line)
}

fn generate_connector_enrollment_token(command_line: &str) -> Result<String, CliError> {
    generate_base64url_secret(command_line)
}

fn generate_master_encryption_key(command_line: &str) -> Result<String, CliError> {
    let random_bytes = generate_random_secret_bytes(command_line)?;
    Ok(base64::engine::general_purpose::STANDARD.encode(random_bytes))
}

fn generate_base64url_secret(command_line: &str) -> Result<String, CliError> {
    let random_bytes = generate_random_secret_bytes(command_line)?;
    Ok(base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(random_bytes))
}

fn generate_random_secret_bytes(
    command_line: &str,
) -> Result<[u8; MASTER_ENCRYPTION_KEY_BYTE_LENGTH], CliError> {
    let mut bytes = [0_u8; MASTER_ENCRYPTION_KEY_BYTE_LENGTH];
    fill_random_bytes(&mut bytes).map_err(|error| {
        CliError::new(
            "failed to generate self-host secrets",
            command_line,
            ErrorStage::LoadConfig,
            format!("operating system random source failed: {error}"),
            vec!["retry command".to_owned()],
        )
    })?;
    Ok(bytes)
}

fn validate_master_encryption_key(value: &str) -> Result<(), &'static str> {
    let normalized_value = value.trim();
    let decoded = base64::engine::general_purpose::STANDARD
        .decode(normalized_value)
        .map_err(|_| "must be base64 that decodes to exactly 32 bytes")?;

    if decoded.len() != MASTER_ENCRYPTION_KEY_BYTE_LENGTH {
        return Err("must be base64 that decodes to exactly 32 bytes");
    }

    Ok(())
}

fn validate_opaque_secret_transport(value: &str) -> Result<(), &'static str> {
    if value.trim().is_empty() {
        return Err("must not be empty");
    }

    Ok(())
}

fn invalid_self_host_secrets_error(
    secrets_path: &Path,
    command_line: &str,
    field_path: &str,
    message: &str,
) -> CliError {
    CliError::new(
        "invalid self-host secrets config",
        command_line,
        ErrorStage::LoadConfig,
        format!("{} -> {field_path}: {message}", secrets_path.display()),
        vec![format!("fix {}", secrets_path.display())],
    )
}

pub(super) fn validate_self_host_secrets(
    secrets: &SecretsConfig,
    secrets_path: &Path,
    command_line: &str,
) -> Result<(), CliError> {
    validate_opaque_secret_transport(&secrets.auth.secret).map_err(|message| {
        invalid_self_host_secrets_error(secrets_path, command_line, "auth.secret", message)
    })?;
    validate_opaque_secret_transport(&secrets.connectors.enrollment_token).map_err(|message| {
        invalid_self_host_secrets_error(
            secrets_path,
            command_line,
            "connectors.enrollment_token",
            message,
        )
    })?;
    validate_master_encryption_key(&secrets.crypto.master_encryption_key).map_err(|message| {
        invalid_self_host_secrets_error(
            secrets_path,
            command_line,
            "crypto.master_encryption_key",
            message,
        )
    })
}
