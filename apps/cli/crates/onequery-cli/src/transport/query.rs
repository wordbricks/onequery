use buffa::MessageField;
use connectrpc::ErrorCode;
use onequery_cli_core::error::ErrorStage;
use serde::Deserialize;
use serde::Serialize;

use crate::output_metadata::SanitizationMetadata;
use crate::transport::api_failure::ApiFailure;
use crate::transport::api_failure::ApiSuccess;
use crate::transport::api_failure::ResponseFailureStages;
use crate::transport::api_failure::conversion_failure;
use crate::transport::api_failure::decode_failure;
use crate::transport::api_failure::failure_from_connect;
use crate::transport::api_failure::response_request_id;
use crate::transport::api_failure::sanitization_metadata_from_generated;
use crate::transport::api_failure::try_into_option;
use crate::transport::api_failure::try_into_value;
use crate::transport::client::AuthenticatedApiClient;
use crate::transport::generated::types;
use crate::transport::labels::query_logical_type_to_str;
use crate::transport::pagination::optional_page_size;
use crate::transport::pagination::page_info_from_generated;
use crate::transport::query_parameter::QueryCanonicalParameter;
use crate::transport::query_parameter::QueryRequestParameter;
use crate::transport::query_parameter::query_canonical_parameter_from_generated;
use crate::transport::query_parameter::query_request_parameter_to_generated;
use crate::transport::read_controls::PageInfo;
use crate::transport::read_controls::ReadRequestControls;
use crate::transport::read_controls::SinglePageReadControls;
use crate::transport::source::SourceSummary;
use crate::transport::source::source_summary_from_generated;

#[derive(Debug, Clone, Deserialize, Serialize, Eq, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct QueryColumn {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) logical_type: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, Eq, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct QueryResult {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) source: Option<SourceSummary>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) row_count: Option<usize>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) elapsed_ms: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) columns: Option<Vec<QueryColumn>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) rows: Option<Vec<Vec<String>>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) truncated: Option<bool>,
    pub(crate) page: PageInfo,
    #[serde(skip)]
    pub(crate) output_metadata: Option<SanitizationMetadata>,
}

#[derive(Debug, Clone, Deserialize, Serialize, Eq, PartialEq, Default)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct QueryRequestPayload {
    pub(crate) sql: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) parameters: Option<Vec<QueryRequestParameter>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) max_rows: Option<usize>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) max_bytes: Option<usize>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) cell_max_chars: Option<usize>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) timeout_ms: Option<u64>,
}

impl QueryRequestPayload {
    pub(crate) fn with_default_timeout_ms(mut self, timeout_ms: Option<u64>) -> Self {
        if self.timeout_ms.is_none() {
            self.timeout_ms = timeout_ms;
        }
        self
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, Eq, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct QueryResultWindow {
    pub(crate) max_rows: Option<usize>,
    pub(crate) max_bytes: Option<usize>,
    pub(crate) cell_max_chars: Option<usize>,
    pub(crate) timeout_ms: Option<u64>,
}

#[derive(Debug, Clone, Deserialize, Serialize, Eq, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct QueryCanonicalRequest {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) sql: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) parameters: Option<Vec<QueryCanonicalParameter>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) max_rows: Option<usize>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) max_bytes: Option<usize>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) cell_max_chars: Option<usize>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) timeout_ms: Option<u64>,
}

#[derive(Debug, Clone, Deserialize, Serialize, Eq, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct QueryValidationResult {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) request: Option<QueryCanonicalRequest>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) normalized_sql: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) declared_result_window: Option<QueryResultWindow>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) source: Option<SourceSummary>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) truncated: Option<bool>,
}

pub(crate) async fn execute_read_only_query_with_controls(
    client: &AuthenticatedApiClient,
    org: &str,
    source_key: &str,
    payload: &QueryRequestPayload,
    controls: &ReadRequestControls,
) -> Result<ApiSuccess<QueryResult>, ApiFailure> {
    let response =
        fetch_query_page(client, org, source_key, payload, controls.single_page()).await?;

    if !controls.page_all {
        return Ok(response);
    }

    let request_id = response.request_id.clone();
    let mut aggregated = response.payload;
    let mut total_returned = aggregated.page.returned;
    let mut next_cursor = aggregated.page.next_cursor.clone();

    while let Some(cursor) = next_cursor {
        let next_response = fetch_query_page(
            client,
            org,
            source_key,
            payload,
            controls.with_cursor(Some(cursor)),
        )
        .await?;
        total_returned += next_response.payload.page.returned;
        if let Some(rows) = &mut aggregated.rows
            && let Some(next_rows) = next_response.payload.rows
        {
            rows.extend(next_rows);
        }
        next_cursor = next_response.payload.page.next_cursor;
    }

    aggregated.page = PageInfo::aggregated(total_returned);
    Ok(ApiSuccess {
        payload: aggregated,
        request_id,
    })
}

