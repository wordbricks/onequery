use serde_json::Map;
use serde_json::Value;
use serde_json::json;

use crate::cli::ReadArgs;
use crate::credentials::ImportedAuthSession;
use crate::output::CommandOutput;
use crate::output::pretty_json_lines;
use crate::transport::auth::LoginCompletion;
use crate::transport::auth::WhoAmI;
use crate::transport::org;
use onequery_cli_core::error::CliError;
use onequery_cli_core::error::ErrorStage;

use super::super::CommandContext;

pub(super) fn render_login_output(
    completion: &LoginCompletion,
    active_org: Option<String>,
    warnings: &[CliError],
) -> CommandOutput {
    render_session_stored_output(
        format!(
            "Logged in as {} <{}>",
            completion.user.display_name, completion.user.email
        ),
        completion,
        active_org,
        warnings,
    )
}

pub(super) fn render_whoami_output(
    identity: &WhoAmI,
    context: &CommandContext,
    read: &ReadArgs,
) -> Result<CommandOutput, CliError> {
    let mut lines = vec![
        format!("User: {}", identity.user.display_name),
        format!("Email: {}", identity.user.email),
        "Authenticated: yes".to_owned(),
        format!("User ID: {}", identity.user.id),
    ];

    if let Some(org_slug) = context.resolved_org.as_deref() {
        lines.push(format!("Effective Org: {org_slug}"));
        lines.push(format!(
            "Effective Org Source: {}",
            context.resolved_org_source.effective_org_label()
        ));
    } else if let Some(active_org) = &identity.active_org {
        lines.push(format!("Effective Org: {active_org}"));
        lines.push("Effective Org Source: server".to_owned());
    } else {
        lines.push("Effective Org: <none>".to_owned());
        lines.push("Effective Org Source: unresolved".to_owned());
    }

    let (effective_org, effective_org_source) = match context.resolved_org.as_deref() {
        Some(org_slug) => (
            Some(org_slug.to_owned()),
            context.resolved_org_source.effective_org_label(),
        ),
        None => (
            identity.active_org.clone(),
            if identity.active_org.is_some() {
                "server"
            } else {
                "unresolved"
            },
        ),
    };

    let data = json!({
        "authMode": identity.auth_mode,
        "user": {
            "id": identity.user.id,
            "email": identity.user.email,
            "displayName": identity.user.display_name,
        },
        "authenticated": true,
        "effectiveOrg": effective_org,
        "effectiveOrgSource": effective_org_source,
        "issuedAt": identity.issued_at,
        "expiresAt": identity.expires_at,
    });

    if read.has_field_selection() {
        let projected = project_whoami_output(&data, read)?;
        return Ok(CommandOutput::structured(
            pretty_json_lines(&projected),
            projected,
        ));
    }

    Ok(CommandOutput::structured(lines, data))
}

pub(super) fn render_import_output(imported: &ImportedAuthSession) -> CommandOutput {
    let display_name = imported.display_name.as_deref().unwrap_or(&imported.email);

    CommandOutput::structured(
        vec![
            format!(
                "Imported auth session for {display_name} <{}>",
                imported.email
            ),
            "Credentials: stored".to_owned(),
        ],
        json!({
            "user": {
                "id": imported.user_id,
                "email": imported.email,
                "displayName": imported.display_name,
            },
            "imported": true,
            "credentialsStored": true,
            "issuedAt": imported.issued_at,
            "expiresAt": imported.expires_at,
            "lastRefresh": imported.last_refresh,
        }),
    )
}

pub(super) fn render_import_dry_run_output(imported: &ImportedAuthSession) -> CommandOutput {
    let display_name = imported.display_name.as_deref().unwrap_or(&imported.email);

    CommandOutput::structured(
        vec![
            format!(
                "Auth import dry run succeeded for {display_name} <{}>",
                imported.email
            ),
            "Planned effect: persist local auth session".to_owned(),
        ],
        json!({
            "user": {
                "id": imported.user_id,
                "email": imported.email,
                "displayName": imported.display_name,
            },
            "imported": false,
            "credentialsStored": false,
            "issuedAt": imported.issued_at,
            "expiresAt": imported.expires_at,
            "lastRefresh": imported.last_refresh,
            "dryRun": true,
            // Comment: dry-run output is frequently piped into logs, so confirm that the access
            // token was validated without echoing the raw secret back to stdout.
            "validatedInput": {
                "user": {
                    "id": imported.user_id,
                    "email": imported.email,
                    "display_name": imported.display_name,
                },
                "tokens": {
                    "access_token_redacted": true,
                    "issued_at": imported.issued_at,
                    "expires_at": imported.expires_at,
                },
                "last_refresh": imported.last_refresh,
            },
            "plannedEffects": ["persist_local_auth_session"],
        }),
    )
}

