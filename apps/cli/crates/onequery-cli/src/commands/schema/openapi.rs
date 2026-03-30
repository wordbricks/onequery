use std::collections::BTreeSet;

use onequery_cli_core::error::CliError;
use onequery_cli_core::error::ErrorStage;
use serde_json::Map;
use serde_json::Value;

use super::AuthRequirements;
use super::CommandSchema;
use super::HttpOperation;
use super::ReadControls;
use super::supports_headless_auth;

const HTTP_METHODS: [&str; 5] = ["get", "post", "put", "patch", "delete"];
const SCHEMA_OUTPUT_MODES: [&str; 2] = ["text", "json"];

pub(super) fn derive_public_http_command_schemas(
    spec: &Value,
) -> Result<Vec<CommandSchema>, CliError> {
    let paths = openapi_paths(spec)?;
    let components = openapi_components(spec)?;
    let mut commands = Vec::new();

    for (path, path_item_value) in paths {
        let Some(path_item) = path_item_value.as_object() else {
            continue;
        };

        for method in HTTP_METHODS {
            let Some(operation) = path_item.get(method).and_then(Value::as_object) else {
                continue;
            };

            if !exposes_public_command_schema(operation, method, path)? {
                continue;
            }

            commands.push(resolve_http_command_schema(
                operation, components, method, path,
            )?);
        }
    }

    ensure_unique_command_names(&commands)?;
    Ok(commands)
}

fn resolve_http_command_schema(
    operation: &Map<String, Value>,
    components: &Map<String, Value>,
    method: &str,
    path: &str,
) -> Result<CommandSchema, CliError> {
    let derivation_command = schema_derivation_command(method, path);
    let command =
        required_string_field(operation, "x-onequery-command", derivation_command.clone())?;
    let kind = required_string_field(operation, "x-onequery-kind", derivation_command.clone())?;
    let summary = required_non_empty_string_field(
        operation,
        "description",
        format!("oneq schema command {command}"),
    )?;
    let selector_schema = selector_schema_from_operation(operation, components)?;
    let input_schema = input_schema_from_operation(operation, components)?;
    let output_schema = output_schema_from_operation(operation, components)?;
    let read_controls = read_controls_from_operation(operation, derivation_command.as_str())?;
    let supports_fields = required_bool_field(
        operation,
        "x-onequery-supports-fields",
        derivation_command.clone(),
    )?;
    let supports_pagination = required_bool_field(
        operation,
        "x-onequery-supports-pagination",
        derivation_command.clone(),
    )?;
    let supports_dry_run = required_bool_field(
        operation,
        "x-onequery-supports-dry-run",
        derivation_command.clone(),
    )?;
    let supports_raw_input = required_bool_field(
        operation,
        "x-onequery-supports-raw-input",
        derivation_command.clone(),
    )?;
    ensure_legacy_read_control_flags_match(
        &read_controls,
        supports_fields,
        supports_pagination,
        derivation_command.as_str(),
    )?;
    let auth_requirements = auth_requirements_from_operation(operation)?;
    let error_codes = stable_error_codes_from_operation(operation)?;
    let retryable_statuses = retryable_statuses_from_operation(operation)?;
    let untrusted_response_paths =
        string_array_from_operation(operation, "x-onequery-untrusted-response-paths")?;
    let sanitization_profile = nullable_string_field(operation, "x-onequery-sanitization-profile")?;
    let required_org_role = nullable_string_field(operation, "x-onequery-required-org-role")?;
    let supports_headless_auth = supports_headless_auth(command.as_str(), &auth_requirements);
    let operation_id = required_string_field(operation, "operationId", derivation_command)?;

    Ok(CommandSchema {
        command,
        kind,
        summary,
        selector_schema,
        input_schema,
        output_schema,
        read_controls,
        supports_output_modes: SCHEMA_OUTPUT_MODES
            .iter()
            .map(|mode| (*mode).to_owned())
            .collect(),
        supports_fields,
        supports_pagination,
        supports_dry_run,
        supports_raw_input,
        supports_headless_auth,
        auth_requirements,
        error_codes,
        retryable_statuses,
        untrusted_response_paths,
        sanitization_profile,
        required_org_role,
        schema_source: "http-route".to_owned(),
        http: Some(HttpOperation {
            method: method.to_uppercase(),
            path: path.to_owned(),
            operation_id,
        }),
    })
}