async fn fetch_query_page(
    client: &AuthenticatedApiClient,
    org: &str,
    source_key: &str,
    payload: &QueryRequestPayload,
    controls: SinglePageReadControls,
) -> Result<ApiSuccess<QueryResult>, ApiFailure> {
    let org_slug: String = try_into_value(org, ErrorStage::ExecuteQuery)?;
    let source_key: String = try_into_value(source_key, ErrorStage::ExecuteQuery)?;
    let cursor: Option<String> =
        try_into_option(controls.cursor.as_deref(), ErrorStage::ExecuteQuery)?;
    let limit = optional_page_size(controls.page_size, ErrorStage::ExecuteQuery)?;
    let query = query_request_from_payload(payload)?;
    let response = match client
        .cli()
        .execute_query(types::ExecuteQueryRequest {
            org_slug,
            source_key,
            limit,
            cursor,
            query: MessageField::some(query),
            ..Default::default()
        })
        .await
    {
        Ok(response) => response,
        Err(error) => {
            return Err(failure_from_connect(
                error,
                ResponseFailureStages::from_connect_code(execute_query_problem_stage_for_code),
            ));
        }
    };
    let request_id = response_request_id(response.headers());
    let payload = response.into_owned();

    Ok(ApiSuccess {
        payload: query_result_from_generated(payload, request_id.clone())?,
        request_id,
    })
}

pub(crate) async fn validate_read_only_query_with_controls(
    client: &AuthenticatedApiClient,
    org: &str,
    source_key: &str,
    payload: &QueryRequestPayload,
    _controls: &ReadRequestControls,
) -> Result<ApiSuccess<QueryValidationResult>, ApiFailure> {
    let org_slug: String = try_into_value(org, ErrorStage::ReadQueryInput)?;
    let source_key: String = try_into_value(source_key, ErrorStage::ReadQueryInput)?;
    let query = query_request_from_payload(payload)?;
    let response = match client
        .cli()
        .validate_query(types::ValidateQueryRequest {
            org_slug,
            source_key,
            query: MessageField::some(query),
            ..Default::default()
        })
        .await
    {
        Ok(response) => response,
        Err(error) => {
            return Err(failure_from_connect(
                error,
                ResponseFailureStages::from_connect_code(validate_query_problem_stage_for_code),
            ));
        }
    };
    let request_id = response_request_id(response.headers());
    let payload = response.into_owned();

    Ok(ApiSuccess {
        payload: query_validation_from_generated(payload, request_id.clone())?,
        request_id,
    })
}

fn execute_query_problem_stage_for_code(code: ErrorCode) -> ErrorStage {
    if matches!(
        code,
        ErrorCode::Unauthenticated | ErrorCode::PermissionDenied
    ) {
        ErrorStage::Auth
    } else {
        ErrorStage::ExecuteQuery
    }
}

fn validate_query_problem_stage_for_code(code: ErrorCode) -> ErrorStage {
    if matches!(
        code,
        ErrorCode::Unauthenticated | ErrorCode::PermissionDenied
    ) {
        ErrorStage::Auth
    } else {
        ErrorStage::ReadQueryInput
    }
}

fn query_request_from_payload(
    payload: &QueryRequestPayload,
) -> Result<types::CliQueryRequest, ApiFailure> {
    Ok(types::CliQueryRequest {
        sql: try_into_value(payload.sql.as_str(), ErrorStage::ReadQueryInput)?,
        parameters: payload
            .parameters
            .clone()
            .unwrap_or_default()
            .into_iter()
            .map(query_request_parameter_to_generated)
            .collect(),
        max_rows: optional_query_bound(payload.max_rows, ErrorStage::ReadQueryInput)?,
        max_bytes: optional_query_bound(payload.max_bytes, ErrorStage::ReadQueryInput)?,
        cell_max_chars: optional_query_bound(payload.cell_max_chars, ErrorStage::ReadQueryInput)?,
        timeout_ms: optional_timeout_ms(payload.timeout_ms, ErrorStage::ReadQueryInput)?,
        ..Default::default()
    })
}

