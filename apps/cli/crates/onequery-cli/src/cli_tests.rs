use std::ffi::OsString;
use std::path::PathBuf;

use insta::assert_snapshot;
use onequery_cli_core::error::CliError;
use pretty_assertions::assert_eq;
use toml::Value as TomlValue;

use crate::config::default_base_url;
use crate::output::EffectiveOutputMode;
use crate::output::RequestedOutputMode;
use crate::transport::source_connect_provider::SourceConnectProvider;

use super::AuthImportArgs;
use super::AuthSessionSubcommand;
use super::Command;
use super::ConfigCommand;
use super::GatewayCommand;
use super::ListReadArgs;
use super::PaginationArgs;
use super::ParseOutcome;
use super::QueryInputArgs;
use super::QueryResultWindowArgs;
use super::QuerySubcommand;
use super::ReadArgs;
use super::UseArgs;

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
    display
}

fn rendered_display(args: &[&str]) -> String {
    parse_display(args).lines.join("\n")
}

fn parse_error(args: &[&str]) -> CliError {
    super::parse::parse_invocation_from(&argv(args)).expect_err("expected parse error")
}

#[test]
fn help_output_snapshot_keeps_config_commands_out_of_public_surface() {
    assert_snapshot!(rendered_display(&["onequery"]));
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
fn use_help_output_snapshot_targets_use_surface() {
    assert_snapshot!(rendered_display(&["onequery", "use", "--help"]));
}

#[test]
fn gateway_help_output_snapshot_targets_gateway_surface() {
    assert_snapshot!(rendered_display(&["onequery", "gateway", "--help"]));
}

#[test]
fn upgrade_help_output_snapshot_targets_upgrade_surface() {
    assert_snapshot!(rendered_display(&["onequery", "upgrade", "--help"]));
}

#[test]
fn source_connect_help_output_lists_supported_providers() {
    assert_snapshot!(rendered_display(&[
        "onequery", "source", "connect", "--help"
    ]));
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
fn parse_invocation_accepts_config_set_server() {
    let default_base_url = default_base_url();
    let invocation = parse_invocation(&[
        "onequery",
        "config",
        "set",
        "server",
        default_base_url.as_str(),
    ]);

    match invocation.command {
        Command::Config(ConfigCommand::SetServer { url }) => {
            assert_eq!(url, default_base_url);
        }
        other => panic!("expected config set server command, got {other:?}"),
    }
}

#[test]
fn parse_invocation_accepts_backup_archive_path_without_conflicting_with_global_output_mode() {
    let invocation = parse_invocation(&[
        "onequery",
        "backup",
        "--archive-path",
        "/tmp/onequery-backup.tar.gz",
        "--output",
        "json",
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
fn parse_invocation_accepts_gateway_foreground_start_and_status_subcommands() {
    for (args, expected) in [
        (&["onequery", "gateway"][..], GatewayCommand::Foreground),
        (&["onequery", "gateway", "start"][..], GatewayCommand::Start),
        (
            &["onequery", "gateway", "status"][..],
            GatewayCommand::Status,
        ),
    ] {
        let invocation = parse_invocation(args);

        assert!(matches!(
            invocation.command,
            Command::Gateway(command) if command == expected
        ));
    }
}

#[test]
fn parse_invocation_accepts_upgrade_command() {
    let invocation = parse_invocation(&["onequery", "upgrade"]);

    assert!(matches!(invocation.command, Command::Upgrade));
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
            Some("acme".to_owned()),
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
        (Some("req_cli_123".to_owned()), Some(45), "org list")
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
        "onequery --config api.access_token=<redacted> --config=query.output.format=<redacted> org list"
            .to_owned()
    );
}

#[test]
fn parse_invocation_accepts_use_describe_surface() {
    let invocation = parse_invocation(&["onequery", "use", "--source", "sentry-prod"]);

    assert_eq!(
        match invocation.command {
            Command::Use(args) => args,
            other => panic!("expected use command, got {other:?}"),
        },
        UseArgs {
            source: "sentry-prod".to_owned(),
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
fn parse_invocation_accepts_use_execute_flags() {
    let invocation = parse_invocation(&[
        "onequery",
        "use",
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
            Command::Use(args) => args,
            other => panic!("expected use command, got {other:?}"),
        },
        UseArgs {
            source: "github-prod".to_owned(),
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
            max_pages: Some(4),
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
fn requested_output_from_args_reads_long_flag_syntax() {
    for (args, expected) in [
        (
            &["onequery", "--output", "json"][..],
            Some(RequestedOutputMode::Json),
        ),
        (
            &["onequery", "--output=text"][..],
            Some(RequestedOutputMode::Text),
        ),
    ] {
        assert_eq!(super::requested_output_from_args(&argv(args)), expected);
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

    assert!(matches!(
        invocation.command,
        Command::Source(super::SourceSubcommand::List { read: ListReadArgs {
            read: ReadArgs {
                fields: Some(fields),
            },
            pagination: PaginationArgs {
                page_size: Some(25),
                cursor: Some(cursor),
                page_all: true,
            },
        } }) if fields == "sources.name,sources.status" && cursor == "cursor_123"
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
        })) if source == SourceConnectProvider::Postgres
            && input == "{\"name\":\"warehouse\"}"
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

    assert!(matches!(
        invocation.command,
        Command::Query(QuerySubcommand::Execute(super::QueryExecuteArgs {
            source,
            read: ListReadArgs {
                read: ReadArgs {
                    fields: Some(fields),
                },
                pagination: PaginationArgs {
                    page_size: Some(10),
                    cursor: None,
                    page_all: false,
                },
            },
            input: QueryInputArgs {
                input: None,
                sql: Some(sql),
                file: None,
                stdin: false,
                result_window: QueryResultWindowArgs {
                    max_rows: Some(500),
                    max_bytes: Some(4096),
                    cell_max_chars: Some(256),
                    timeout_ms: None,
                },
            },
        })) if source == "warehouse"
            && fields == "rows"
            && sql == "select 1"
    ));
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
        })) if source == "warehouse"
            && fields == "request,source"
            && input == &PathBuf::from("query.json")
    ));
}

#[test]
fn parse_invocation_renders_bare_auth_and_query_as_help() {
    for (args, usage) in [
        (
            &["onequery", "auth"][..],
            "Usage: onequery auth [OPTIONS] <COMMAND>",
        ),
        (
            &["onequery", "query"][..],
            "Usage: onequery query [OPTIONS] <COMMAND>",
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
                    if org_slug == "query" && !dry_run
            )),
            Case::SourceFlagValue => assert!(matches!(
                invocation.command,
                Command::Query(QuerySubcommand::Execute(super::QueryExecuteArgs {
                    source,
                    ..
                })) if source == "query"
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
