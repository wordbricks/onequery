use insta::assert_snapshot;
use onequery_cli_core::error::CliError;
use onequery_cli_core::error::ErrorStage;
use pretty_assertions::assert_eq;
use serde_json::json;

use crate::cli::ListReadArgs;
use crate::cli::ReadArgs;
use crate::config::default_base_url;
use crate::identifiers::test_org_slug as org_slug;
use crate::transport::org::OrgDetails;
use crate::transport::org::OrgListPayload;
use crate::transport::org::OrgSummary;
use crate::transport::read_controls::PageInfo;
use crate::workflows::retry::RetryTransition;
use crate::workflows::runner::TransitionProgress;

use super::super::CommandContext;
use super::super::ResolvedOrgSource;
use super::super::with_command_snapshot_path;
use super::presentation::current;
use super::presentation::render_org_get_output;
use super::presentation::render_org_list_output;
use super::presentation::render_use_org_dry_run_output;
use super::presentation::render_use_org_unchanged_output;
use super::presentation::render_use_org_updated_output;
use super::workflow::ORG_LIST_MAX_ATTEMPTS;
use super::workflow::ORG_LIST_RETRY_DELAY_MS;
use super::workflow::OrgEffect;
use super::workflow::OrgEvent;
use super::workflow::OrgLoadRequest;
use super::workflow::OrgState;
use super::workflow::OrgTerminalState;
use super::workflow::reduce;

#[test]
fn current_output_snapshot_from_flag() {
    let output = current(&CommandContext {
        command_line: "onequery --org acme org current".to_owned(),
        base_url: default_base_url(),
        request_id: None,
        resolved_org: Some("acme".to_owned()),
        resolved_org_source: ResolvedOrgSource::Flag,
        verbose: false,
    });

    with_command_snapshot_path(|| {
        assert_snapshot!(output.lines.join("\n"));
    });
}

#[test]
fn current_output_snapshot_unresolved() {
    let output = current(&CommandContext {
        command_line: "onequery org current".to_owned(),
        base_url: default_base_url(),
        request_id: None,
        resolved_org: None,
        resolved_org_source: ResolvedOrgSource::None,
        verbose: false,
    });

    with_command_snapshot_path(|| {
        assert_snapshot!(output.lines.join("\n"));
    });
}

#[test]
fn current_output_uses_config_source_label() {
    let output = current(&CommandContext {
        command_line: "onequery org current".to_owned(),
        base_url: default_base_url(),
        request_id: None,
        resolved_org: Some("acme".to_owned()),
        resolved_org_source: ResolvedOrgSource::Config,
        verbose: false,
    });

    assert_eq!(
        output.lines,
        vec![
            "Org: acme".to_owned(),
            "Source: config".to_owned(),
            "Resolved: yes".to_owned(),
        ]
    );
}

#[test]
fn use_org_unchanged_output_snapshot() {
    let output = render_use_org_unchanged_output("acme");

    with_command_snapshot_path(|| {
        assert_snapshot!(output.lines.join("\n"));
    });
}

#[test]
fn use_org_unchanged_output_data_marks_config_as_source_of_truth() {
    let output = render_use_org_unchanged_output("acme");

    assert_eq!(
        output.into_data(),
        json!({
            "activeOrg": "acme",
            "changed": false,
            "reason": "already_active_in_config",
            "sourceOfTruth": "config",
        })
    );
}

#[test]
fn use_org_updated_output_snapshot() {
    let output = render_use_org_updated_output("acme");

    with_command_snapshot_path(|| {
        assert_snapshot!(output.lines.join("\n"));
    });
}

#[test]
fn use_org_updated_output_data_marks_the_org_as_changed() {
    let output = render_use_org_updated_output("acme");

    assert_eq!(
        output.into_data(),
        json!({
            "activeOrg": "acme",
            "changed": true,
            "sourceOfTruth": "config",
        })
    );
}

#[test]
fn use_org_dry_run_output_snapshot() {
    let output = render_use_org_dry_run_output("acme", true);

    with_command_snapshot_path(|| {
        assert_snapshot!(output.lines.join("\n"));
    });
}

#[test]
fn org_get_output_snapshot() {
    let output = render_org_get_output(
        OrgDetails {
            slug: Some("acme".to_owned()),
            name: Some("Acme".to_owned()),
            roles: Some(vec!["member".to_owned(), "admin".to_owned()]),
            capabilities: Some(vec![
                "org.list".to_owned(),
                "org.read".to_owned(),
                "source.list".to_owned(),
                "source.read".to_owned(),
            ]),
        },
        &ReadArgs::default(),
    )
    .expect("expected org get output");

    with_command_snapshot_path(|| {
        assert_snapshot!(output.lines.join("\n"));
    });
}

#[test]
fn org_get_output_with_field_selection_renders_pretty_json() {
    let output = render_org_get_output(
        OrgDetails {
            slug: Some("acme".to_owned()),
            name: None,
            roles: None,
            capabilities: Some(vec!["org.read".to_owned()]),
        },
        &ReadArgs {
            fields: Some("slug,capabilities".to_owned()),
        },
    )
    .expect("expected org get field selection output");

    assert_eq!(
        output.lines,
        vec![
            "{".to_owned(),
            "  \"capabilities\": [".to_owned(),
            "    \"org.read\"".to_owned(),
            "  ],".to_owned(),
            "  \"slug\": \"acme\"".to_owned(),
            "}".to_owned(),
        ]
    );
}