fn query_result_from_generated(
    result: types::ExecuteQueryResponse,
    request_id: Option<String>,
) -> Result<QueryResult, ApiFailure> {
    let source = result.source.into_option().ok_or_else(|| {
        decode_failure(
            ErrorStage::ExecuteQuery,
            "query execution response missing source metadata",
            request_id.clone(),
        )
    })?;
    let page = result.page.into_option().ok_or_else(|| {
        decode_failure(
            ErrorStage::ExecuteQuery,
            "query execution response missing page metadata",
            request_id,
        )
    })?;

    Ok(QueryResult {
        output_metadata: sanitization_metadata_from_generated(result.sanitization.into_option()),
        source: Some(source_summary_from_generated(source)),
        row_count: usize::try_from(result.row_count).ok(),
        elapsed_ms: Some(result.elapsed_ms),
        columns: Some(
            result
                .columns
                .into_iter()
                .map(|column| QueryColumn {
                    name: non_empty(column.name),
                    logical_type: column.logical_type.and_then(query_logical_type_to_str),
                })
                .collect(),
        ),
        rows: Some(result.rows.into_iter().map(|row| row.values).collect()),
        truncated: Some(result.truncated),
        page: page_info_from_generated(page),
    })
}

fn query_validation_from_generated(
    result: types::ValidateQueryResponse,
    request_id: Option<String>,
) -> Result<QueryValidationResult, ApiFailure> {
    let request = result.request.into_option().ok_or_else(|| {
        decode_failure(
            ErrorStage::ReadQueryInput,
            "query validation response missing request payload",
            request_id.clone(),
        )
    })?;
    let declared_result_window = result.declared_result_window.into_option().ok_or_else(|| {
        decode_failure(
            ErrorStage::ReadQueryInput,
            "query validation response missing result window",
            request_id.clone(),
        )
    })?;
    let source = result.source.into_option().ok_or_else(|| {
        decode_failure(
            ErrorStage::ReadQueryInput,
            "query validation response missing source metadata",
            request_id,
        )
    })?;

    Ok(QueryValidationResult {
        request: Some(query_canonical_request_from_generated(request)),
        normalized_sql: Some(result.normalized_sql),
        declared_result_window: Some(query_result_window_from_generated(declared_result_window)),
        source: Some(source_summary_from_generated(source)),
        truncated: Some(result.truncated),
    })
}

fn query_canonical_request_from_generated(
    request: types::CliQueryCanonicalRequest,
) -> QueryCanonicalRequest {
    QueryCanonicalRequest {
        sql: Some(request.sql),
        parameters: (!request.parameters.is_empty()).then(|| {
            request
                .parameters
                .into_iter()
                .map(query_canonical_parameter_from_generated)
                .collect()
        }),
        max_rows: request
            .max_rows
            .and_then(|value| usize::try_from(value).ok()),
        max_bytes: request
            .max_bytes
            .and_then(|value| usize::try_from(value).ok()),
        cell_max_chars: request
            .cell_max_chars
            .and_then(|value| usize::try_from(value).ok()),
        timeout_ms: request.timeout_ms.map(u64::from),
    }
}

fn query_result_window_from_generated(
    window: types::CliDeclaredQueryResultWindow,
) -> QueryResultWindow {
    QueryResultWindow {
        max_rows: window
            .max_rows
            .and_then(|value| usize::try_from(value).ok()),
        max_bytes: window
            .max_bytes
            .and_then(|value| usize::try_from(value).ok()),
        cell_max_chars: window
            .cell_max_chars
            .and_then(|value| usize::try_from(value).ok()),
        timeout_ms: window.timeout_ms.map(u64::from),
    }
}

fn optional_query_bound(
    value: Option<usize>,
    stage: ErrorStage,
) -> Result<Option<u32>, ApiFailure> {
    value
        .map(|value| {
            let value = u32::try_from(value)
                .map_err(|error| conversion_failure(stage, error.to_string()))?;
            (value > 0)
                .then_some(value)
                .ok_or_else(|| conversion_failure(stage, "query bounds must be greater than zero"))
        })
        .transpose()
}

