use onequery_cli_core::error::CliError;

use crate::cli::ApiArgs;
use crate::transport::source_api::SourceApiDescriptor;
use crate::transport::source_api::SourceApiProvider;

use super::CommandContext;
use super::args::has_execute_intent_flags;
use super::source_api_parse_error;

#[derive(Debug, Clone, Eq, PartialEq)]
pub(super) enum ResolvedIntent {
    Describe,
    Execute {
        operation: String,
        selector: Option<String>,
    },
}

pub(super) fn resolve_intent(
    args: &ApiArgs,
    descriptor: &SourceApiDescriptor,
    context: &CommandContext,
) -> Result<ResolvedIntent, CliError> {
    if !has_execute_intent_flags(args) {
        return Ok(ResolvedIntent::Describe);
    }

    if let Some(operation) = args.op.as_deref() {
        return Ok(ResolvedIntent::Execute {
            operation: operation.trim().to_owned(),
            selector: args
                .target
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToOwned::to_owned),
        });
    }

    let Some(target) = args
        .target
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return Err(source_api_parse_error(
            context,
            "source API operation is required",
            "request flags require either an operation name or a selector target",
            args.source.as_str(),
        ));
    };

    if let Some(selector) = infer_selector_target(target, descriptor) {
        let Some(operation) = descriptor.default_path_operation.as_deref() else {
            return Err(source_api_parse_error(
                context,
                "source API operation is required",
                "this source API descriptor does not define a default path operation",
                args.source.as_str(),
            ));
        };
        return Ok(ResolvedIntent::Execute {
            operation: operation.to_owned(),
            selector: Some(selector),
        });
    }

    Ok(ResolvedIntent::Execute {
        operation: target.to_owned(),
        selector: None,
    })
}

fn is_selector_target(target: &str) -> bool {
    target.starts_with('/') || target.starts_with("http://") || target.starts_with("https://")
}

fn infer_selector_target(target: &str, descriptor: &SourceApiDescriptor) -> Option<String> {
    if is_selector_target(target) {
        return Some(target.to_owned());
    }

    if descriptor
        .operations
        .iter()
        .any(|candidate| candidate.name == target)
    {
        return None;
    }

    if descriptor.source.provider.as_known() == Some(SourceApiProvider::CLI_SOURCE_PROVIDER_GITHUB)
    {
        return infer_github_repository_selector(target);
    }

    None
}

fn infer_github_repository_selector(target: &str) -> Option<String> {
    let mut parts = target.split('/').filter(|part| !part.is_empty());
    let owner = parts.next()?;
    let repo = parts.next()?;
    if owner.chars().any(char::is_whitespace) || repo.chars().any(char::is_whitespace) {
        return None;
    }

    let remainder = parts.collect::<Vec<_>>();
    let mut selector = format!("/repos/{owner}/{repo}");
    if !remainder.is_empty() {
        selector.push('/');
        selector.push_str(&remainder.join("/"));
    }
    Some(selector)
}

#[cfg(test)]
mod tests {
    use buffa::MessageField;
    use onequery_cli_core::error::ErrorStage;

    use crate::cli::ApiArgs;
    use crate::commands::ResolvedOrgSource;
    use crate::config::default_base_url;
    use crate::transport::source_api::SourceApiDescriptor;
    use crate::transport::source_api::SourceApiSource;

    use super::CommandContext;
    use super::ResolvedIntent;
    use super::resolve_intent;

    #[test]
    fn resolve_intent_describes_when_only_source_is_provided() {
        let intent = resolve_intent(&api_args(), &descriptor(), &context())
            .expect("expected bare source usage to describe");

        assert_eq!(intent, ResolvedIntent::Describe);
    }

    #[test]
    fn resolve_intent_executes_when_explicit_operation_is_provided() {
        let intent = resolve_intent(
            &ApiArgs {
                op: Some(" fetch ".to_owned()),
                ..api_args()
            },
            &descriptor(),
            &context(),
        )
        .expect("expected explicit operation to resolve execution intent");

        assert_eq!(
            intent,
            ResolvedIntent::Execute {
                operation: "fetch".to_owned(),
                selector: None,
            }
        );
    }

    #[test]
    fn resolve_intent_describes_when_only_render_flags_are_provided() {
        for args in [
            ApiArgs {
                include: true,
                ..api_args()
            },
            ApiArgs {
                silent: true,
                ..api_args()
            },
            ApiArgs {
                jq: Some(".items[0]".to_owned()),
                ..api_args()
            },
        ] {
            let intent = resolve_intent(&args, &descriptor(), &context())
                .expect("expected render-only flags to keep describe intent");

            assert_eq!(intent, ResolvedIntent::Describe);
        }
    }

    #[test]
    fn resolve_intent_rejects_execute_flags_without_operation_or_selector() {
        let error = resolve_intent(
            &ApiArgs {
                method: Some("POST".to_owned()),
                ..api_args()
            },
            &descriptor(),
            &context(),
        )
        .expect_err("expected method override without target or op to fail");

        assert_eq!(error.stage, ErrorStage::ParseCommand);
        assert_eq!(
            error.why,
            "request flags require either an operation name or a selector target"
        );
    }

