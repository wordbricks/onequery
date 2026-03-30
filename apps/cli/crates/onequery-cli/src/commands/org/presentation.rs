use serde_json::Value;
use serde_json::json;

use crate::cli::ListReadArgs;
use crate::cli::ReadArgs;
use crate::output::CommandOutput;
use crate::output::append_padded_cell;
use crate::output::pretty_json_lines;
use crate::output::serialize_command_data;
use crate::transport::org::OrgDetails;
use crate::transport::org::OrgListPayload;
use crate::transport::read_controls::PageInfo;
use onequery_cli_core::error::CliError;

use super::super::CommandContext;
use super::super::ResolvedOrgSource;

pub(super) fn render_org_list_output(
    payload: OrgListPayload,
    read: &ListReadArgs,
) -> Result<CommandOutput, CliError> {
    if read.has_field_selection() {
        let data = serialize_command_data(&payload, "oneq org list")?;
        return Ok(CommandOutput::structured(pretty_json_lines(&data), data));
    }

    let orgs = payload.organizations.as_slice();
    if orgs.is_empty() {
        return Ok(CommandOutput::try_deferred(
            vec!["No organizations found for this account.".to_owned()],
            move || serialize_command_data(&payload, "oneq org list"),
        ));
    }

    let slug_width = orgs
        .iter()
        .map(|org| org.slug.as_deref().unwrap_or("-").len())
        .max()
        .unwrap_or(3)
        .max("ORG".len());
    let name_width = orgs
        .iter()
        .map(|org| org.name.as_deref().unwrap_or("-").len())
        .max()
        .unwrap_or(4)
        .max("NAME".len());

    let row_capacity = slug_width + name_width + 2;
    let mut lines = Vec::with_capacity(orgs.len() + 1);
    let mut header = String::with_capacity(row_capacity);
    append_padded_cell(&mut header, "ORG", slug_width);
    header.push_str("  ");
    append_padded_cell(&mut header, "NAME", name_width);
    lines.push(header);

    for org in orgs {
        let mut row = String::with_capacity(row_capacity);
        append_padded_cell(&mut row, org.slug.as_deref().unwrap_or("-"), slug_width);
        row.push_str("  ");
        append_padded_cell(&mut row, org.name.as_deref().unwrap_or("-"), name_width);
        lines.push(row);
    }

    append_page_lines(
        &mut lines,
        &payload.page,
        read.pagination.page_all
            || read.pagination.page_size.is_some()
            || read.pagination.cursor().is_some(),
    );

    Ok(CommandOutput::try_deferred(lines, move || {
        serialize_command_data(&payload, "oneq org list")
    }))
}

pub(super) fn render_org_get_output(
    org: OrgDetails,
    read: &ReadArgs,
) -> Result<CommandOutput, CliError> {
    if read.has_field_selection() {
        let data = serialize_command_data(&org, "oneq org get")?;
        return Ok(CommandOutput::structured(pretty_json_lines(&data), data));
    }

    let roles = org.roles.as_ref().map_or_else(
        || "-".to_owned(),
        |roles| {
            if roles.is_empty() {
                "-".to_owned()
            } else {
                roles.join(", ")
            }
        },
    );
    let capabilities = org.capabilities.as_ref().map_or_else(
        || "-".to_owned(),
        |capabilities| {
            if capabilities.is_empty() {
                "-".to_owned()
            } else {
                capabilities.join(", ")
            }
        },
    );

    Ok(CommandOutput::try_deferred(
        vec![
            format!("Org: {}", org.slug.as_deref().unwrap_or("-")),
            format!("Name: {}", org.name.as_deref().unwrap_or("-")),
            format!("Roles: {roles}"),
            format!("Capabilities: {capabilities}"),
        ],
        move || serialize_command_data(&org, "oneq org get"),
    ))
}

pub(super) fn current(context: &CommandContext) -> CommandOutput {
    let mut lines = Vec::with_capacity(3);
    let (org, source, resolved) = match context.resolved_org.as_deref() {
        Some(org_slug) => {
            lines.push(format!("Org: {org_slug}"));
            let source = match context.resolved_org_source {
                ResolvedOrgSource::Flag => "--org",
                ResolvedOrgSource::Config => "config",
                ResolvedOrgSource::None => "unresolved",
            };
            lines.push(format!("Source: {source}"));
            lines.push("Resolved: yes".to_owned());
            (Some(org_slug.to_owned()), source, true)
        }
        None => {
            lines.push("Org: <none>".to_owned());
            lines.push("Source: unresolved".to_owned());
            lines.push("Resolved: no".to_owned());
            (None, "unresolved", false)
        }
    };
    CommandOutput::structured(
        lines,
        json!({
            "org": org,
            "source": source,
            "resolved": resolved,
        }),
    )
}

pub(super) fn render_use_org_unchanged_output(org_slug: &str) -> CommandOutput {
    CommandOutput::structured(
        vec![
            format!("Active org unchanged: {org_slug}"),
            "Reason: already active in config".to_owned(),
        ],
        json!({
            "activeOrg": org_slug,
            "changed": false,
            "reason": "already_active_in_config",
            "sourceOfTruth": "config",
        }),
    )
}

pub(super) fn render_use_org_updated_output(org_slug: &str) -> CommandOutput {
    CommandOutput::structured(
        vec![format!("Active org set to {org_slug}")],
        json!({
            "activeOrg": org_slug,
            "changed": true,
            "sourceOfTruth": "config",
        }),
    )
}

pub(super) fn render_use_org_dry_run_output(org_slug: &str, changed: bool) -> CommandOutput {
    let mut lines = Vec::with_capacity(2);
    if changed {
        lines.push(format!("Active org would be set to {org_slug}"));
        lines.push("Planned effect: update active org in config".to_owned());
    } else {
        lines.push(format!("Active org would remain {org_slug}"));
        lines.push("Reason: already active in config".to_owned());
    }

    let planned_effects = if changed {
        vec!["persist_active_org".to_owned()]
    } else {
        Vec::new()
    };

    CommandOutput::structured(
        lines,
        json!({
            "activeOrg": org_slug,
            "changed": changed,
            "reason": if changed { Value::Null } else { Value::String("already_active_in_config".to_owned()) },
            "sourceOfTruth": "config",
            "dryRun": true,
            "plannedEffects": planned_effects,
        }),
    )
}

fn append_page_lines(lines: &mut Vec<String>, page: &PageInfo, force_render: bool) {
    if !force_render && !page.has_more {
        return;
    }

    lines.push(String::new());
    if page.has_more {
        lines.push(format!("Page: {} returned, more available", page.returned));
        if let Some(next_cursor) = &page.next_cursor {
            lines.push(format!("Next cursor: {next_cursor}"));
        }
        return;
    }

    lines.push(format!("Page: {} returned", page.returned));
}