#[test]
fn org_use_dry_run_completes_after_validation_without_persisting() {
    let context = CommandContext {
        command_line: "onequery org use globex --dry-run".to_owned(),
        base_url: default_base_url(),
        request_id: None,
        resolved_org: Some("acme".to_owned()),
        resolved_org_source: ResolvedOrgSource::Config,
        verbose: false,
    };
    let transition = reduce(
        OrgState::LoadingOrgs {
            request: OrgLoadRequest::Use {
                next_org: org_slug("globex"),
                configured_active_org: Some("acme".to_owned()),
                dry_run: true,
            },
            attempt: 1,
        },
        OrgEvent::OrgsLoaded {
            payload: OrgListPayload {
                organizations: vec![
                    OrgSummary {
                        slug: Some("acme".to_owned()),
                        name: Some("Acme".to_owned()),
                    },
                    OrgSummary {
                        slug: Some("globex".to_owned()),
                        name: Some("Globex".to_owned()),
                    },
                ],
                page: PageInfo::default(),
            },
            request_id: Some("req_123".to_owned()),
        },
        &context,
    );

    match transition.into_progress() {
        TransitionProgress::Done {
            terminal_state: OrgTerminalState::Completed { output },
        } => {
            let output = output.into_inner();
            let request_id = output.request_id.clone();
            let data = output.into_data();

            assert_eq!(
                (request_id, data),
                (
                    Some("req_123".to_owned()),
                    json!({
                        "activeOrg": "globex",
                        "changed": true,
                        "reason": null,
                        "sourceOfTruth": "config",
                        "dryRun": true,
                        "plannedEffects": ["persist_active_org"],
                    })
                )
            );
        }
        other => panic!("expected org use dry-run to complete without persistence, got {other:?}"),
    }
}

#[test]
fn retryable_org_load_failure_transitions_to_explicit_wait_state() {
    let context = CommandContext {
        command_line: "onequery org list".to_owned(),
        base_url: default_base_url(),
        request_id: None,
        resolved_org: Some("acme".to_owned()),
        resolved_org_source: ResolvedOrgSource::Config,
        verbose: false,
    };
    let transition = reduce(
        OrgState::LoadingOrgs {
            request: OrgLoadRequest::List {
                read: ListReadArgs::default(),
            },
            attempt: 1,
        },
        OrgEvent::OrgsLoadFailed {
            error: CliError::new(
                "org list failed",
                context.command_line.clone(),
                ErrorStage::Http,
                "temporary gateway timeout",
                vec!["retry onequery org list".to_owned()],
            ),
            retry: RetryTransition::RetryScheduled {
                next_attempt: 2,
                max_attempts: ORG_LIST_MAX_ATTEMPTS,
                delay_ms: ORG_LIST_RETRY_DELAY_MS,
            },
        },
        &context,
    );

    assert_eq!(
        match transition.into_progress() {
            TransitionProgress::Continue {
                next_state:
                    OrgState::WaitingToRetryOrgLoad {
                        request: OrgLoadRequest::List { read },
                        next_attempt,
                    },
                effect: OrgEffect::WaitBeforeRetryOrgLoad { delay_ms },
            } => (read, next_attempt, delay_ms),
            other => panic!("expected org load retry wait transition, got {other:?}"),
        },
        (ListReadArgs::default(), 2, ORG_LIST_RETRY_DELAY_MS)
    );
}

#[test]
fn unauthorized_org_load_failure_transitions_to_explicit_reauth_terminal_state() {
    let context = CommandContext {
        command_line: "onequery org list".to_owned(),
        base_url: default_base_url(),
        request_id: None,
        resolved_org: Some("acme".to_owned()),
        resolved_org_source: ResolvedOrgSource::Config,
        verbose: false,
    };
    let transition = reduce(
        OrgState::LoadingOrgs {
            request: OrgLoadRequest::List {
                read: ListReadArgs::default(),
            },
            attempt: 1,
        },
        OrgEvent::OrgsLoadFailed {
            error: CliError::new(
                "org list failed",
                context.command_line.clone(),
                ErrorStage::Auth,
                "stored credentials are no longer authorized",
                vec!["onequery auth login".to_owned()],
            ),
            retry: RetryTransition::NeedsReauth,
        },
        &context,
    );

    match transition.into_progress() {
        TransitionProgress::Done {
            terminal_state: OrgTerminalState::NeedsReauth { error },
        } => assert_eq!(error.stage, ErrorStage::Auth),
        other => panic!("expected needs-reauth terminal transition, got {other:?}"),
    }
}

#[test]
fn org_list_output_snapshot() {
    let output = render_org_list_output(
        OrgListPayload {
            organizations: vec![
                OrgSummary {
                    slug: Some("acme".to_owned()),
                    name: Some("Acme".to_owned()),
                },
                OrgSummary {
                    slug: Some("globex".to_owned()),
                    name: Some("Globex".to_owned()),
                },
            ],
            page: PageInfo {
                next_cursor: None,
                returned: 2,
                has_more: false,
            },
        },
        &ListReadArgs::default(),
    )
    .expect("expected org list snapshot output");

    with_command_snapshot_path(|| {
        assert_snapshot!(output.lines.join("\n"));
    });
}

#[test]
fn org_list_output_snapshot_empty_state() {
    let output = render_org_list_output(
        OrgListPayload {
            organizations: Vec::new(),
            page: PageInfo {
                next_cursor: None,
                returned: 0,
                has_more: false,
            },
        },
        &ListReadArgs::default(),
    )
    .expect("expected org list empty state snapshot output");

    with_command_snapshot_path(|| {
        assert_snapshot!(output.lines.join("\n"));
    });
}