fn read_controls_from_operation(
    operation: &Map<String, Value>,
    derivation_command: &str,
) -> Result<ReadControls, CliError> {
    let raw = operation
        .get("x-onequery-read-controls")
        .cloned()
        .ok_or_else(|| {
            CliError::new(
                "failed to derive HTTP command schema",
                derivation_command.to_owned(),
                ErrorStage::Render,
                "x-onequery-read-controls is missing from an embedded OpenAPI operation",
                vec!["regenerate the CLI OpenAPI document".to_owned()],
            )
        })?;

    serde_json::from_value(raw).map_err(|parse_error| {
        CliError::new(
            "failed to derive HTTP command schema",
            derivation_command.to_owned(),
            ErrorStage::Render,
            parse_error.to_string(),
            vec!["regenerate the CLI OpenAPI document".to_owned()],
        )
    })
}

fn ensure_legacy_read_control_flags_match(
    read_controls: &ReadControls,
    supports_fields: bool,
    supports_pagination: bool,
    derivation_command: &str,
) -> Result<(), CliError> {
    if read_controls.supports_fields() != supports_fields {
        return Err(CliError::new(
            "failed to derive HTTP command schema",
            derivation_command.to_owned(),
            ErrorStage::Render,
            "x-onequery-supports-fields did not match x-onequery-read-controls.fields.support",
            vec!["regenerate the CLI OpenAPI document".to_owned()],
        ));
    }

    if read_controls.supports_pagination() != supports_pagination {
        return Err(CliError::new(
            "failed to derive HTTP command schema",
            derivation_command.to_owned(),
            ErrorStage::Render,
            "x-onequery-supports-pagination did not match x-onequery-read-controls limit/cursor support",
            vec!["regenerate the CLI OpenAPI document".to_owned()],
        ));
    }

    Ok(())
}

fn exposes_public_command_schema(
    operation: &Map<String, Value>,
    method: &str,
    path: &str,
) -> Result<bool, CliError> {
    match operation.get("x-onequery-expose-command-schema") {
        Some(Value::Bool(value)) => Ok(*value),
        Some(_) => Err(CliError::new(
            "failed to derive HTTP command schema",
            schema_derivation_command(method, path),
            ErrorStage::Render,
            "x-onequery-expose-command-schema contained a non-boolean value",
            vec!["regenerate the CLI OpenAPI document".to_owned()],
        )),
        None if operation.contains_key("x-onequery-command") => Err(CliError::new(
            "failed to derive HTTP command schema",
            schema_derivation_command(method, path),
            ErrorStage::Render,
            "x-onequery-expose-command-schema is missing from an embedded OpenAPI operation",
            vec!["regenerate the CLI OpenAPI document".to_owned()],
        )),
        None => Ok(false),
    }
}

fn ensure_unique_command_names(commands: &[CommandSchema]) -> Result<(), CliError> {
    let mut seen = BTreeSet::new();

    for command in commands {
        if !seen.insert(command.command.as_str()) {
            return Err(CliError::new(
                "failed to derive HTTP command schema",
                format!("oneq schema command {}", command.command),
                ErrorStage::Render,
                format!(
                    "multiple OpenAPI operations expose the same public command schema: {}",
                    command.command
                ),
                vec!["regenerate the CLI OpenAPI document".to_owned()],
            ));
        }
    }

    Ok(())
}

