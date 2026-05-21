use std::ffi::OsString;
use std::num::NonZeroU32;
use std::num::NonZeroUsize;
use std::path::PathBuf;

use clap::CommandFactory;
use insta::assert_snapshot;
use onequery_core::error::CliError;
use pretty_assertions::assert_eq;
use toml::Value as TomlValue;

use crate::explain::ExplainCode;
use crate::identifiers::test_org_slug;
use crate::identifiers::test_request_id;
use crate::identifiers::test_source_key;
use crate::output::EffectiveOutputMode;
use crate::transport::source_connect_provider::SourceConnectProvider;

use super::ApiArgs;
use super::AuthImportArgs;
use super::AuthSessionSubcommand;
use super::Command;
use super::ConfigCommand;
use super::ConfigKey;
use super::ConfigSetKey;
use super::DoctorReportArgs;
use super::DoctorReportSelectorArgs;
use super::DoctorSubcommand;
use super::ExplainArgs;
use super::GatewayCommand;
use super::ListReadArgs;
use super::PaginationArgs;
use super::ParseOutcome;
use super::QueryInputArgs;
use super::QueryResultWindowArgs;
use super::QuerySubcommand;
use super::ReadArgs;
use super::model::Cli;

fn argv(args: &[&str]) -> Vec<OsString> {
    args.iter().map(OsString::from).collect()
}

fn parse_outcome(args: &[&str]) -> ParseOutcome {
    super::parse::parse_invocation_from(&argv(args)).expect("expected parse outcome")
}

fn parse_invocation(args: &[&str]) -> super::Invocation {
    let ParseOutcome::Invocation(invocation) = parse_outcome(args) else {
        panic!("expected invocation output");
    };
    *invocation
}

fn parse_display(args: &[&str]) -> crate::output::CommandOutput {
    let ParseOutcome::Display(display) = parse_outcome(args) else {
        panic!("expected display output");
    };
    display.into_inner()
}

fn rendered_display(args: &[&str]) -> String {
    parse_display(args).lines.join("\n")
}

fn parse_error(args: &[&str]) -> CliError {
    super::parse::parse_invocation_from(&argv(args)).expect_err("expected parse error")
}

fn nz_usize(value: usize) -> NonZeroUsize {
    NonZeroUsize::new(value).unwrap_or_else(|| panic!("expected non-zero usize: {value}"))
}

fn nz_u32(value: u32) -> NonZeroU32 {
    NonZeroU32::new(value).unwrap_or_else(|| panic!("expected non-zero u32: {value}"))
}

#[test]
fn help_output_snapshot_keeps_config_commands_out_of_public_surface() {
    assert_snapshot!(rendered_display(&["onequery"]));
}

#[test]
fn clap_command_definition_passes_debug_assertions() {
    Cli::command().debug_assert();
}

#[test]
fn auth_help_output_snapshot_targets_auth_surface() {
    assert_snapshot!(rendered_display(&["onequery", "auth", "--help"]));
}

#[test]
fn query_help_output_snapshot_targets_query_surface() {
    assert_snapshot!(rendered_display(&["onequery", "query", "--help"]));
}

#[test]
fn api_help_output_snapshot_targets_api_surface() {
    assert_snapshot!(rendered_display(&["onequery", "api", "--help"]));
}

#[test]
fn gateway_help_output_snapshot_targets_gateway_surface() {
    assert_snapshot!(rendered_display(&["onequery", "gateway", "--help"]));
}

#[test]
fn doctor_help_output_snapshot_targets_diagnostics_surface() {
    assert_snapshot!(rendered_display(&["onequery", "doctor", "--help"]));
}

#[test]
fn explain_help_output_snapshot_targets_support_surface() {
    assert_snapshot!(rendered_display(&["onequery", "explain", "--help"]));
}

#[test]
fn doctor_report_help_output_snapshot_targets_issue_creation_surface() {
    assert_snapshot!(rendered_display(&[
        "onequery", "doctor", "report", "--help"
    ]));
}

#[test]
fn upgrade_help_output_snapshot_targets_upgrade_surface() {
    assert_snapshot!(rendered_display(&["onequery", "upgrade", "--help"]));
}