fn optional_timeout_ms(value: Option<u64>, stage: ErrorStage) -> Result<Option<u32>, ApiFailure> {
    value
        .map(|value| {
            let value = u32::try_from(value)
                .map_err(|error| conversion_failure(stage, error.to_string()))?;
            (value > 0)
                .then_some(value)
                .ok_or_else(|| conversion_failure(stage, "timeout must be greater than zero"))
        })
        .transpose()
}

fn non_empty(value: String) -> Option<String> {
    (!value.is_empty()).then_some(value)
}

#[cfg(test)]
mod tests {
    use connectrpc::ErrorCode;
    use http::StatusCode;
    use onequery_cli_core::error::ErrorStage;
    use pretty_assertions::assert_eq;
    use serde_json::json;

    use crate::output_metadata::SanitizationMetadata;
    use crate::transport::api_failure::ApiFailure;
    use crate::transport::api_failure::ApiProblem;
    use crate::transport::query_parameter::QueryCanonicalParameter;
    use crate::transport::query_parameter::QueryCanonicalParameterType;
    use crate::transport::query_parameter::QueryRequestParameter;
    use crate::transport::query_parameter::QueryRequestParameterType;
    use crate::transport::read_controls::PageInfo;
    use crate::transport::source::SourceSummary;

    use super::QueryColumn;
    use super::QueryRequestPayload;
    use super::QueryResult;
    use super::QueryResultWindow;
    use super::QueryValidationResult;
    use super::execute_query_problem_stage_for_code;
    use super::validate_query_problem_stage_for_code;

    #[test]
    fn query_result_deserializes_canonical_shape() {
        let payload = json!({
            "source": {
                "name": "warehouse",
                "provider": "postgres",
                "queryable": true,
                "status": "active"
            },
            "columns": [
                {"name": "value", "logicalType": "number"}
            ],
            "rows": [["42"]],
            "rowCount": 1,
            "elapsedMs": 25,
            "truncated": false,
            "page": {
                "nextCursor": null,
                "returned": 1,
                "hasMore": false
            }
        });

        let parsed = serde_json::from_value::<QueryResult>(payload)
            .expect("canonical query result should deserialize");

        assert_eq!(
            parsed,
            QueryResult {
                source: Some(SourceSummary {
                    name: Some("warehouse".to_owned()),
                    display_name: None,
                    provider: Some("postgres".to_owned()),
                    queryable: Some(true),
                    status: Some("active".to_owned()),
                }),
                row_count: Some(1),
                elapsed_ms: Some(25),
                columns: Some(vec![QueryColumn {
                    name: Some("value".to_owned()),
                    logical_type: Some("number".to_owned()),
                }]),
                rows: Some(vec![vec!["42".to_owned()]]),
                truncated: Some(false),
                page: PageInfo {
                    next_cursor: None,
                    returned: 1,
                    has_more: false,
                },
                output_metadata: None,
            }
        );
    }

    #[test]
    fn query_validation_result_deserializes_canonical_shape() {
        let payload = json!({
            "request": {
                "sql": "SELECT 1",
                "parameters": [
                    {"type": "string", "value": "acme"},
                    {"type": "null", "value": null}
                ],
                "maxRows": 100,
                "maxBytes": 4096,
                "cellMaxChars": 256,
                "timeoutMs": 2500
            },
            "normalizedSql": "SELECT 1",
            "declaredResultWindow": {
                "maxRows": 100,
                "maxBytes": 4096,
                "cellMaxChars": 256,
                "timeoutMs": 2500
            },
            "source": {
                "name": "warehouse",
                "provider": "postgres",
                "queryable": true,
                "status": "active"
            },
            "truncated": false
        });

        let parsed = serde_json::from_value::<QueryValidationResult>(payload)
            .expect("canonical query validation payload should deserialize");

        assert_eq!(
            parsed,
            QueryValidationResult {
                request: Some(super::QueryCanonicalRequest {
                    sql: Some("SELECT 1".to_owned()),
                    parameters: Some(vec![
                        QueryCanonicalParameter {
                            parameter_type: QueryCanonicalParameterType::String,
                            value: Some("acme".to_owned()),
                        },
                        QueryCanonicalParameter {
                            parameter_type: QueryCanonicalParameterType::Null,
                            value: None,
                        },
                    ]),
                    max_rows: Some(100),
                    max_bytes: Some(4096),
                    cell_max_chars: Some(256),
                    timeout_ms: Some(2500),
                }),
                normalized_sql: Some("SELECT 1".to_owned()),
                declared_result_window: Some(QueryResultWindow {
                    max_rows: Some(100),
                    max_bytes: Some(4096),
                    cell_max_chars: Some(256),
                    timeout_ms: Some(2500),
                }),
                source: Some(SourceSummary {
                    name: Some("warehouse".to_owned()),
                    display_name: None,
                    provider: Some("postgres".to_owned()),
                    queryable: Some(true),
                    status: Some("active".to_owned()),
                }),
                truncated: Some(false),
            }
        );
    }