fn openapi_paths(spec: &Value) -> Result<&Map<String, Value>, CliError> {
    spec.get("paths").and_then(Value::as_object).ok_or_else(|| {
        CliError::new(
            "failed to load embedded OpenAPI document",
            "oneq schema openapi".to_owned(),
            ErrorStage::Render,
            "paths is missing from the embedded OpenAPI document",
            vec!["regenerate the CLI OpenAPI document".to_owned()],
        )
    })
}

fn openapi_components(spec: &Value) -> Result<&Map<String, Value>, CliError> {
    spec.get("components")
        .and_then(|components| components.get("schemas"))
        .and_then(Value::as_object)
        .ok_or_else(|| {
            CliError::new(
                "failed to load OpenAPI schemas",
                "oneq schema commands".to_owned(),
                ErrorStage::Render,
                "components.schemas is missing from the embedded OpenAPI document",
                vec!["regenerate the CLI OpenAPI document".to_owned()],
            )
        })
}

fn selector_schema_from_operation(
    operation: &Map<String, Value>,
    components: &Map<String, Value>,
) -> Result<Value, CliError> {
    let mut properties = Map::new();
    let mut required = Vec::new();

    if let Some(parameters) = operation.get("parameters").and_then(Value::as_array) {
        for parameter in parameters {
            let parameter = resolve_parameter(parameter, components)?;
            let Some(name) = parameter.get("name").and_then(Value::as_str) else {
                continue;
            };
            let schema = parameter
                .get("schema")
                .map(|schema| resolve_schema(schema, components))
                .transpose()?
                .unwrap_or(Value::Null);
            properties.insert(name.to_owned(), schema);
            if parameter
                .get("required")
                .and_then(Value::as_bool)
                .unwrap_or(false)
            {
                required.push(Value::String(name.to_owned()));
            }
        }
    }

    let mut selector = Map::new();
    selector.insert("type".to_owned(), Value::String("object".to_owned()));
    selector.insert("additionalProperties".to_owned(), Value::Bool(false));
    selector.insert("properties".to_owned(), Value::Object(properties));
    selector.insert("required".to_owned(), Value::Array(required));
    Ok(Value::Object(selector))
}

fn input_schema_from_operation(
    operation: &Map<String, Value>,
    components: &Map<String, Value>,
) -> Result<Value, CliError> {
    let Some(request_body) = operation.get("requestBody") else {
        return Ok(Value::Null);
    };
    let request_body = resolve_request_body(request_body, components)?;
    let Some(schema) = request_body
        .get("content")
        .and_then(|content| content.get("application/json"))
        .and_then(|content| content.get("schema"))
    else {
        return Ok(Value::Null);
    };

    resolve_schema(schema, components)
}

fn output_schema_from_operation(
    operation: &Map<String, Value>,
    components: &Map<String, Value>,
) -> Result<Value, CliError> {
    let schema = operation
        .get("responses")
        .and_then(|responses| responses.get("200"))
        .and_then(|response| response.get("content"))
        .and_then(|content| content.get("application/json"))
        .and_then(|content| content.get("schema"))
        .ok_or_else(|| {
            CliError::new(
                "failed to derive HTTP command schema",
                "oneq schema commands".to_owned(),
                ErrorStage::Render,
                "OpenAPI operation is missing a 200 application/json success schema",
                vec!["regenerate the CLI OpenAPI document".to_owned()],
            )
        })?;

    let resolved = resolve_schema(schema, components)?;
    Ok(http_output_data_schema(&resolved).unwrap_or(resolved))
}

fn http_output_data_schema(schema: &Value) -> Option<Value> {
    schema
        .as_object()
        .and_then(|schema| schema.get("properties"))
        .and_then(Value::as_object)
        .and_then(|properties| properties.get("data"))
        .cloned()
}