#[test]
fn web_help_output_snapshot_targets_dashboard_surface() {
    assert_snapshot!(rendered_display(&["onequery", "web", "--help"]));
}

#[test]
fn config_get_help_output_lists_supported_keys() {
    assert_snapshot!(rendered_display(&["onequery", "config", "get", "--help"]));
}

#[test]
fn config_help_output_lists_get_and_set_surfaces() {
    assert_snapshot!(rendered_display(&["onequery", "config", "--help"]));
}

#[test]
fn config_set_help_output_lists_writable_keys() {
    assert_snapshot!(rendered_display(&["onequery", "config", "set", "--help"]));
}

#[test]
fn source_connect_help_output_points_to_provider_discovery() {
    let output = rendered_display(&["onequery", "source", "connect", "--help"]);

    assert!(output.contains("--source <PROVIDER>"));
    assert!(output.contains("onequery source providers"));
}

#[test]
fn org_use_help_output_keeps_global_org_override_visible() {
    assert_snapshot!(rendered_display(&["onequery", "org", "use", "--help"]));
}

#[test]
fn query_execute_help_output_uses_explicit_multiline_usage() {
    assert_snapshot!(rendered_display(&["onequery", "query", "exec", "--help"]));
}

#[test]
fn query_validate_help_output_uses_explicit_multiline_usage() {
    assert_snapshot!(rendered_display(&[
        "onequery", "query", "validate", "--help"
    ]));
}

#[test]
fn parse_invocation_renders_bare_config_as_help() {
    assert!(rendered_display(&["onequery", "config"]).contains("Usage: onequery config"));
}

#[test]
fn parse_invocation_accepts_config_set_keys() {
    for (args, expected_key, expected_value, expected_command_path) in [
        (
            &[
                "onequery",
                "config",
                "set",
                "api.server_url",
                "http://127.0.0.1:5656",
            ][..],
            ConfigSetKey::ApiServerUrl,
            "http://127.0.0.1:5656",
            "config set api.server_url",
        ),
        (
            &["onequery", "config", "set", "api.request_timeout_sec", "45"][..],
            ConfigSetKey::ApiRequestTimeoutSec,
            "45",
            "config set api.request_timeout_sec",
        ),
    ] {
        let invocation = parse_invocation(args);

        assert_eq!(invocation.command.command_path(), expected_command_path);
        match invocation.command {
            Command::Config(ConfigCommand::Set { key, value }) => {
                assert_eq!((key, value), (expected_key, expected_value.to_owned()));
            }
            other => panic!("expected config set command, got {other:?}"),
        }
    }
}

#[test]
fn parse_invocation_accepts_config_get_keys() {
    for (args, expected_key) in [
        (
            &["onequery", "config", "get", "api.server_url"][..],
            ConfigKey::ApiServerUrl,
        ),
        (
            &["onequery", "config", "get", "org.active"][..],
            ConfigKey::OrgActive,
        ),
        (
            &["onequery", "config", "get", "api.request_timeout_sec"][..],
            ConfigKey::ApiRequestTimeoutSec,
        ),
    ] {
        let invocation = parse_invocation(args);

        assert_eq!(
            invocation.command.command_path(),
            format!("config get {}", expected_key.canonical_key())
        );
        match invocation.command {
            Command::Config(ConfigCommand::Get { key }) => {
                assert_eq!(key, expected_key);
            }
            other => panic!("expected config get command, got {other:?}"),
        }
    }
}

#[test]
fn parse_invocation_accepts_explain_codes() {
    let invocation = parse_invocation(&["onequery", "explain", "query_rejected"]);

    assert_eq!(invocation.command.command_path(), "explain");
    match invocation.command {
        Command::Explain(ExplainArgs { code }) => {
            assert_eq!(code, ExplainCode::QueryRejected);
        }
        other => panic!("expected explain command, got {other:?}"),
    }
}