    #[test]
    fn resolve_intent_treats_bare_target_as_operation() {
        let intent = resolve_intent(
            &ApiArgs {
                target: Some("search".to_owned()),
                ..api_args()
            },
            &descriptor(),
            &context(),
        )
        .expect("expected bare target to resolve as an operation");

        assert_eq!(
            intent,
            ResolvedIntent::Execute {
                operation: "search".to_owned(),
                selector: None,
            }
        );
    }

    #[test]
    fn resolve_intent_treats_path_target_as_selector() {
        let intent = resolve_intent(
            &ApiArgs {
                target: Some("/pulls".to_owned()),
                ..api_args()
            },
            &descriptor(),
            &context(),
        )
        .expect("expected path target to resolve as a selector");

        assert_eq!(
            intent,
            ResolvedIntent::Execute {
                operation: "fetch".to_owned(),
                selector: Some("/pulls".to_owned()),
            }
        );
    }

    #[test]
    fn resolve_intent_treats_github_repository_target_as_selector() {
        let intent = resolve_intent(
            &ApiArgs {
                target: Some("acme/widgets".to_owned()),
                ..api_args()
            },
            &descriptor(),
            &context(),
        )
        .expect("expected GitHub repository shorthand to resolve as a selector");

        assert_eq!(
            intent,
            ResolvedIntent::Execute {
                operation: "fetch".to_owned(),
                selector: Some("/repos/acme/widgets".to_owned()),
            }
        );
    }

    #[test]
    fn resolve_intent_treats_github_repository_subpath_target_as_selector() {
        let intent = resolve_intent(
            &ApiArgs {
                target: Some("acme/widgets/pulls".to_owned()),
                ..api_args()
            },
            &descriptor(),
            &context(),
        )
        .expect("expected GitHub repository shorthand subpath to resolve as a selector");

        assert_eq!(
            intent,
            ResolvedIntent::Execute {
                operation: "fetch".to_owned(),
                selector: Some("/repos/acme/widgets/pulls".to_owned()),
            }
        );
    }

    #[test]
    fn resolve_intent_prefers_declared_operation_over_github_shorthand() {
        let intent = resolve_intent(
            &ApiArgs {
                target: Some("acme/widgets".to_owned()),
                ..api_args()
            },
            &descriptor_with_operation("acme/widgets"),
            &context(),
        )
        .expect("expected declared operations to keep priority");

        assert_eq!(
            intent,
            ResolvedIntent::Execute {
                operation: "acme/widgets".to_owned(),
                selector: None,
            }
        );
    }

    #[test]
    fn resolve_intent_treats_url_target_as_selector() {
        let intent = resolve_intent(
            &ApiArgs {
                target: Some("https://api.github.com/repos/acme/widgets/pulls".to_owned()),
                ..api_args()
            },
            &descriptor(),
            &context(),
        )
        .expect("expected URL target to resolve as a selector");

        assert_eq!(
            intent,
            ResolvedIntent::Execute {
                operation: "fetch".to_owned(),
                selector: Some("https://api.github.com/repos/acme/widgets/pulls".to_owned()),
            }
        );
    }

    #[test]
    fn resolve_intent_rejects_selector_target_without_default_path_operation() {
        let error = resolve_intent(
            &ApiArgs {
                target: Some("/pulls".to_owned()),
                ..api_args()
            },
            &descriptor_without_default_path_operation(),
            &context(),
        )
        .expect_err("expected selector target without default path operation to fail");

        assert_eq!(error.stage, ErrorStage::ParseCommand);
        assert_eq!(
            error.why,
            "this source API descriptor does not define a default path operation"
        );
    }

    fn descriptor() -> SourceApiDescriptor {
        descriptor_with_operation("")
    }

    fn descriptor_with_operation(operation_name: &str) -> SourceApiDescriptor {
        SourceApiDescriptor {
            source: MessageField::some(SourceApiSource {
                key: "github-prod".to_owned(),
                provider:
                    crate::transport::source_api::SourceApiProvider::CLI_SOURCE_PROVIDER_GITHUB
                        .into(),
                display_name: Some("GitHub".to_owned()),
                ..Default::default()
            }),
            descriptor_version: "2026-04-09".to_owned(),
            default_path_operation: Some("fetch".to_owned()),
            operations: if operation_name.is_empty() {
                Vec::new()
            } else {
                vec![crate::transport::source_api::SourceApiOperation {
                    name: operation_name.to_owned(),
                    ..Default::default()
                }]
            },
            examples: Vec::new(),
            notes: Vec::new(),
            ..Default::default()
        }
    }

    fn descriptor_without_default_path_operation() -> SourceApiDescriptor {
        SourceApiDescriptor {
            default_path_operation: None,
            ..descriptor()
        }
    }

    fn context() -> CommandContext {
        CommandContext {
            command_line: "onequery api --source github-prod".to_owned(),
            base_url: default_base_url(),
            request_id: None,
            resolved_org: Some("acme".to_owned()),
            resolved_org_source: ResolvedOrgSource::Config,
            verbose: false,
        }
    }

    fn api_args() -> ApiArgs {
        ApiArgs {
            source: crate::identifiers::test_source_key("github-prod"),
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
    }
}