pub(super) fn render_logout_dry_run_output(
    persisted_credentials_present: bool,
    active_org: Option<&str>,
) -> CommandOutput {
    let mut lines = vec!["Auth logout dry run succeeded.".to_owned()];
    lines.push(format!(
        "Would remove persisted credentials: {}",
        if persisted_credentials_present {
            "yes"
        } else {
            "no"
        }
    ));
    lines.push(format!(
        "Would clear active org: {}",
        if active_org.is_some() { "yes" } else { "no" }
    ));

    let mut planned_effects = Vec::new();
    if persisted_credentials_present {
        planned_effects.push("remove_persisted_auth_session".to_owned());
    }
    if active_org.is_some() {
        planned_effects.push("clear_active_org".to_owned());
    }

    CommandOutput::structured(
        lines,
        json!({
            "loggedOut": false,
            "credentialsRemoved": false,
            "activeOrgCleared": false,
            "persistedCredentialsPresent": persisted_credentials_present,
            "activeOrg": active_org,
            "dryRun": true,
            "plannedEffects": planned_effects,
        }),
    )
}

pub(super) fn select_single_org_slug(orgs: &[org::OrgSummary]) -> Option<String> {
    if orgs.len() == 1 {
        return orgs[0].slug.clone();
    }

    None
}

fn login_warning_from_error(error: &CliError) -> String {
    match error.stage {
        ErrorStage::Auth => {
            format!(
                "Warning: login succeeded, but org bootstrap client initialization failed: {}",
                error.why
            )
        }
        ErrorStage::LoadConfig => {
            format!(
                "Warning: login succeeded, but active org could not be persisted: {}",
                error.why
            )
        }
        _ => format!(
            "Warning: login succeeded, but org bootstrap failed: {}",
            error.why
        ),
    }
}

fn project_whoami_output(data: &Value, read: &ReadArgs) -> Result<Value, CliError> {
    let Some(fields) = read.fields() else {
        return Ok(data.clone());
    };

    let root = data.as_object().ok_or_else(|| {
        CliError::new(
            "failed to render auth whoami output",
            "onequery auth whoami",
            ErrorStage::Render,
            "auth whoami output payload was not an object",
            vec!["retry onequery auth whoami".to_owned()],
        )
    })?;
    let user = root.get("user").and_then(Value::as_object).ok_or_else(|| {
        CliError::new(
            "failed to render auth whoami output",
            "onequery auth whoami",
            ErrorStage::Render,
            "auth whoami output payload did not include a user object",
            vec!["retry onequery auth whoami".to_owned()],
        )
    })?;

    let mut projected = Map::new();
    let mut projected_user = Map::new();
    let mut includes_full_user = false;

    for field in fields
        .split(',')
        .map(str::trim)
        .filter(|field| !field.is_empty())
    {
        match field {
            "authMode" => {
                projected.insert("authMode".to_owned(), root["authMode"].clone());
            }
            "user" => {
                projected.insert("user".to_owned(), Value::Object(user.clone()));
                includes_full_user = true;
            }
            "user.id" if !includes_full_user => {
                projected_user.insert("id".to_owned(), user["id"].clone());
            }
            "user.email" if !includes_full_user => {
                projected_user.insert("email".to_owned(), user["email"].clone());
            }
            "user.displayName" if !includes_full_user => {
                projected_user.insert("displayName".to_owned(), user["displayName"].clone());
            }
            "authenticated" => {
                projected.insert("authenticated".to_owned(), root["authenticated"].clone());
            }
            "effectiveOrg" => {
                projected.insert("effectiveOrg".to_owned(), root["effectiveOrg"].clone());
            }
            "effectiveOrgSource" => {
                projected.insert(
                    "effectiveOrgSource".to_owned(),
                    root["effectiveOrgSource"].clone(),
                );
            }
            "issuedAt" => {
                projected.insert("issuedAt".to_owned(), root["issuedAt"].clone());
            }
            "expiresAt" => {
                projected.insert("expiresAt".to_owned(), root["expiresAt"].clone());
            }
            other => {
                return Err(CliError::new(
                    "invalid fields selection",
                    "onequery auth whoami",
                    ErrorStage::Auth,
                    format!("unsupported auth whoami field selection: {other}"),
                    vec![
                        "retry with one or more of: authMode, user, user.id, user.email, user.displayName, authenticated, effectiveOrg, effectiveOrgSource, issuedAt, expiresAt".to_owned(),
                    ],
                ));
            }
        }
    }

    if !includes_full_user && !projected_user.is_empty() {
        projected.insert("user".to_owned(), Value::Object(projected_user));
    }

    Ok(Value::Object(projected))
}

fn render_session_stored_output(
    headline: String,
    completion: &LoginCompletion,
    active_org: Option<String>,
    warnings: &[CliError],
) -> CommandOutput {
    let mut lines = vec![headline, "Credentials: stored".to_owned()];

    if let Some(active_org) = active_org.as_deref() {
        lines.push(format!("Active org initialized to {active_org}"));
    }

    lines.extend(warnings.iter().map(login_warning_from_error));

    CommandOutput::structured(
        lines,
        json!({
            "user": {
                "id": completion.user.id,
                "email": completion.user.email,
                "displayName": completion.user.display_name,
            },
            "credentialsStored": true,
            "activeOrg": active_org,
            "warnings": warnings.iter().map(login_warning_from_error).collect::<Vec<_>>(),
        }),
    )
}