#[test]
fn parse_invocation_accepts_backup_archive_path_without_conflicting_with_global_output_mode() {
    let invocation = parse_invocation(&[
        "onequery",
        "backup",
        "--archive-path",
        "/tmp/onequery-backup.tar.gz",
        "--json",
    ]);

    match invocation.command {
        Command::Backup(super::BackupArgs {
            include_secrets,
            archive_path,
        }) => {
            assert_eq!(include_secrets, false);
            assert_eq!(
                archive_path,
                Some(PathBuf::from("/tmp/onequery-backup.tar.gz"))
            );
            assert_eq!(
                invocation.global.requested_output_mode,
                Some(EffectiveOutputMode::Json)
            );
            assert_eq!(invocation.global.output_mode, EffectiveOutputMode::Json);
        }
        other => panic!("expected backup command, got {other:?}"),
    }
}

#[test]
fn version_output_matches_current_package_version() {
    for (args, binary_name) in [
        (&["onequery", "--version"][..], "onequery"),
        (&["onequery", "auth", "--version"][..], "onequery-auth"),
    ] {
        match parse_outcome(args) {
            // Version output is derived from release metadata, so snapshotting it creates
            // avoidable churn whenever the tag changes.
            ParseOutcome::Display(display) => {
                let display = display.into_inner();
                assert_eq!(
                    display.lines.join("\n").trim(),
                    format!("{binary_name} {}", env!("CARGO_PKG_VERSION"))
                );
            }
            ParseOutcome::Invocation(_) => {
                panic!("expected {binary_name} --version to render display output")
            }
        }
    }
}

#[test]
fn parse_invocation_accepts_hidden_debug_subcommand() {
    let invocation = parse_invocation(&["onequery", "debug", "config"]);

    assert!(matches!(
        invocation.command,
        Command::Debug(super::DebugSubcommand::Config)
    ));
}

#[test]
fn parse_invocation_accepts_doctor_report_and_global_output_overrides() {
    for (
        stdout_is_tty,
        args,
        expected_requested_output_mode,
        expected_output_mode,
        expected_command,
    ) in [
        (
            true,
            &["onequery", "doctor", "report", "--last"][..],
            None,
            EffectiveOutputMode::Text,
            DoctorReportArgs {
                selector: DoctorReportSelectorArgs {
                    last: true,
                    request_id: None,
                },
                open: false,
            },
        ),
        (
            false,
            &["onequery", "doctor", "report", "--last"][..],
            None,
            EffectiveOutputMode::Json,
            DoctorReportArgs {
                selector: DoctorReportSelectorArgs {
                    last: true,
                    request_id: None,
                },
                open: false,
            },
        ),
        (
            false,
            &["onequery", "doctor", "report", "--last", "--text"][..],
            Some(EffectiveOutputMode::Text),
            EffectiveOutputMode::Text,
            DoctorReportArgs {
                selector: DoctorReportSelectorArgs {
                    last: true,
                    request_id: None,
                },
                open: false,
            },
        ),
        (
            true,
            &["onequery", "doctor", "report", "--last", "--json"][..],
            Some(EffectiveOutputMode::Json),
            EffectiveOutputMode::Json,
            DoctorReportArgs {
                selector: DoctorReportSelectorArgs {
                    last: true,
                    request_id: None,
                },
                open: false,
            },
        ),
        (
            true,
            &["onequery", "doctor", "report", "--last", "--open"][..],
            None,
            EffectiveOutputMode::Text,
            DoctorReportArgs {
                selector: DoctorReportSelectorArgs {
                    last: true,
                    request_id: None,
                },
                open: true,
            },
        ),
        (
            false,
            &["onequery", "doctor", "report", "--last", "--open", "--json"][..],
            Some(EffectiveOutputMode::Json),
            EffectiveOutputMode::Json,
            DoctorReportArgs {
                selector: DoctorReportSelectorArgs {
                    last: true,
                    request_id: None,
                },
                open: true,
            },
        ),
        (
            true,
            &["onequery", "doctor", "report", "--request-id", "req_123"][..],
            None,
            EffectiveOutputMode::Text,
            DoctorReportArgs {
                selector: DoctorReportSelectorArgs {
                    last: false,
                    request_id: Some(test_request_id("req_123")),
                },
                open: false,
            },
        ),
    ] {
        let ParseOutcome::Invocation(invocation) =
            super::parse::parse_invocation_from_with_stdout_tty(&argv(args), stdout_is_tty)
                .expect("expected invocation output")
        else {
            panic!("expected invocation output");
        };
        let invocation = *invocation;

        assert_eq!(
            invocation.global.requested_output_mode,
            expected_requested_output_mode
        );
        assert_eq!(invocation.global.output_mode, expected_output_mode);
        assert_eq!(invocation.command.command_path(), "doctor report");
        match invocation.command {
            Command::Doctor(DoctorSubcommand::Report(actual_command)) => {
                assert_eq!(actual_command, expected_command);
            }
            other => panic!("expected doctor report command, got {other:?}"),
        }
    }
}

