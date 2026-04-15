use onequery_cli_core::error::CliError;

use crate::commands::CommandContext;
use crate::local_target::managed_gateway_recovery_try_next;

const AUTH_IMPORT_COMMAND: &str = "onequery auth import --input <path|->";
const AUTH_LOGIN_COMMAND: &str = "onequery auth login";
const AUTH_LOGOUT_COMMAND: &str = "onequery auth logout";
const ORG_LIST_COMMAND: &str = "onequery org list";
const ORG_USE_COMMAND: &str = "onequery org use <org>";

#[derive(Debug, Default)]
struct TryNextPlan {
    steps: Vec<String>,
}

impl TryNextPlan {
    fn push(&mut self, step: impl Into<String>) {
        let step = step.into();
        if !self.steps.contains(&step) {
            self.steps.push(step);
        }
    }

    fn extend(&mut self, steps: impl IntoIterator<Item = String>) {
        for step in steps {
            self.push(step);
        }
    }

    fn into_steps(self) -> Vec<String> {
        self.steps
    }
}

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
enum AuthRecovery {
    Login,
    MissingSession,
    ResetSession,
}

fn auth_recovery_try_next(
    context: &CommandContext,
    recovery: AuthRecovery,
) -> Result<Vec<String>, CliError> {
    if recovery == AuthRecovery::MissingSession {
        return Ok(build_missing_auth_try_next(
            managed_gateway_recovery_try_next(context)?,
        ));
    }

    Ok(auth_recovery_steps(recovery))
}

pub(crate) fn auth_login_try_next() -> Vec<String> {
    auth_recovery_steps(AuthRecovery::Login)
}

pub(crate) fn auth_login_then_retry_try_next(retry_command: &str) -> Vec<String> {
    let mut plan = TryNextPlan::default();
    plan.extend(auth_login_try_next());
    plan.push(retry_step(retry_command));
    plan.into_steps()
}

pub(crate) fn auth_reset_try_next() -> Vec<String> {
    auth_recovery_steps(AuthRecovery::ResetSession)
}

pub(crate) fn command_then_retry_try_next(
    command: impl Into<String>,
    retry_command: &str,
) -> Vec<String> {
    let mut plan = TryNextPlan::default();
    plan.push(command);
    plan.push(retry_step(retry_command));
    plan.into_steps()
}

pub(crate) fn missing_auth_try_next(context: &CommandContext) -> Result<Vec<String>, CliError> {
    auth_recovery_try_next(context, AuthRecovery::MissingSession)
}

pub(crate) fn missing_org_try_next() -> Vec<String> {
    vec![ORG_LIST_COMMAND.to_owned(), ORG_USE_COMMAND.to_owned()]
}

pub(crate) fn retry_try_next(retry_command: &str) -> Vec<String> {
    vec![retry_step(retry_command)]
}

fn auth_recovery_steps(recovery: AuthRecovery) -> Vec<String> {
    let mut plan = TryNextPlan::default();
    match recovery {
        AuthRecovery::Login => {
            plan.push(AUTH_LOGIN_COMMAND);
        }
        AuthRecovery::MissingSession => {
            plan.push(AUTH_LOGIN_COMMAND);
            plan.push(AUTH_IMPORT_COMMAND);
        }
        AuthRecovery::ResetSession => {
            plan.push(AUTH_LOGOUT_COMMAND);
            plan.push(AUTH_LOGIN_COMMAND);
        }
    }
    plan.into_steps()
}

fn retry_step(retry_command: &str) -> String {
    format!("retry {retry_command}")
}

fn build_missing_auth_try_next(managed_gateway_layer: Option<Vec<String>>) -> Vec<String> {
    let mut plan = TryNextPlan::default();
    if let Some(managed_gateway_layer) = managed_gateway_layer {
        plan.extend(managed_gateway_layer);
    }
    plan.extend(auth_recovery_steps(AuthRecovery::MissingSession));
    plan.into_steps()
}

#[cfg(test)]
mod tests {
    use insta::assert_snapshot;
    use onequery_cli_core::error::CliError;
    use onequery_cli_core::error::ErrorStage;
    use pretty_assertions::assert_eq;

    use crate::output::EffectiveOutputMode;
    use crate::output::render_error;

    use super::auth_login_then_retry_try_next;
    use super::auth_login_try_next;
    use super::auth_reset_try_next;
    use super::build_missing_auth_try_next;
    use super::missing_org_try_next;
    use super::retry_try_next;

    #[test]
    fn rendered_missing_auth_error_includes_gateway_layer_before_auth_commands() {
        let error = CliError::new(
            "not logged in",
            "onequery query exec --source warehouse --sql \"select 1\"",
            ErrorStage::Auth,
            "no OneQuery token was found in the environment or local auth store.",
            build_missing_auth_try_next(Some(vec![
                "onequery gateway start".to_owned(),
                "onequery gateway status".to_owned(),
            ])),
        );

        assert_snapshot!(
            render_error(&error, EffectiveOutputMode::Text),
            @r#"
Error: not logged in
Command: onequery query exec --source warehouse --sql "select 1"
Stage: auth
Why: no OneQuery token was found in the environment or local auth store.
Try:
  - onequery gateway start
  - onequery gateway status
  - onequery auth login
  - onequery auth import --input <path|->
"#
        );
    }

    #[test]
    fn missing_org_try_next_matches_org_selection_surface() {
        assert_eq!(
            missing_org_try_next(),
            vec![
                "onequery org list".to_owned(),
                "onequery org use <org>".to_owned(),
            ]
        );
    }

    #[test]
    fn auth_login_try_next_matches_canonical_login_command() {
        assert_eq!(
            auth_login_try_next(),
            vec!["onequery auth login".to_owned()]
        );
    }

    #[test]
    fn auth_login_then_retry_try_next_orders_login_before_retry() {
        assert_eq!(
            auth_login_then_retry_try_next("onequery org list"),
            vec![
                "onequery auth login".to_owned(),
                "retry onequery org list".to_owned(),
            ]
        );
    }

    #[test]
    fn auth_reset_try_next_resets_before_reauthenticating() {
        assert_eq!(
            auth_reset_try_next(),
            vec![
                "onequery auth logout".to_owned(),
                "onequery auth login".to_owned(),
            ]
        );
    }

    #[test]
    fn retry_try_next_formats_retry_command() {
        assert_eq!(
            retry_try_next("onequery query exec --source warehouse --sql \"select 1\""),
            vec!["retry onequery query exec --source warehouse --sql \"select 1\"".to_owned()]
        );
    }
}