    #[test]
    fn retryable_status_only_matches_transient_gateway_failures() {
        assert_eq!(
            [
                ApiFailure::Problem(ApiProblem {
                    connect_code: None,
                    status: Some(StatusCode::BAD_GATEWAY),
                    title: None,
                    detail: None,
                    code: None,
                    retryable: true,
                    retry_after_ms: None,
                    stage: ErrorStage::ExecuteQuery,
                    hint: None,
                    request_id: None,
                    validation_issues: Vec::new(),
                    raw_body: String::new(),
                })
                .is_retryable(),
                ApiFailure::Problem(ApiProblem {
                    connect_code: None,
                    status: Some(StatusCode::BAD_REQUEST),
                    title: None,
                    detail: None,
                    code: None,
                    retryable: false,
                    retry_after_ms: None,
                    stage: ErrorStage::ExecuteQuery,
                    hint: None,
                    request_id: None,
                    validation_issues: Vec::new(),
                    raw_body: String::new(),
                })
                .is_retryable(),
            ],
            [true, false]
        );
    }

    #[test]
    fn execute_query_problem_stage_maps_auth_failures_to_auth_stage() {
        assert_eq!(
            [
                execute_query_problem_stage_for_code(ErrorCode::Unauthenticated),
                execute_query_problem_stage_for_code(ErrorCode::PermissionDenied),
                execute_query_problem_stage_for_code(ErrorCode::InvalidArgument),
            ],
            [ErrorStage::Auth, ErrorStage::Auth, ErrorStage::ExecuteQuery,]
        );
    }

    #[test]
    fn validate_query_problem_stage_maps_auth_failures_to_auth_stage() {
        assert_eq!(
            [
                validate_query_problem_stage_for_code(ErrorCode::Unauthenticated),
                validate_query_problem_stage_for_code(ErrorCode::PermissionDenied),
                validate_query_problem_stage_for_code(ErrorCode::InvalidArgument),
            ],
            [
                ErrorStage::Auth,
                ErrorStage::Auth,
                ErrorStage::ReadQueryInput
            ]
        );
    }

    #[test]
    fn query_request_from_payload_maps_connect_request() {
        let request = super::query_request_from_payload(&QueryRequestPayload {
            sql: "select 42".to_owned(),
            parameters: Some(vec![
                QueryRequestParameter {
                    parameter_type: QueryRequestParameterType::String,
                    value: Some("acme".to_owned()),
                },
                QueryRequestParameter {
                    parameter_type: QueryRequestParameterType::Null,
                    value: None,
                },
            ]),
            max_rows: Some(100),
            max_bytes: Some(4_096),
            cell_max_chars: Some(256),
            timeout_ms: Some(2_500),
        })
        .expect("expected canonical query request");

        assert_eq!(
            request,
            super::types::CliQueryRequest {
                sql: "select 42".to_owned(),
                parameters: vec![
                    super::types::CliQueryParameter {
                        r#type:
                            super::types::CliQueryParameterType::CLI_QUERY_PARAMETER_TYPE_STRING
                                .into(),
                        value: Some("acme".to_owned()),
                        ..Default::default()
                    },
                    super::types::CliQueryParameter {
                        r#type: super::types::CliQueryParameterType::CLI_QUERY_PARAMETER_TYPE_NULL
                            .into(),
                        value: None,
                        ..Default::default()
                    },
                ],
                max_rows: Some(100),
                max_bytes: Some(4_096),
                cell_max_chars: Some(256),
                timeout_ms: Some(2_500),
                ..Default::default()
            }
        );
    }