#[test]
fn parse_invocation_rejects_doctor_report_text_and_open_together() {
    let error = parse_error(&["onequery", "doctor", "report", "--last", "--text", "--open"]);

    assert_eq!(error.title, "invalid command");
    assert!(
        error
            .why
            .contains("the argument '--text' cannot be used with '--open'")
            || error
                .why
                .contains("the argument '--open' cannot be used with '--text'"),
        "expected clap conflict message, got {}",
        error.why
    );
}

#[test]
fn parse_invocation_rejects_doctor_report_last_and_request_id_together() {
    let error = parse_error(&[
        "onequery",
        "doctor",
        "report",
        "--last",
        "--request-id",
        "req_123",
    ]);

    assert_eq!(error.title, "invalid command");
    assert!(
        error
            .why
            .contains("the argument '--last' cannot be used with '--request-id <REQUEST_ID>'")
            || error
                .why
                .contains("the argument '--request-id <REQUEST_ID>' cannot be used with '--last'"),
        "expected clap conflict message, got {}",
        error.why
    );
}

#[test]
fn parse_invocation_accepts_gateway_foreground_and_lifecycle_subcommands() {
    for (args, expected) in [
        (&["onequery", "gateway"][..], GatewayCommand::Foreground),
        (&["onequery", "gateway", "start"][..], GatewayCommand::Start),
        (&["onequery", "gateway", "stop"][..], GatewayCommand::Stop),
        (
            &["onequery", "gateway", "restart"][..],
            GatewayCommand::Restart,
        ),
        (
            &["onequery", "gateway", "status"][..],
            GatewayCommand::Status,
        ),
        (&["onequery", "gateway", "logs"][..], GatewayCommand::Logs),
    ] {
        let invocation = parse_invocation(args);

        assert!(matches!(
            invocation.command,
            Command::Gateway(command) if command.command() == expected
        ));
    }
}

#[test]
fn parse_invocation_accepts_upgrade_command() {
    let invocation = parse_invocation(&["onequery", "upgrade"]);

    assert!(matches!(
        invocation.command,
        Command::Upgrade(args) if args.minimum_release_age.is_none()
    ));
}

#[test]
fn parse_invocation_accepts_upgrade_minimum_release_age() {
    let invocation = parse_invocation(&["onequery", "upgrade", "--minimum-release-age", "0"]);

    assert!(matches!(
        invocation.command,
        Command::Upgrade(args) if args.minimum_release_age == Some(0)
    ));
}

#[test]
fn parse_invocation_accepts_web_command() {
    let invocation = parse_invocation(&["onequery", "web"]);

    assert!(matches!(invocation.command, Command::Web));
    assert_eq!(invocation.command.command_path(), "web");
}