fn auth_requirements_from_operation(
    operation: &Map<String, Value>,
) -> Result<AuthRequirements, CliError> {
    let raw = operation
        .get("x-onequery-auth-requirements")
        .cloned()
        .ok_or_else(|| {
            CliError::new(
                "failed to derive HTTP command schema",
                "oneq schema commands".to_owned(),
                ErrorStage::Render,
                "x-onequery-auth-requirements is missing from an embedded OpenAPI operation",
                vec!["regenerate the CLI OpenAPI document".to_owned()],
            )
        })?;

    serde_json::from_value(raw).map_err(|parse_error| {
        CliError::new(
            "failed to derive HTTP command schema",
            "oneq schema commands".to_owned(),
            ErrorStage::Render,
            parse_error.to_string(),
            vec!["regenerate the CLI OpenAPI document".to_owned()],
        )
    })
}

fn stable_error_codes_from_operation(
    operation: &Map<String, Value>,
) -> Result<Vec<String>, CliError> {
    let Some(error_codes) = operation
        .get("x-onequery-stable-error-codes")
        .and_then(Value::as_array)
    else {
        return Ok(Vec::new());
    };

    error_codes
        .iter()
        .map(|code| {
            code.as_str().map(ToOwned::to_owned).ok_or_else(|| {
                CliError::new(
                    "failed to derive HTTP command schema",
                    "oneq schema commands".to_owned(),
                    ErrorStage::Render,
                    "x-onequery-stable-error-codes contained a non-string value",
                    vec!["regenerate the CLI OpenAPI document".to_owned()],
                )
            })
        })
        .collect()
}

fn required_string_field(
    operation: &Map<String, Value>,
    key: &str,
    command: String,
) -> Result<String, CliError> {
    operation
        .get(key)
        .and_then(Value::as_str)
        .map(ToOwned::to_owned)
        .ok_or_else(|| {
            CliError::new(
                "failed to derive HTTP command schema",
                command,
                ErrorStage::Render,
                format!("{key} is missing from an embedded OpenAPI operation"),
                vec!["regenerate the CLI OpenAPI document".to_owned()],
            )
        })
}

fn required_non_empty_string_field(
    operation: &Map<String, Value>,
    key: &str,
    command: String,
) -> Result<String, CliError> {
    let value = required_string_field(operation, key, command.clone())?;

    if value.trim().is_empty() {
        return Err(CliError::new(
            "failed to derive HTTP command schema",
            command,
            ErrorStage::Render,
            format!("{key} is empty in an embedded OpenAPI operation"),
            vec!["regenerate the CLI OpenAPI document".to_owned()],
        ));
    }

    Ok(value)
}

fn required_bool_field(
    operation: &Map<String, Value>,
    key: &str,
    command: String,
) -> Result<bool, CliError> {
    operation.get(key).and_then(Value::as_bool).ok_or_else(|| {
        CliError::new(
            "failed to derive HTTP command schema",
            command,
            ErrorStage::Render,
            format!("{key} is missing from an embedded OpenAPI operation"),
            vec!["regenerate the CLI OpenAPI document".to_owned()],
        )
    })
}

fn nullable_string_field(
    operation: &Map<String, Value>,
    key: &str,
) -> Result<Option<String>, CliError> {
    match operation.get(key) {
        Some(Value::String(value)) => Ok(Some(value.to_owned())),
        Some(Value::Null) | None => Ok(None),
        Some(_) => Err(CliError::new(
            "failed to derive HTTP command schema",
            "oneq schema commands".to_owned(),
            ErrorStage::Render,
            format!("{key} contained a non-string value"),
            vec!["regenerate the CLI OpenAPI document".to_owned()],
        )),
    }
}

fn resolve_parameter(
    parameter: &Value,
    components: &Map<String, Value>,
) -> Result<Value, CliError> {
    if let Some(reference) = parameter.get("$ref").and_then(Value::as_str) {
        return resolve_reference(reference, components);
    }
    Ok(parameter.clone())
}

fn resolve_request_body(
    request_body: &Value,
    components: &Map<String, Value>,
) -> Result<Value, CliError> {
    if let Some(reference) = request_body.get("$ref").and_then(Value::as_str) {
        return resolve_reference(reference, components);
    }
    Ok(request_body.clone())
}