    #[test]
    fn query_result_from_generated_maps_execute_response() {
        let result = super::query_result_from_generated(
            super::types::ExecuteQueryResponse {
                source: buffa::MessageField::some(super::types::GetSourceResponse {
                    name: "warehouse".to_owned(),
                    provider: super::types::CliSourceProvider::CLI_SOURCE_PROVIDER_POSTGRES.into(),
                    queryable: true,
                    status: super::types::CliSourceStatus::CLI_SOURCE_STATUS_ACTIVE.into(),
                    ..Default::default()
                }),
                row_count: 1,
                elapsed_ms: 25,
                columns: vec![super::types::CliQueryColumn {
                    name: "value".to_owned(),
                    logical_type: Some(
                        super::types::CliQueryLogicalType::CLI_QUERY_LOGICAL_TYPE_NUMBER.into(),
                    ),
                    ..Default::default()
                }],
                rows: vec![super::types::CliQueryRow {
                    values: vec!["42".to_owned()],
                    ..Default::default()
                }],
                truncated: false,
                page: buffa::MessageField::some(super::types::CliPage {
                    returned: 1,
                    has_more: false,
                    ..Default::default()
                }),
                sanitization: buffa::MessageField::some(super::types::CliSanitization {
                    profile: "strict".to_owned(),
                    sanitized_paths: vec!["rows[0][0]".to_owned()],
                    raw_available: false,
                    ..Default::default()
                }),
                ..Default::default()
            },
            Some("req_query".to_owned()),
        )
        .expect("expected query result");

        assert_eq!(
            result,
            QueryResult {
                source: Some(SourceSummary {
                    name: Some("warehouse".to_owned()),
                    display_name: None,
                    provider: Some("postgres".to_owned()),
                    queryable: Some(true),
                    status: Some("active".to_owned()),
                }),
                row_count: Some(1),
                elapsed_ms: Some(25),
                columns: Some(vec![QueryColumn {
                    name: Some("value".to_owned()),
                    logical_type: Some("number".to_owned()),
                }]),
                rows: Some(vec![vec!["42".to_owned()]]),
                truncated: Some(false),
                page: PageInfo {
                    next_cursor: None,
                    returned: 1,
                    has_more: false,
                },
                output_metadata: Some(SanitizationMetadata {
                    profile: "strict".to_owned(),
                    sanitized_paths: vec!["rows[0][0]".to_owned()],
                    raw_available: false,
                }),
            }
        );
    }

    #[test]
    fn query_validation_from_generated_maps_validate_response() {
        let validation = super::query_validation_from_generated(
            super::types::ValidateQueryResponse {
                request: buffa::MessageField::some(super::types::CliQueryCanonicalRequest {
                    sql: "SELECT 1".to_owned(),
                    parameters: vec![
                        super::types::CliQueryParameter {
                            r#type:
                                super::types::CliQueryParameterType::CLI_QUERY_PARAMETER_TYPE_STRING
                                    .into(),
                            value: Some("acme".to_owned()),
                            ..Default::default()
                        },
                        super::types::CliQueryParameter {
                            r#type:
                                super::types::CliQueryParameterType::CLI_QUERY_PARAMETER_TYPE_NULL
                                    .into(),
                            value: None,
                            ..Default::default()
                        },
                    ],
                    max_rows: Some(100),
                    max_bytes: Some(4_096),
                    cell_max_chars: Some(256),
                    timeout_ms: Some(2_500),
                    ..Default::default()
                }),
                normalized_sql: "SELECT 1".to_owned(),
                declared_result_window: buffa::MessageField::some(
                    super::types::CliDeclaredQueryResultWindow {
                        max_rows: Some(100),
                        max_bytes: Some(4_096),
                        cell_max_chars: Some(256),
                        timeout_ms: Some(2_500),
                        ..Default::default()
                    },
                ),
                source: buffa::MessageField::some(super::types::GetSourceResponse {
                    name: "warehouse".to_owned(),
                    provider: super::types::CliSourceProvider::CLI_SOURCE_PROVIDER_POSTGRES.into(),
                    queryable: true,
                    status: super::types::CliSourceStatus::CLI_SOURCE_STATUS_ACTIVE.into(),
                    ..Default::default()
                }),
                truncated: false,
                ..Default::default()
            },
            Some("req_validation".to_owned()),
        )
        .expect("expected query validation result");

        assert_eq!(
            validation,
            QueryValidationResult {
                request: Some(super::QueryCanonicalRequest {
                    sql: Some("SELECT 1".to_owned()),
                    parameters: Some(vec![
                        QueryCanonicalParameter {
                            parameter_type: QueryCanonicalParameterType::String,
                            value: Some("acme".to_owned()),
                        },
                        QueryCanonicalParameter {
                            parameter_type: QueryCanonicalParameterType::Null,
                            value: None,
                        },
                    ]),
                    max_rows: Some(100),
                    max_bytes: Some(4_096),
                    cell_max_chars: Some(256),
                    timeout_ms: Some(2_500),
                }),
                normalized_sql: Some("SELECT 1".to_owned()),
                declared_result_window: Some(QueryResultWindow {
                    max_rows: Some(100),
                    max_bytes: Some(4_096),
                    cell_max_chars: Some(256),
                    timeout_ms: Some(2_500),
                }),
                source: Some(SourceSummary {
                    name: Some("warehouse".to_owned()),
                    display_name: None,
                    provider: Some("postgres".to_owned()),
                    queryable: Some(true),
                    status: Some("active".to_owned()),
                }),
                truncated: Some(false),
            }
        );
    }