#[test]
fn parse_invocation_accepts_hidden_gateway_supervisor_command() {
    let invocation = parse_invocation(&[
        "onequery",
        "__gateway-supervisor",
        "--runtime-command",
        "node",
        "--runtime-entry",
        "/tmp/runtime/onequery-server.mjs",
        "--launch-config",
        "/tmp/run/launch.json",
    ]);

    let Command::GatewaySupervisor(args) = invocation.command else {
        panic!("expected hidden gateway supervisor command");
    };
    assert_eq!(args.runtime_command, OsString::from("node"));
    assert_eq!(
        args.runtime_entry,
        PathBuf::from("/tmp/runtime/onequery-server.mjs")
    );
    assert_eq!(args.launch_config, PathBuf::from("/tmp/run/launch.json"));
    assert_eq!(
        args.crash_loop_max_restarts,
        onequery_gateway::DEFAULT_GATEWAY_SUPERVISOR_CRASH_LOOP_MAX_RESTARTS
    );
    assert_eq!(
        args.crash_loop_initial_backoff_ms,
        onequery_gateway::DEFAULT_GATEWAY_SUPERVISOR_CRASH_LOOP_INITIAL_BACKOFF_MS
    );
    assert_eq!(
        args.crash_loop_max_backoff_ms,
        onequery_gateway::DEFAULT_GATEWAY_SUPERVISOR_CRASH_LOOP_MAX_BACKOFF_MS
    );
}

#[test]
fn parse_invocation_accepts_org_get_read_controls() {
    let invocation = parse_invocation(&[
        "onequery",
        "--org",
        "acme",
        "org",
        "get",
        "--fields",
        "slug,capabilities",
    ]);

    assert_eq!(
        match invocation.command {
            Command::Org(super::OrgSubcommand::Get { read }) => (invocation.global.org, read),
            other => panic!("expected org get subcommand, got {other:?}"),
        },
        (
            Some(test_org_slug("acme")),
            ReadArgs {
                fields: Some("slug,capabilities".to_owned()),
            }
        )
    );
}

#[test]
fn parse_invocation_accepts_auth_whoami_read_controls() {
    let invocation = parse_invocation(&[
        "onequery",
        "auth",
        "whoami",
        "--fields",
        "user.email,effectiveOrg",
    ]);

    assert_eq!(
        match invocation.command {
            Command::Auth(super::AuthSubcommand::Whoami { read }) => read,
            other => panic!("expected auth whoami subcommand, got {other:?}"),
        },
        ReadArgs {
            fields: Some("user.email,effectiveOrg".to_owned()),
        }
    );
}

#[test]
fn parse_invocation_accepts_request_id_and_timeout_transport_controls() {
    let invocation = parse_invocation(&[
        "onequery",
        "--request-id",
        "req_cli_123",
        "--timeout",
        "45",
        "org",
        "list",
    ]);

    assert_eq!(
        (
            invocation.global.request_id,
            invocation.global.timeout_sec,
            invocation.command.command_path(),
        ),
        (Some(test_request_id("req_cli_123")), Some(45), "org list")
    );
}

#[test]
fn parse_invocation_accepts_profile_global_option() {
    let invocation = parse_invocation(&["onequery", "--profile", "work", "auth", "whoami"]);

    assert_eq!(
        (invocation.global.profile, invocation.command.command_path()),
        (Some("work".to_owned()), "auth whoami")
    );
}

#[test]
fn parse_invocation_accepts_raw_config_overrides() {
    let invocation = parse_invocation(&[
        "onequery",
        "-c",
        "api.request_timeout_sec=30",
        "--config",
        "query.output.format=json",
        "org",
        "list",
    ]);

    assert_eq!(
        invocation.global.raw_config_overrides,
        vec![
            ("api.request_timeout_sec".to_owned(), TomlValue::Integer(30)),
            (
                "query.output.format".to_owned(),
                TomlValue::String("json".to_owned()),
            ),
        ]
    );
}

#[test]
fn parse_invocation_rejects_invalid_raw_config_overrides() {
    let error = parse_error(&[
        "onequery",
        "--config",
        "api.request_timeout_sec",
        "org",
        "list",
    ]);

    assert_eq!(
        (error.title.as_str(), error.why.as_str()),
        (
            "invalid config override",
            "invalid -c/--config override: expected KEY=VALUE",
        )
    );
}

#[test]
fn normalize_command_line_redacts_raw_config_override_values() {
    assert_eq!(
        super::normalize::normalize_command_line(&argv(&[
            "onequery",
            "--config",
            "api.access_token=secret-token",
            "--config=query.output.format=json",
            "org",
            "list",
        ])),
        "onequery --config 'api.access_token=<redacted>' '--config=query.output.format=<redacted>' org list"
            .to_owned()
    );
}

