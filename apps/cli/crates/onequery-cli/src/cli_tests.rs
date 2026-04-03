use std::ffi::OsString;
use std::path::PathBuf;

use insta::assert_snapshot;
use onequery_cli_core::error::CliError;
use pretty_assertions::assert_eq;
use toml::Value as TomlValue;

use crate::config::default_base_url;
use crate::output::EffectiveOutputMode;
use crate::output::RequestedOutputMode;

use super::AuthImportArgs;
use super::AuthSessionSubcommand;
use super::Command;
use super::ConfigCommand;
use super::ListReadArgs;
use super::PaginationArgs;
use super::ParseOutcome;
use super::QueryInputArgs;
use super::QueryResultWindowArgs;
use super::QuerySubcommand;
use super::ReadArgs;
use super::ServeCommand;
use super::UseSource;

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
fn serve_help_output_snapshot_targets_serve_surface() {
    assert_snapshot!(rendered_display(&["onequery", "serve", "--help"]));
}

#[test]
fn org_use_help_output_keeps_global_org_override_visible() {
    assert_snapshot!(rendered_display(&["onequery", "org", "use", "--help"]));
}

#[test]
fn query_execute_help_output_uses_explicit_multiline_usage() {
    assert_snapshot!(rendered_display(&[
        "onequery", "query", "execute", "--help"
    ]));
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
    match parse_outcome(&["onequery", "--version"]) {
        // Version output is derived from release metadata, so snapshotting it creates
        // avoidable churn whenever the tag changes.
        ParseOutcome::Display(display) => {
            assert_eq!(
                display.lines.join("\n").trim(),
                format!("onequery {}", env!("CARGO_PKG_VERSION"))
            );
        }
        ParseOutcome::Invocation(_) => panic!("expected --version to render display output"),
    }
}

#[test]
fn subcommand_version_output_matches_current_package_version() {
    match parse_outcome(&["onequery", "auth", "--version"]) {
        ParseOutcome::Display(display) => {
            assert_eq!(
                display.lines.join("\n").trim(),
                format!("onequery-auth {}", env!("CARGO_PKG_VERSION"))
            );
        }
        ParseOutcome::Invocation(_) => panic!("expected auth --version to render display output"),
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
fn parse_invocation_accepts_serve_without_subcommand() {
    let invocation = parse_invocation(&["onequery", "serve"]);

    assert!(matches!(
        invocation.command,
        Command::Serve(ServeCommand::Root)
    ));
}

#[test]
fn parse_invocation_accepts_serve_status_subcommand() {
    let invocation = parse_invocation(&["onequery", "serve", "status"]);

    assert!(matches!(
        invocation.command,
        Command::Serve(ServeCommand::Status)
    ));
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
fn parse_invocation_accepts_use_source_flag() {
    let invocation = parse_invocation(&["onequery", "use", "--source", "sentry"]);

    assert!(matches!(
        invocation.command,
        Command::Use(super::UseArgs {
            source: UseSource::Sentry,
            input: None,
        })
    ));
}

#[test]
fn parse_invocation_accepts_use_input_json() {
    let invocation = parse_invocation(&[
        "onequery",
        "use",
        "--source",
        "github",
        "--input",
        "{\"method\":\"fetch_api\",\"request\":{\"endpoint\":\"/user\"}}",
    ]);

    assert!(matches!(
        invocation.command,
        Command::Use(super::UseArgs {
            source: UseSource::Github,
            input: Some(input),
        }) if input == "{\"method\":\"fetch_api\",\"request\":{\"endpoint\":\"/user\"}}"
    ));
}

#[test]
fn parse_invocation_accepts_auth_import_raw_input() {
    let invocation = parse_invocation(&["onequery", "auth", "import", "--input", "auth.json"]);

    assert!(matches!(
        invocation.command,
        Command::Auth(super::AuthSubcommand::Import(AuthImportArgs { input, dry_run }))
            if input == std::path::Path::new("auth.json") && !dry_run
    ));
}

#[test]
fn parse_invocation_accepts_auth_import_dry_run() {
    let invocation = parse_invocation(&[
        "onequery",
        "auth",
        "import",
        "--input",
        "auth.json",
        "--dry-run",
    ]);

    assert!(matches!(
        invocation.command,
        Command::Auth(super::AuthSubcommand::Import(AuthImportArgs { input, dry_run }))
            if input == std::path::Path::new("auth.json") && dry_run
    ));
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
fn parse_invocation_accepts_schema_command_path_tokens() {
    let invocation = parse_invocation(&["onequery", "schema", "command", "query", "execute"]);

    assert!(matches!(
        invocation.command,
        Command::Schema(super::SchemaSubcommand::Command(
            super::SchemaCommandArgs { path }
        )) if path == vec!["query".to_owned(), "execute".to_owned()]
    ));
}

#[test]
fn requested_output_from_args_reads_space_separated_long_flag() {
    assert_eq!(
        super::requested_output_from_args(&argv(&["onequery", "--output", "json"])),
        Some(RequestedOutputMode::Json)
    );
}

#[test]
fn requested_output_from_args_reads_equals_delimited_long_flag() {
    assert_eq!(
        super::requested_output_from_args(&argv(&["onequery", "--output=text"])),
        Some(RequestedOutputMode::Text)
    );
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
        })) if source == "postgres" && input == "{\"name\":\"warehouse\"}"
    ));
}

#[test]
fn parse_invocation_accepts_query_result_window_args() {
    let invocation = parse_invocation(&[
        "onequery",
        "query",
        "execute",
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
fn parse_invocation_renders_bare_auth_as_help() {
    assert!(
        rendered_display(&["onequery", "auth"])
            .contains("Usage: onequery auth [OPTIONS] <COMMAND>")
    );
}

#[test]
fn parse_invocation_renders_bare_query_as_help() {
    assert!(
        rendered_display(&["onequery", "query"])
            .contains("Usage: onequery query [OPTIONS] <COMMAND>")
    );
}

#[test]
fn parse_invocation_preserves_query_as_org_use_argument() {
    let invocation = parse_invocation(&["onequery", "org", "use", "query"]);

    assert!(matches!(
        invocation.command,
        Command::Org(super::OrgSubcommand::Use { org_slug, dry_run })
            if org_slug == "query" && !dry_run
    ));
}

#[test]
fn parse_invocation_accepts_org_use_dry_run() {
    let invocation = parse_invocation(&["onequery", "org", "use", "acme", "--dry-run"]);

    assert!(matches!(
        invocation.command,
        Command::Org(super::OrgSubcommand::Use { org_slug, dry_run })
            if org_slug == "acme" && dry_run
    ));
}

#[test]
fn parse_invocation_preserves_query_as_schema_command_path_segment() {
    let invocation = parse_invocation(&["onequery", "schema", "command", "query"]);

    assert!(matches!(
        invocation.command,
        Command::Schema(super::SchemaSubcommand::Command(super::SchemaCommandArgs {
            path
        })) if path == vec!["query".to_owned()]
    ));
}

#[test]
fn parse_invocation_preserves_query_as_source_flag_value() {
    let invocation = parse_invocation(&[
        "onequery", "query", "execute", "--source", "query", "--sql", "select 1",
    ]);

    assert!(matches!(
        invocation.command,
        Command::Query(QuerySubcommand::Execute(super::QueryExecuteArgs {
            source,
            ..
        })) if source == "query"
    ));
}

#[test]
fn parse_invocation_rejects_raw_query_input_with_result_window_controls() {
    let error = parse_error(&[
        "onequery",
        "query",
        "execute",
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
