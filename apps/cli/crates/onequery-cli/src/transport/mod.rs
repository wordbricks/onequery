pub(crate) mod auth;
pub(crate) mod client;
pub(crate) mod generated;
pub(crate) mod http;
pub(crate) mod org;
mod pagination;
pub(crate) mod query;
pub(crate) mod read_controls;
pub(crate) mod source;
pub(crate) mod source_connect;
pub(crate) mod use_cmd;

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use pretty_assertions::assert_eq;
    use serde_json::Map;
    use serde_json::Value;

    #[derive(Debug, Clone, Copy, Eq, PartialEq)]
    struct ExpectedCliOperation {
        method: &'static str,
        path: &'static str,
        request_body_schema_ref: Option<&'static str>,
        success_schema_refs: &'static [&'static str],
    }

    #[test]
    fn checked_in_openapi_contract_matches_rust_transport_operations() {
        let spec_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../../../packages/cli-contract/openapi/generated/cli.openapi.json");
        let spec_contents =
            std::fs::read_to_string(&spec_path).expect("expected checked-in CLI OpenAPI spec");
        let spec =
            serde_json::from_str::<Value>(&spec_contents).expect("expected valid OpenAPI JSON");

        let paths = spec
            .get("paths")
            .and_then(Value::as_object)
            .expect("expected OpenAPI paths object");
        let expected_operations = [
            ExpectedCliOperation {
                method: "get",
                path: "/use",
                request_body_schema_ref: None,
                success_schema_refs: &["#/components/schemas/CliUseEnvelope"],
            },
            ExpectedCliOperation {
                method: "get",
                path: "/session",
                request_body_schema_ref: None,
                success_schema_refs: &["#/components/schemas/CliSessionReadEnvelope"],
            },
            ExpectedCliOperation {
                method: "post",
                path: "/session:refresh",
                request_body_schema_ref: None,
                success_schema_refs: &["#/components/schemas/CliSessionRefreshEnvelope"],
            },
            ExpectedCliOperation {
                method: "post",
                path: "/auth/device-authorizations",
                request_body_schema_ref: None,
                success_schema_refs: &[
                    "#/components/schemas/CliAuthDeviceAuthorizationStartEnvelope",
                ],
            },
            ExpectedCliOperation {
                method: "post",
                path: "/auth/device-authorizations:poll",
                request_body_schema_ref: Some(
                    "#/components/schemas/CliAuthDeviceAuthorizationPollRequest",
                ),
                success_schema_refs: &[
                    "#/components/schemas/CliAuthDeviceAuthorizationPollEnvelope",
                ],
            },
            ExpectedCliOperation {
                method: "get",
                path: "/organizations",
                request_body_schema_ref: None,
                success_schema_refs: &["#/components/schemas/CliOrgListEnvelope"],
            },
            ExpectedCliOperation {
                method: "get",
                path: "/organizations/{orgSlug}",
                request_body_schema_ref: None,
                success_schema_refs: &["#/components/schemas/CliOrgGetEnvelope"],
            },
            ExpectedCliOperation {
                method: "post",
                path: "/organizations/{orgSlug}/sources/{sourceKey}/queries:execute",
                request_body_schema_ref: Some("#/components/schemas/CliQueryRequest"),
                success_schema_refs: &["#/components/schemas/CliQueryExecuteEnvelope"],
            },
            ExpectedCliOperation {
                method: "get",
                path: "/organizations/{orgSlug}/sources",
                request_body_schema_ref: None,
                success_schema_refs: &["#/components/schemas/CliSourceListEnvelope"],
            },
            ExpectedCliOperation {
                method: "get",
                path: "/organizations/{orgSlug}/sources:connect",
                request_body_schema_ref: None,
                success_schema_refs: &["#/components/schemas/CliSourceConnectGuideEnvelope"],
            },
            ExpectedCliOperation {
                method: "post",
                path: "/organizations/{orgSlug}/sources:connect",
                request_body_schema_ref: Some("#/components/schemas/CliSourceConnectRequest"),
                success_schema_refs: &["#/components/schemas/CliSourceConnectEnvelope"],
            },
            ExpectedCliOperation {
                method: "get",
                path: "/organizations/{orgSlug}/sources/{sourceKey}",
                request_body_schema_ref: None,
                success_schema_refs: &["#/components/schemas/CliSourceShowEnvelope"],
            },
        ];

        let actual_operations = expected_operations
            .iter()
            .map(|expected| {
                let operation = operation_object(paths, expected.path, expected.method);
                (
                    expected.method.to_owned(),
                    expected.path.to_owned(),
                    request_body_schema_ref(operation).map(ToOwned::to_owned),
                    success_schema_refs(operation),
                )
            })
            .collect::<Vec<_>>();
        let expected_operations = expected_operations
            .into_iter()
            .map(|expected| {
                (
                    expected.method.to_owned(),
                    expected.path.to_owned(),
                    expected.request_body_schema_ref.map(ToOwned::to_owned),
                    expected
                        .success_schema_refs
                        .iter()
                        .map(ToString::to_string)
                        .collect::<Vec<_>>(),
                )
            })
            .collect::<Vec<_>>();

        let server_urls = spec
            .get("servers")
            .and_then(Value::as_array)
            .map(|servers| {
                servers
                    .iter()
                    .filter_map(|server| server.get("url").and_then(Value::as_str))
                    .map(ToOwned::to_owned)
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        assert_eq!(server_urls, vec!["/api/cli".to_owned()]);

        let has_cli_problem_schema = spec
            .get("components")
            .and_then(|components| components.get("schemas"))
            .and_then(Value::as_object)
            .is_some_and(|schemas| schemas.contains_key("CliProblem"));

        assert_eq!(
            (actual_operations, server_urls, has_cli_problem_schema),
            (expected_operations, vec!["/api/cli".to_owned()], true)
        );
    }

    fn operation_object<'a>(
        paths: &'a Map<String, Value>,
        path: &str,
        method: &str,
    ) -> &'a Map<String, Value> {
        paths
            .get(path)
            .and_then(Value::as_object)
            .and_then(|path_item| path_item.get(method))
            .and_then(Value::as_object)
            .unwrap_or_else(|| panic!("expected OpenAPI operation {method} {path}"))
    }

    fn request_body_schema_ref(operation: &Map<String, Value>) -> Option<&str> {
        operation
            .get("requestBody")
            .and_then(|request_body| request_body.get("content"))
            .and_then(|content| content.get("application/json"))
            .and_then(|content| content.get("schema"))
            .and_then(|schema| schema.get("$ref"))
            .and_then(Value::as_str)
    }

    fn success_schema_refs(operation: &Map<String, Value>) -> Vec<String> {
        let Some(schema) = operation
            .get("responses")
            .and_then(|responses| responses.get("200"))
            .and_then(|response| response.get("content"))
            .and_then(|content| content.get("application/json"))
            .and_then(|content| content.get("schema"))
        else {
            return Vec::new();
        };

        if let Some(reference) = schema.get("$ref").and_then(Value::as_str) {
            return vec![reference.to_owned()];
        }

        schema
            .get("oneOf")
            .and_then(Value::as_array)
            .map(|variants| {
                variants
                    .iter()
                    .filter_map(|variant| variant.get("$ref").and_then(Value::as_str))
                    .map(ToString::to_string)
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default()
    }
}