#[test]
fn parse_invocation_accepts_api_describe_surface() {
    let invocation = parse_invocation(&["onequery", "api", "--source", "sentry-prod"]);

    assert_eq!(
        match invocation.command {
            Command::Api(args) => args,
            other => panic!("expected api command, got {other:?}"),
        },
        ApiArgs {
            source: test_source_key("sentry-prod"),
            op: None,
            target: None,
            method: None,
            headers: Vec::new(),
            raw_fields: Vec::new(),
            fields: Vec::new(),
            input: None,
            paginate: false,
            slurp: false,
            max_pages: None,
            include: false,
            silent: false,
            jq: None,
            dry_run: false,
        }
    );
}

#[test]
fn parse_invocation_accepts_api_execute_flags() {
    let invocation = parse_invocation(&[
        "onequery",
        "api",
        "--source",
        "github-prod",
        "--op",
        "fetch-api",
        "-X",
        "patch",
        "-H",
        "authorization:Bearer token",
        "-H",
        "x-trace-id:abc123",
        "-f",
        "query=state:open",
        "-F",
        "params[limit]=10",
        "--input",
        "payload.json",
        "--paginate",
        "--slurp",
        "--max-pages",
        "4",
        "--include",
        "--silent",
        "--jq",
        ".items[0]",
        "--dry-run",
        "/repos/acme/widgets/pulls/1",
    ]);

    assert_eq!(
        match invocation.command {
            Command::Api(args) => args,
            other => panic!("expected api command, got {other:?}"),
        },
        ApiArgs {
            source: test_source_key("github-prod"),
            op: Some("fetch-api".to_owned()),
            target: Some("/repos/acme/widgets/pulls/1".to_owned()),
            method: Some("patch".to_owned()),
            headers: vec![
                "authorization:Bearer token".to_owned(),
                "x-trace-id:abc123".to_owned(),
            ],
            raw_fields: vec!["query=state:open".to_owned()],
            fields: vec!["params[limit]=10".to_owned()],
            input: Some("payload.json".to_owned()),
            paginate: true,
            slurp: true,
            max_pages: Some(nz_u32(4)),
            include: true,
            silent: true,
            jq: Some(".items[0]".to_owned()),
            dry_run: true,
        }
    );
}

#[test]
fn parse_invocation_accepts_auth_import_input_and_dry_run() {
    for (args, dry_run) in [
        (
            &["onequery", "auth", "import", "--input", "auth.json"][..],
            false,
        ),
        (
            &[
                "onequery",
                "auth",
                "import",
                "--input",
                "auth.json",
                "--dry-run",
            ][..],
            true,
        ),
    ] {
        let invocation = parse_invocation(args);

        assert!(matches!(
            invocation.command,
            Command::Auth(super::AuthSubcommand::Import(AuthImportArgs { input, dry_run: actual_dry_run }))
                if input == std::path::Path::new("auth.json") && actual_dry_run == dry_run
        ));
    }
}

#[test]
fn parse_invocation_accepts_auth_logout_dry_run() {
    let invocation = parse_invocation(&["onequery", "auth", "logout", "--dry-run"]);

    assert!(matches!(
        invocation.command,
        Command::Auth(super::AuthSubcommand::Logout { dry_run }) if dry_run
    ));
}

#[test]
fn parse_invocation_accepts_auth_session_refresh() {
    let invocation = parse_invocation(&["onequery", "auth", "session", "refresh"]);

    assert_eq!(invocation.command.command_path(), "auth session refresh");
    assert!(matches!(
        invocation.command,
        Command::Auth(super::AuthSubcommand::Session {
            action: AuthSessionSubcommand::Refresh,
        })
    ));
}

