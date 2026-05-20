use std::path::PathBuf;

use onequery_core::error::CliError;
use onequery_core::error::ErrorStage;

pub(crate) const DEFAULT_PROFILE_NAME: &str = "default";
const PROFILE_ENV_VAR: &str = "ONEQUERY_PROFILE";
const PROFILE_NAME_MAX_LEN: usize = 64;

#[derive(Debug, Clone, Eq, PartialEq)]
pub(crate) enum ProfileSource {
    Flag,
    Environment { variable: &'static str },
    Default,
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub(crate) struct SelectedProfile {
    name: String,
    source: ProfileSource,
}

impl SelectedProfile {
    pub(crate) fn resolve(cli_profile: Option<&str>, command_line: &str) -> Result<Self, CliError> {
        let env_profile = std::env::var(PROFILE_ENV_VAR)
            .ok()
            .filter(|value| !value.trim().is_empty());
        Self::resolve_from_inputs(cli_profile, env_profile.as_deref(), command_line)
    }

    pub(crate) fn resolve_from_inputs(
        cli_profile: Option<&str>,
        env_profile: Option<&str>,
        command_line: &str,
    ) -> Result<Self, CliError> {
        if let Some(profile) = cli_profile.filter(|value| !value.trim().is_empty()) {
            return Ok(Self {
                name: normalize_profile_name(profile, command_line)?,
                source: ProfileSource::Flag,
            });
        }

        if let Some(profile) = env_profile.filter(|value| !value.trim().is_empty()) {
            return Ok(Self {
                name: normalize_profile_name(profile, command_line)?,
                source: ProfileSource::Environment {
                    variable: PROFILE_ENV_VAR,
                },
            });
        }

        Ok(Self::default())
    }

    pub(crate) fn default() -> Self {
        Self {
            name: DEFAULT_PROFILE_NAME.to_owned(),
            source: ProfileSource::Default,
        }
    }

    pub(crate) fn is_default(&self) -> bool {
        self.name == DEFAULT_PROFILE_NAME
    }

    pub(crate) fn name(&self) -> &str {
        &self.name
    }

    pub(crate) fn source(&self) -> &ProfileSource {
        &self.source
    }

    pub(crate) fn config_dir_from_base(&self, mut base: PathBuf) -> PathBuf {
        if self.is_default() {
            return base;
        }

        base.push("profiles");
        base.push(&self.name);
        base
    }
}

impl ProfileSource {
    pub(crate) fn describe(&self) -> &'static str {
        match self {
            Self::Flag => "--profile",
            Self::Environment { variable } => variable,
            Self::Default => "default",
        }
    }
}

fn normalize_profile_name(raw: &str, command_line: &str) -> Result<String, CliError> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(invalid_profile_error(
            command_line,
            "profile name must not be empty",
        ));
    }

    if trimmed.len() > PROFILE_NAME_MAX_LEN {
        return Err(invalid_profile_error(
            command_line,
            format!("profile name must be at most {PROFILE_NAME_MAX_LEN} bytes"),
        ));
    }

    if trimmed == "." || trimmed == ".." {
        return Err(invalid_profile_error(
            command_line,
            "profile name must not be . or ..",
        ));
    }

    if !trimmed
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-'))
    {
        return Err(invalid_profile_error(
            command_line,
            "profile name may only contain ASCII letters, numbers, '.', '_' and '-'",
        ));
    }

    Ok(trimmed.to_owned())
}

fn invalid_profile_error(command_line: &str, why: impl Into<String>) -> CliError {
    CliError::new(
        "invalid profile name",
        command_line,
        ErrorStage::ParseCommand,
        why,
        vec![
            "onequery --profile work auth login".to_owned(),
            "set ONEQUERY_PROFILE=work for the current shell".to_owned(),
        ],
    )
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use pretty_assertions::assert_eq;

    use super::ProfileSource;
    use super::SelectedProfile;

    #[test]
    fn resolves_default_profile_when_no_override_is_present() {
        assert_eq!(
            SelectedProfile::resolve_from_inputs(None, None, "onequery auth whoami")
                .expect("expected profile resolution"),
            SelectedProfile::default()
        );
    }

    #[test]
    fn cli_profile_takes_precedence_over_environment_profile() {
        let profile = SelectedProfile::resolve_from_inputs(
            Some("work"),
            Some("personal"),
            "onequery --profile work auth whoami",
        )
        .expect("expected profile resolution");

        assert_eq!(profile.name(), "work");
        assert_eq!(profile.source(), &ProfileSource::Flag);
    }

    #[test]
    fn environment_profile_is_used_when_cli_profile_is_missing() {
        let profile =
            SelectedProfile::resolve_from_inputs(None, Some("personal"), "onequery auth whoami")
                .expect("expected profile resolution");

        assert_eq!(profile.name(), "personal");
        assert_eq!(
            profile.source(),
            &ProfileSource::Environment {
                variable: "ONEQUERY_PROFILE",
            }
        );
    }

    #[test]
    fn rejects_path_like_profile_names() {
        let error = SelectedProfile::resolve_from_inputs(
            Some("../prod"),
            None,
            "onequery --profile ../prod",
        )
        .expect_err("expected invalid profile");

        assert_eq!(error.title, "invalid profile name");
    }

    #[test]
    fn default_profile_uses_base_config_directory() {
        assert_eq!(
            SelectedProfile::default().config_dir_from_base(PathBuf::from("/tmp/onequery")),
            PathBuf::from("/tmp/onequery")
        );
    }

    #[test]
    fn named_profile_uses_profiles_subdirectory() {
        let profile = SelectedProfile::resolve_from_inputs(Some("work"), None, "onequery")
            .expect("expected profile resolution");

        assert_eq!(
            profile.config_dir_from_base(PathBuf::from("/tmp/onequery")),
            PathBuf::from("/tmp/onequery/profiles/work")
        );
    }
}