    #[test]
    fn query_validation_from_generated_requires_source_metadata() {
        let error = super::query_validation_from_generated(
            super::types::ValidateQueryResponse {
                request: buffa::MessageField::some(super::types::CliQueryCanonicalRequest {
                    sql: "SELECT 1".to_owned(),
                    ..Default::default()
                }),
                normalized_sql: "SELECT 1".to_owned(),
                declared_result_window: buffa::MessageField::some(
                    super::types::CliDeclaredQueryResultWindow {
                        max_rows: Some(100),
                        ..Default::default()
                    },
                ),
                truncated: false,
                ..Default::default()
            },
            Some("req_missing_validation_source".to_owned()),
        )
        .expect_err("expected missing source metadata to fail");

        assert_eq!(
            error,
            ApiFailure::Decode(crate::transport::api_failure::DecodeFailure {
                stage: ErrorStage::ReadQueryInput,
                message: "query validation response missing source metadata".to_owned(),
                request_id: Some("req_missing_validation_source".to_owned()),
            })
        );
    }

    #[test]
    fn query_result_from_generated_requires_page_metadata() {
        let error = super::query_result_from_generated(
            super::types::ExecuteQueryResponse {
                source: buffa::MessageField::some(super::types::GetSourceResponse {
                    name: "warehouse".to_owned(),
                    provider: super::types::CliSourceProvider::CLI_SOURCE_PROVIDER_POSTGRES.into(),
                    queryable: true,
                    status: super::types::CliSourceStatus::CLI_SOURCE_STATUS_ACTIVE.into(),
                    ..Default::default()
                }),
                row_count: 1,
                ..Default::default()
            },
            Some("req_missing_page".to_owned()),
        )
        .expect_err("expected missing page metadata to fail");

        assert_eq!(
            error,
            ApiFailure::Decode(crate::transport::api_failure::DecodeFailure {
                stage: ErrorStage::ExecuteQuery,
                message: "query execution response missing page metadata".to_owned(),
                request_id: Some("req_missing_page".to_owned()),
            })
        );
    }

    #[test]
    fn query_result_from_generated_requires_source_metadata() {
        let error = super::query_result_from_generated(
            super::types::ExecuteQueryResponse {
                page: buffa::MessageField::some(super::types::CliPage {
                    returned: 1,
                    has_more: false,
                    ..Default::default()
                }),
                row_count: 1,
                ..Default::default()
            },
            Some("req_missing_query_source".to_owned()),
        )
        .expect_err("expected missing source metadata to fail");

        assert_eq!(
            error,
            ApiFailure::Decode(crate::transport::api_failure::DecodeFailure {
                stage: ErrorStage::ExecuteQuery,
                message: "query execution response missing source metadata".to_owned(),
                request_id: Some("req_missing_query_source".to_owned()),
            })
        );
    }
}