#[test]
fn requested_output_mode_from_args_detects_global_output_flags_anywhere() {
    for (args, expected) in [
        (&["onequery", "--json"][..], Some(EffectiveOutputMode::Json)),
        (
            &["onequery", "doctor", "report", "--json"][..],
            Some(EffectiveOutputMode::Json),
        ),
        (
            &["onequery", "doctor", "report", "--text"][..],
            Some(EffectiveOutputMode::Text),
        ),
        (&["onequery", "org", "list"][..], None),
    ] {
        assert_eq!(
            super::requested_output_mode_from_args(&argv(args)),
            expected
        );
    }
}

#[test]
fn parse_invocation_resolves_effective_output_mode_before_execution() {
    let outcome = super::parse::parse_invocation_from_with_stdout_tty(
        &argv(&["onequery", "org", "list"]),
        false,
    );

    let Ok(ParseOutcome::Invocation(invocation)) = outcome else {
        panic!("expected invocation to parse");
    };

    assert_eq!(invocation.global.output_mode, EffectiveOutputMode::Json);
}

#[test]
fn parse_invocation_accepts_list_read_controls() {
    let invocation = parse_invocation(&[
        "onequery",
        "source",
        "list",
        "--fields",
        "sources.name,sources.status",
        "--page-size",
        "25",
        "--cursor",
        "cursor_123",
        "--page-all",
    ]);

    match invocation.command {
        Command::Source(super::SourceSubcommand::List { read }) => {
            assert_eq!(
                read,
                ListReadArgs {
                    read: ReadArgs {
                        fields: Some("sources.name,sources.status".to_owned()),
                    },
                    pagination: PaginationArgs {
                        page_size: Some(nz_usize(25)),
                        cursor: Some("cursor_123".to_owned()),
                        page_all: true,
                    },
                }
            );
        }
        other => panic!("expected source list subcommand, got {other:?}"),
    }
}

#[test]
fn parse_invocation_accepts_source_providers() {
    let invocation = parse_invocation(&["onequery", "source", "providers"]);

    assert!(matches!(
        invocation.command,
        Command::Source(super::SourceSubcommand::Providers)
    ));
}

#[test]
fn parse_invocation_accepts_source_connect_input() {
    let invocation = parse_invocation(&[
        "onequery",
        "source",
        "connect",
        "--source",
        "postgres",
        "--input",
        "{\"name\":\"warehouse\"}",
    ]);

    assert!(matches!(
        invocation.command,
        Command::Source(super::SourceSubcommand::Connect(super::SourceConnectArgs {
            source,
            input: Some(input),
        })) if source == SourceConnectProvider::new_for_test("postgres")
            && input == "{\"name\":\"warehouse\"}"
    ));
}

#[test]
fn parse_invocation_accepts_source_test_key() {
    let invocation = parse_invocation(&["onequery", "source", "test", "warehouse"]);

    assert!(matches!(
        invocation.command,
        Command::Source(super::SourceSubcommand::Test { source_key })
            if source_key == test_source_key("warehouse")
    ));
}

#[test]
fn parse_invocation_accepts_query_result_window_args() {
    let invocation = parse_invocation(&[
        "onequery",
        "query",
        "exec",
        "--source",
        "warehouse",
        "--sql",
        "select 1",
        "--fields",
        "rows",
        "--page-size",
        "10",
        "--max-rows",
        "500",
        "--max-bytes",
        "4096",
        "--cell-max-chars",
        "256",
    ]);

    match invocation.command {
        Command::Query(QuerySubcommand::Execute(args)) => {
            assert_eq!(
                args,
                super::QueryExecuteArgs {
                    source: test_source_key("warehouse"),
                    read: ListReadArgs {
                        read: ReadArgs {
                            fields: Some("rows".to_owned()),
                        },
                        pagination: PaginationArgs {
                            page_size: Some(nz_usize(10)),
                            cursor: None,
                            page_all: false,
                        },
                    },
                    input: QueryInputArgs {
                        input: None,
                        sql: Some("select 1".to_owned()),
                        file: None,
                        stdin: false,
                        result_window: QueryResultWindowArgs {
                            max_rows: Some(nz_usize(500)),
                            max_bytes: Some(nz_usize(4096)),
                            cell_max_chars: Some(nz_usize(256)),
                            timeout_ms: None,
                        },
                    },
                }
            );
        }
        other => panic!("expected query exec subcommand, got {other:?}"),
    }
}