fn resolve_schema(schema: &Value, components: &Map<String, Value>) -> Result<Value, CliError> {
    let Some(object) = schema.as_object() else {
        return Ok(schema.clone());
    };

    if let Some(reference) = object.get("$ref").and_then(Value::as_str) {
        return resolve_reference(reference, components);
    }

    let mut resolved = object.clone();

    if let Some(properties) = object.get("properties").and_then(Value::as_object) {
        let resolved_properties = properties
            .iter()
            .map(|(key, value)| Ok((key.clone(), resolve_schema(value, components)?)))
            .collect::<Result<Map<_, _>, CliError>>()?;
        resolved.insert("properties".to_owned(), Value::Object(resolved_properties));
    }

    if let Some(items) = object.get("items") {
        resolved.insert("items".to_owned(), resolve_schema(items, components)?);
    }

    if let Some(additional_properties) = object.get("additionalProperties")
        && additional_properties.is_object()
    {
        resolved.insert(
            "additionalProperties".to_owned(),
            resolve_schema(additional_properties, components)?,
        );
    }

    for combinator in ["allOf", "anyOf", "oneOf"] {
        if let Some(values) = object.get(combinator).and_then(Value::as_array) {
            let resolved_values = values
                .iter()
                .map(|value| resolve_schema(value, components))
                .collect::<Result<Vec<_>, _>>()?;
            resolved.insert(combinator.to_owned(), Value::Array(resolved_values));
        }
    }

    Ok(Value::Object(resolved))
}

fn retryable_statuses_from_operation(operation: &Map<String, Value>) -> Result<Vec<u16>, CliError> {
    let Some(statuses) = operation
        .get("x-onequery-retryable-statuses")
        .and_then(Value::as_array)
    else {
        return Ok(Vec::new());
    };

    statuses
        .iter()
        .map(|status| {
            status
                .as_u64()
                .and_then(|value| u16::try_from(value).ok())
                .ok_or_else(|| {
                    CliError::new(
                        "failed to derive HTTP command schema",
                        "oneq schema commands".to_owned(),
                        ErrorStage::Render,
                        "x-onequery-retryable-statuses contained a non-integer value",
                        vec!["regenerate the CLI OpenAPI document".to_owned()],
                    )
                })
        })
        .collect()
}

fn string_array_from_operation(
    operation: &Map<String, Value>,
    key: &str,
) -> Result<Vec<String>, CliError> {
    let Some(values) = operation.get(key).and_then(Value::as_array) else {
        return Ok(Vec::new());
    };

    values
        .iter()
        .map(|value| {
            value.as_str().map(ToOwned::to_owned).ok_or_else(|| {
                CliError::new(
                    "failed to derive HTTP command schema",
                    "oneq schema commands".to_owned(),
                    ErrorStage::Render,
                    format!("{key} contained a non-string value"),
                    vec!["regenerate the CLI OpenAPI document".to_owned()],
                )
            })
        })
        .collect()
}

fn resolve_reference(reference: &str, components: &Map<String, Value>) -> Result<Value, CliError> {
    let Some(schema_name) = reference.strip_prefix("#/components/schemas/") else {
        return Err(CliError::new(
            "failed to resolve OpenAPI reference",
            "oneq schema commands".to_owned(),
            ErrorStage::Render,
            format!("unsupported OpenAPI reference {reference}"),
            vec!["regenerate the CLI OpenAPI document".to_owned()],
        ));
    };

    let referenced = components.get(schema_name).ok_or_else(|| {
        CliError::new(
            "failed to resolve OpenAPI reference",
            "oneq schema commands".to_owned(),
            ErrorStage::Render,
            format!("missing components.schemas.{schema_name}"),
            vec!["regenerate the CLI OpenAPI document".to_owned()],
        )
    })?;

    resolve_schema(referenced, components)
}

fn schema_derivation_command(method: &str, path: &str) -> String {
    format!("oneq schema derive {method} {path}")
}
