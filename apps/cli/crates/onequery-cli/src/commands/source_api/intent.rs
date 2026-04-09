use onequery_cli_core::error::CliError;

use crate::cli::UseArgs;
use crate::transport::source_api::SourceApiDescriptor;

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
    args: &UseArgs,
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

    if is_selector_target(target) {
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
            selector: Some(target.to_owned()),
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