#[test]
fn parse_invocation_rejects_zero_numeric_flags_at_parse_boundary() {
    for (args, flag) in [
        (
            &["onequery", "--timeout", "0", "org", "list"][..],
            "--timeout",
        ),
        (
            &["onequery", "source", "list", "--page-size", "0"][..],
            "--page-size",
        ),
        (
            &[
                "onequery",
                "query",
                "exec",
                "--source",
                "warehouse",
                "--sql",
                "select 1",
                "--max-rows",
                "0",
            ][..],
            "--max-rows",
        ),
        (
            &[
                "onequery",
                "api",
                "--source",
                "github-prod",
                "--paginate",
                "--max-pages",
                "0",
            ][..],
            "--max-pages",
        ),
    ] {
        let error = parse_error(args);

        assert_eq!(error.title, "invalid command");
        assert!(error.why.contains(flag));
        assert!(error.why.contains("positive integer"));
    }
}

#[test]
fn parse_invocation_accepts_explicit_query_validate_subcommand() {
    let invocation = parse_invocation(&[
        "onequery",
        "query",
        "validate",
        "--source",
        "warehouse",
        "--input",
        "query.json",
        "--fields",
        "request,source",
    ]);

    assert!(matches!(
        invocation.command,
        Command::Query(QuerySubcommand::Validate(super::QueryValidateArgs {
            source,
            read: ReadArgs {
                fields: Some(fields),
            },
            input: QueryInputArgs {
                input: Some(ref input),
                sql: None,
                file: None,
                stdin: false,
                result_window: QueryResultWindowArgs {
                    max_rows: None,
                    max_bytes: None,
                    cell_max_chars: None,
                    timeout_ms: None,
                },
            },
        })) if source == test_source_key("warehouse")
            && fields == "request,source"
            && input == &PathBuf::from("query.json")
    ));
}

#[test]
fn parse_invocation_renders_bare_commands_as_help() {
    for (args, usage) in [
        (
            &["onequery", "auth"][..],
            "Usage: onequery auth [OPTIONS] <COMMAND>",
        ),
        (
            &["onequery", "query"][..],
            "Usage: onequery query [OPTIONS] <COMMAND>",
        ),
        (
            &["onequery", "explain"][..],
            "Usage: onequery explain [OPTIONS] <CODE>",
        ),
        (
            &["onequery", "doctor", "report"][..],
            "Usage: onequery doctor report [OPTIONS]",
        ),
    ] {
        assert!(rendered_display(args).contains(usage));
    }
}

#[test]
fn parse_invocation_preserves_query_disambiguation_cases() {
    #[derive(Copy, Clone)]
    enum Case {
        OrgUseArgument,
        SourceFlagValue,
    }

    for (args, case) in [
        (
            &["onequery", "org", "use", "query"][..],
            Case::OrgUseArgument,
        ),
        (
            &[
                "onequery", "query", "exec", "--source", "query", "--sql", "select 1",
            ][..],
            Case::SourceFlagValue,
        ),
    ] {
        let invocation = parse_invocation(args);

        match case {
            Case::OrgUseArgument => assert!(matches!(
                invocation.command,
                Command::Org(super::OrgSubcommand::Use { org_slug, dry_run })
                    if org_slug == test_org_slug("query") && !dry_run
            )),
            Case::SourceFlagValue => assert!(matches!(
                invocation.command,
                Command::Query(QuerySubcommand::Execute(super::QueryExecuteArgs {
                    source,
                    ..
                })) if source == test_source_key("query")
            )),
        }
    }
}

#[test]
fn parse_invocation_rejects_raw_query_input_with_result_window_controls() {
    let error = parse_error(&[
        "onequery",
        "query",
        "exec",
        "--source",
        "warehouse",
        "--input",
        "query.json",
        "--max-rows",
        "10",
    ]);

    assert_eq!(error.title, "invalid command".to_owned());
    assert!(error.why.contains("--input"));
    assert!(error.why.contains("--max-rows"));
}
