use std::time::Duration;

use buffa::EnumValue;
use buffa::MessageField;
use connectrpc::client::CallOptions;
use onequery_cli_core::error::ErrorStage;
use serde::Deserialize;
use serde::Serialize;

use crate::output_metadata::SanitizationMetadata;
use crate::transport::api_failure::ApiFailure;
use crate::transport::api_failure::ApiSuccess;
use crate::transport::api_failure::conversion_failure;
use crate::transport::api_failure::decode_failure;
use crate::transport::api_failure::failure_from_connect;
use crate::transport::api_failure::sanitization_metadata_from_generated;
use crate::transport::api_failure::success_response_request_id;
use crate::transport::api_failure::try_into_value;
use crate::transport::client::AuthenticatedApiClient;
use crate::transport::generated::types;
use crate::transport::pagination::page_info_from_generated;
use crate::transport::pagination::page_request_from_controls;
use crate::transport::read_controls::PageInfo;
use crate::transport::read_controls::ReadRequestControls;
use crate::transport::read_controls::SinglePageReadControls;
use crate::transport::response_decode::decode_required_bool;
use crate::transport::response_decode::decode_required_u32_as_usize;
use crate::transport::response_decode::require_non_empty_text;
use crate::transport::source::SourceSummary;
use crate::transport::source::source_summary_from_generated;
use crate::transport::well_known::optional_duration_from_ms;
use crate::transport::well_known::required_duration_ms;

#[derive(Debug, Clone, Deserialize, Serialize, Eq, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct QueryColumn {
    pub(crate) name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) logical_type: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, Eq, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct QueryResult {
    pub(crate) source: SourceSummary,
    pub(crate) row_count: usize,
    pub(crate) elapsed_ms: u64,
    pub(crate) columns: Vec<QueryColumn>,
    pub(crate) rows: Vec<Vec<String>>,
    pub(crate) truncated: bool,
    pub(crate) page: PageInfo,
    #[serde(skip)]
    pub(crate) output_metadata: Option<SanitizationMetadata>,
}

#[derive(Debug, Clone, Deserialize, Serialize, Eq, PartialEq, Default)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct QueryRequestPayload {
    pub(crate) sql: String,
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
pub(crate) struct QueryRequestWindow {
    pub(crate) max_rows: Option<usize>,
    pub(crate) max_bytes: Option<usize>,
    pub(crate) cell_max_chars: Option<usize>,
    pub(crate) timeout_ms: Option<u64>,
}

#[derive(Debug, Clone, Deserialize, Serialize, Eq, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct QueryCanonicalRequest {
    pub(crate) sql: String,
    pub(crate) max_rows: usize,
    pub(crate) max_bytes: usize,
    pub(crate) cell_max_chars: usize,
    pub(crate) timeout_ms: u64,
}

#[derive(Debug, Clone, Deserialize, Serialize, Eq, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DeclaredQueryResultWindow {
    pub(crate) max_rows: usize,
    pub(crate) max_bytes: usize,
    pub(crate) cell_max_chars: usize,
    pub(crate) timeout_ms: u64,
}

#[derive(Debug, Clone, Deserialize, Serialize, Eq, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct QueryValidationResult {
    pub(crate) request: QueryCanonicalRequest,
    pub(crate) normalized_sql: String,
    pub(crate) declared_result_window: DeclaredQueryResultWindow,
    pub(crate) source: SourceSummary,
    pub(crate) sql_normalized: bool,
}

pub(crate) async fn execute_read_only_query_with_controls(
    client: &AuthenticatedApiClient,
    org: &str,
    source_key: &str,
    payload: &QueryRequestPayload,
    controls: &ReadRequestControls,
    request_timeout: Duration,
) -> Result<ApiSuccess<QueryResult>, ApiFailure> {
    let response = fetch_query_page(
        client,
        org,
        source_key,
        payload,
        controls.single_page(),
        request_timeout,
    )
    .await?;

    if !controls.page_all {
        return Ok(response);
    }

    let request_id = response.request_id.clone();
    let mut aggregated = response.payload;
    let mut total_returned = aggregated.page.returned_count;
    let mut next_cursor = aggregated.page.next_cursor.clone();

    while let Some(cursor) = next_cursor {
        let next_response = fetch_query_page(
            client,
            org,
            source_key,
            payload,
            controls.with_cursor(Some(cursor)),
            request_timeout,
        )
        .await?;
        total_returned += next_response.payload.page.returned_count;
        aggregated.rows.extend(next_response.payload.rows);
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
    request_timeout: Duration,
) -> Result<ApiSuccess<QueryResult>, ApiFailure> {
    let org_slug: String = try_into_value(org, ErrorStage::ExecuteQuery)?;
    let source_key: String = try_into_value(source_key, ErrorStage::ExecuteQuery)?;
    let page = page_request_from_controls(controls, ErrorStage::ExecuteQuery)?;
    let query = query_request_from_payload(payload)?;
    let response = match client
        .query()
        .execute_query_with_options(
            types::ExecuteQueryRequest {
                org_slug: Some(org_slug),
                source_key: Some(source_key),
                page,
                query: MessageField::some(query),
                ..Default::default()
            },
            CallOptions::default().with_timeout(request_timeout),
        )
        .await
    {
        Ok(response) => response,
        Err(error) => {
            return Err(failure_from_connect(error, ErrorStage::ExecuteQuery));
        }
    };
    let request_id = success_response_request_id(&response);
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
    request_timeout: Duration,
) -> Result<ApiSuccess<QueryValidationResult>, ApiFailure> {
    let org_slug: String = try_into_value(org, ErrorStage::ReadQueryInput)?;
    let source_key: String = try_into_value(source_key, ErrorStage::ReadQueryInput)?;
    let query = query_request_from_payload(payload)?;
    let response = match client
        .query()
        .validate_query_with_options(
            types::ValidateQueryRequest {
                org_slug: Some(org_slug),
                source_key: Some(source_key),
                query: MessageField::some(query),
                ..Default::default()
            },
            CallOptions::default().with_timeout(request_timeout),
        )
        .await
    {
        Ok(response) => response,
        Err(error) => {
            return Err(failure_from_connect(error, ErrorStage::ReadQueryInput));
        }
    };
    let request_id = success_response_request_id(&response);
    let payload = response.into_owned();

    Ok(ApiSuccess {
        payload: query_validation_from_generated(payload, request_id.clone())?,
        request_id,
    })
}

fn query_request_from_payload(
    payload: &QueryRequestPayload,
) -> Result<types::CliQueryRequest, ApiFailure> {
    Ok(types::CliQueryRequest {
        sql: Some(try_into_value(
            payload.sql.as_str(),
            ErrorStage::ReadQueryInput,
        )?),
        max_rows: optional_query_bound(payload.max_rows, ErrorStage::ReadQueryInput)?,
        max_bytes: optional_query_bound(payload.max_bytes, ErrorStage::ReadQueryInput)?,
        cell_max_chars: optional_query_bound(payload.cell_max_chars, ErrorStage::ReadQueryInput)?,
        timeout: optional_query_timeout(payload.timeout_ms, ErrorStage::ReadQueryInput)?,
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
            request_id.clone(),
        )
    })?;

    Ok(QueryResult {
        output_metadata: sanitization_metadata_from_generated(result.sanitization.into_option()),
        source: source_summary_from_generated(
            source,
            ErrorStage::ExecuteQuery,
            request_id.clone(),
        )?,
        row_count: decode_required_u32_as_usize(
            result.row_count,
            ErrorStage::ExecuteQuery,
            "query execution response missing row count",
            request_id.clone(),
        )?,
        elapsed_ms: required_duration_ms(
            result.elapsed,
            ErrorStage::ExecuteQuery,
            "query execution response missing elapsed time",
            request_id.clone(),
        )?,
        columns: result
            .columns
            .into_iter()
            .map(|column| {
                Ok(QueryColumn {
                    name: require_non_empty_text(
                        column.name,
                        ErrorStage::ExecuteQuery,
                        "query execution response included a column without a name",
                        request_id.clone(),
                    )?,
                    logical_type: Some(query_logical_type_from_generated(
                        column.logical_type,
                        request_id.clone(),
                    )?),
                })
            })
            .collect::<Result<Vec<_>, ApiFailure>>()?,
        rows: result
            .rows
            .into_iter()
            .map(|row| row.display_values)
            .collect(),
        truncated: decode_required_bool(
            result.truncated,
            ErrorStage::ExecuteQuery,
            "query execution response missing truncated flag",
            request_id,
        )?,
        page: page_info_from_generated(page),
    })
}

fn query_logical_type_from_generated(
    value: Option<EnumValue<types::QueryLogicalType>>,
    request_id: Option<String>,
) -> Result<String, ApiFailure> {
    match value {
        Some(value) => match value.as_known() {
            Some(types::QueryLogicalType::QUERY_LOGICAL_TYPE_STRING) => Ok("string".to_owned()),
            Some(types::QueryLogicalType::QUERY_LOGICAL_TYPE_NUMBER) => Ok("number".to_owned()),
            Some(types::QueryLogicalType::QUERY_LOGICAL_TYPE_BOOLEAN) => Ok("boolean".to_owned()),
            Some(types::QueryLogicalType::QUERY_LOGICAL_TYPE_BIGINT) => Ok("bigint".to_owned()),
            Some(types::QueryLogicalType::QUERY_LOGICAL_TYPE_DATETIME) => Ok("datetime".to_owned()),
            Some(types::QueryLogicalType::QUERY_LOGICAL_TYPE_ARRAY) => Ok("array".to_owned()),
            Some(types::QueryLogicalType::QUERY_LOGICAL_TYPE_JSON) => Ok("json".to_owned()),
            Some(types::QueryLogicalType::QUERY_LOGICAL_TYPE_UNKNOWN) => Ok("unknown".to_owned()),
            Some(types::QueryLogicalType::QUERY_LOGICAL_TYPE_UNSPECIFIED) | None => {
                Err(decode_failure(
                    ErrorStage::ExecuteQuery,
                    "query execution response column has invalid logical type",
                    request_id,
                ))
            }
        },
        None => Err(decode_failure(
            ErrorStage::ExecuteQuery,
            "query execution response column missing logical type",
            request_id,
        )),
    }
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
            request_id.clone(),
        )
    })?;

    Ok(QueryValidationResult {
        request: query_canonical_request_from_generated(
            request,
            ErrorStage::ReadQueryInput,
            request_id.clone(),
        )?,
        normalized_sql: require_non_empty_text(
            result.normalized_sql,
            ErrorStage::ReadQueryInput,
            "query validation response missing normalized SQL",
            request_id.clone(),
        )?,
        declared_result_window: declared_query_result_window_from_generated(
            declared_result_window,
            ErrorStage::ReadQueryInput,
            request_id.clone(),
        )?,
        source: source_summary_from_generated(
            source,
            ErrorStage::ReadQueryInput,
            request_id.clone(),
        )?,
        sql_normalized: decode_required_bool(
            result.sql_normalized,
            ErrorStage::ReadQueryInput,
            "query validation response missing SQL normalization flag",
            request_id,
        )?,
    })
}

fn query_canonical_request_from_generated(
    request: types::CliQueryCanonicalRequest,
    stage: ErrorStage,
    request_id: Option<String>,
) -> Result<QueryCanonicalRequest, ApiFailure> {
    Ok(QueryCanonicalRequest {
        sql: require_non_empty_text(
            request.sql,
            stage,
            "query validation response missing canonical SQL",
            request_id.clone(),
        )?,
        max_rows: decode_required_u32_as_usize(
            request.max_rows,
            stage,
            "query validation response missing request maxRows",
            request_id.clone(),
        )?,
        max_bytes: decode_required_u32_as_usize(
            request.max_bytes,
            stage,
            "query validation response missing request maxBytes",
            request_id.clone(),
        )?,
        cell_max_chars: decode_required_u32_as_usize(
            request.cell_max_chars,
            stage,
            "query validation response missing request cellMaxChars",
            request_id.clone(),
        )?,
        timeout_ms: required_duration_ms(
            request.timeout,
            stage,
            "query validation response missing request timeout",
            request_id,
        )?,
    })
}

fn declared_query_result_window_from_generated(
    window: types::CliDeclaredQueryResultWindow,
    stage: ErrorStage,
    request_id: Option<String>,
) -> Result<DeclaredQueryResultWindow, ApiFailure> {
    Ok(DeclaredQueryResultWindow {
        max_rows: decode_required_u32_as_usize(
            window.max_rows,
            stage,
            "query validation response missing declared maxRows",
            request_id.clone(),
        )?,
        max_bytes: decode_required_u32_as_usize(
            window.max_bytes,
            stage,
            "query validation response missing declared maxBytes",
            request_id.clone(),
        )?,
        cell_max_chars: decode_required_u32_as_usize(
            window.cell_max_chars,
            stage,
            "query validation response missing declared cellMaxChars",
            request_id.clone(),
        )?,
        timeout_ms: required_duration_ms(
            window.timeout,
            stage,
            "query validation response missing declared timeout",
            request_id,
        )?,
    })
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

fn optional_query_timeout(
    value: Option<u64>,
    stage: ErrorStage,
) -> Result<MessageField<buffa_types::google::protobuf::Duration>, ApiFailure> {
    if matches!(value, Some(0)) {
        return Err(conversion_failure(
            stage,
            "timeout must be greater than zero",
        ));
    }

    optional_duration_from_ms(value, stage)
}

#[cfg(test)]
mod tests {
    use onequery_cli_core::error::ErrorStage;
    use pretty_assertions::assert_eq;
    use serde_json::json;

    use super::DeclaredQueryResultWindow;
    use super::QueryColumn;
    use super::QueryRequestPayload;
    use super::QueryResult;
    use super::QueryValidationResult;
    use crate::output_metadata::SanitizationMetadata;
    use crate::transport::api_failure::ApiFailure;
    use crate::transport::api_failure::ApiProblem;
    use crate::transport::api_failure::ApiProblemReason;
    use crate::transport::read_controls::PageInfo;
    use crate::transport::source::SourceSummary;

    fn duration_ms(value: u64) -> buffa_types::google::protobuf::Duration {
        buffa_types::google::protobuf::Duration {
            seconds: i64::try_from(value / 1_000).expect("test duration seconds fit in i64"),
            nanos: i32::try_from((value % 1_000) * 1_000_000)
                .expect("test duration nanos fit in i32"),
            ..Default::default()
        }
    }

    #[test]
    fn query_result_deserializes_canonical_shape() {
        let payload = json!({
            "source": {
                "sourceKey": "warehouse",
                "provider": "postgres",
                "status": "active",
                "interfaces": ["query"]
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
                "returnedCount": 1
            }
        });

        let parsed = serde_json::from_value::<QueryResult>(payload)
            .expect("canonical query result should deserialize");

        assert_eq!(
            parsed,
            QueryResult {
                source: SourceSummary {
                    source_key: "warehouse".to_owned(),
                    display_name: None,
                    provider: "postgres".to_owned(),
                    status: "active".to_owned(),
                    interfaces: vec!["query".to_owned()],
                },
                row_count: 1,
                elapsed_ms: 25,
                columns: vec![QueryColumn {
                    name: "value".to_owned(),
                    logical_type: Some("number".to_owned()),
                }],
                rows: vec![vec!["42".to_owned()]],
                truncated: false,
                page: PageInfo {
                    next_cursor: None,
                    returned_count: 1,
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
                "sourceKey": "warehouse",
                "provider": "postgres",
                "status": "active",
                "interfaces": ["query"]
            },
            "sqlNormalized": false
        });

        let parsed = serde_json::from_value::<QueryValidationResult>(payload)
            .expect("canonical query validation payload should deserialize");

        assert_eq!(
            parsed,
            QueryValidationResult {
                request: super::QueryCanonicalRequest {
                    sql: "SELECT 1".to_owned(),
                    max_rows: 100,
                    max_bytes: 4096,
                    cell_max_chars: 256,
                    timeout_ms: 2500,
                },
                normalized_sql: "SELECT 1".to_owned(),
                declared_result_window: DeclaredQueryResultWindow {
                    max_rows: 100,
                    max_bytes: 4096,
                    cell_max_chars: 256,
                    timeout_ms: 2500,
                },
                source: SourceSummary {
                    source_key: "warehouse".to_owned(),
                    display_name: None,
                    provider: "postgres".to_owned(),
                    status: "active".to_owned(),
                    interfaces: vec!["query".to_owned()],
                },
                sql_normalized: false,
            }
        );
    }

    #[test]
    fn retryable_status_only_matches_transient_gateway_failures() {
        assert_eq!(
            [
                ApiFailure::Problem(ApiProblem {
                    reason: ApiProblemReason::from_static("QUERY_EXECUTION_UNAVAILABLE"),
                    server_message: "query execution is temporarily unavailable".to_owned(),
                    retryable: true,
                    retry_after_ms: None,
                    stage: ErrorStage::ExecuteQuery,
                    request_id: None,
                    validation_issues: Vec::new(),
                    resource: None,
                })
                .is_retryable(),
                ApiFailure::Problem(ApiProblem {
                    reason: ApiProblemReason::from_static("EXECUTE_QUERY_REQUEST_INVALID"),
                    server_message: "query request is invalid".to_owned(),
                    retryable: false,
                    retry_after_ms: None,
                    stage: ErrorStage::ExecuteQuery,
                    request_id: None,
                    validation_issues: Vec::new(),
                    resource: None,
                })
                .is_retryable(),
            ],
            [true, false]
        );
    }

    #[test]
    fn query_request_from_payload_maps_connect_request() {
        let request = super::query_request_from_payload(&QueryRequestPayload {
            sql: "select 42".to_owned(),
            max_rows: Some(100),
            max_bytes: Some(4_096),
            cell_max_chars: Some(256),
            timeout_ms: Some(2_500),
        })
        .expect("expected canonical query request");

        assert_eq!(
            request,
            super::types::CliQueryRequest {
                sql: Some("select 42".to_owned()),
                max_rows: Some(100),
                max_bytes: Some(4_096),
                cell_max_chars: Some(256),
                timeout: buffa::MessageField::some(duration_ms(2_500)),
                ..Default::default()
            }
        );
    }

    #[test]
    fn query_result_from_generated_maps_execute_response() {
        let result = super::query_result_from_generated(
            super::types::ExecuteQueryResponse {
                source: buffa::MessageField::some(super::types::CliSource {
                    source_key: Some("warehouse".to_owned()),
                    provider: Some(super::types::SourceProvider::SOURCE_PROVIDER_POSTGRES.into()),
                    status: Some(super::types::SourceStatus::SOURCE_STATUS_ACTIVE.into()),
                    interfaces: vec![super::types::SourceInterface::SOURCE_INTERFACE_QUERY.into()],
                    ..Default::default()
                }),
                row_count: Some(1),
                elapsed: buffa::MessageField::some(duration_ms(25)),
                columns: vec![super::types::CliQueryColumn {
                    name: Some("value".to_owned()),
                    logical_type: Some(
                        super::types::QueryLogicalType::QUERY_LOGICAL_TYPE_NUMBER.into(),
                    ),
                    ..Default::default()
                }],
                rows: vec![super::types::CliQueryRow {
                    display_values: vec!["42".to_owned()],
                    ..Default::default()
                }],
                truncated: Some(false),
                page: buffa::MessageField::some(super::types::CliPage {
                    returned_count: Some(1),
                    ..Default::default()
                }),
                sanitization: buffa::MessageField::some(super::types::CliSanitization {
                    profile: Some("strict".to_owned()),
                    sanitized_paths: vec!["rows[0][0]".to_owned()],
                    raw_available: Some(false),
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
                source: SourceSummary {
                    source_key: "warehouse".to_owned(),
                    display_name: None,
                    provider: "postgres".to_owned(),
                    status: "active".to_owned(),
                    interfaces: vec!["query".to_owned()],
                },
                row_count: 1,
                elapsed_ms: 25,
                columns: vec![QueryColumn {
                    name: "value".to_owned(),
                    logical_type: Some("number".to_owned()),
                }],
                rows: vec![vec!["42".to_owned()]],
                truncated: false,
                page: PageInfo {
                    next_cursor: None,
                    returned_count: 1,
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
    fn query_result_from_generated_rejects_missing_column_logical_type() {
        let error = super::query_result_from_generated(
            super::types::ExecuteQueryResponse {
                source: buffa::MessageField::some(super::types::CliSource {
                    source_key: Some("warehouse".to_owned()),
                    provider: Some(super::types::SourceProvider::SOURCE_PROVIDER_POSTGRES.into()),
                    status: Some(super::types::SourceStatus::SOURCE_STATUS_ACTIVE.into()),
                    interfaces: vec![super::types::SourceInterface::SOURCE_INTERFACE_QUERY.into()],
                    ..Default::default()
                }),
                row_count: Some(1),
                elapsed: buffa::MessageField::some(duration_ms(25)),
                columns: vec![super::types::CliQueryColumn {
                    name: Some("value".to_owned()),
                    ..Default::default()
                }],
                truncated: Some(false),
                page: buffa::MessageField::some(super::types::CliPage {
                    returned_count: Some(1),
                    ..Default::default()
                }),
                ..Default::default()
            },
            Some("req_column_type".to_owned()),
        )
        .expect_err("expected missing logical type to fail");

        assert_eq!(
            error,
            ApiFailure::Decode(crate::transport::api_failure::DecodeFailure {
                stage: ErrorStage::ExecuteQuery,
                message: "query execution response column missing logical type".to_owned(),
                request_id: Some("req_column_type".to_owned()),
            })
        );
    }

    #[test]
    fn query_validation_from_generated_maps_validate_response() {
        let validation = super::query_validation_from_generated(
            super::types::ValidateQueryResponse {
                request: buffa::MessageField::some(super::types::CliQueryCanonicalRequest {
                    sql: Some("SELECT 1".to_owned()),
                    max_rows: Some(100),
                    max_bytes: Some(4_096),
                    cell_max_chars: Some(256),
                    timeout: buffa::MessageField::some(duration_ms(2_500)),
                    ..Default::default()
                }),
                normalized_sql: Some("SELECT 1".to_owned()),
                declared_result_window: buffa::MessageField::some(
                    super::types::CliDeclaredQueryResultWindow {
                        max_rows: Some(100),
                        max_bytes: Some(4_096),
                        cell_max_chars: Some(256),
                        timeout: buffa::MessageField::some(duration_ms(2_500)),
                        ..Default::default()
                    },
                ),
                source: buffa::MessageField::some(super::types::CliSource {
                    source_key: Some("warehouse".to_owned()),
                    provider: Some(super::types::SourceProvider::SOURCE_PROVIDER_POSTGRES.into()),
                    status: Some(super::types::SourceStatus::SOURCE_STATUS_ACTIVE.into()),
                    interfaces: vec![super::types::SourceInterface::SOURCE_INTERFACE_QUERY.into()],
                    ..Default::default()
                }),
                sql_normalized: Some(false),
                ..Default::default()
            },
            Some("req_validation".to_owned()),
        )
        .expect("expected query validation result");

        assert_eq!(
            validation,
            QueryValidationResult {
                request: super::QueryCanonicalRequest {
                    sql: "SELECT 1".to_owned(),
                    max_rows: 100,
                    max_bytes: 4_096,
                    cell_max_chars: 256,
                    timeout_ms: 2_500,
                },
                normalized_sql: "SELECT 1".to_owned(),
                declared_result_window: DeclaredQueryResultWindow {
                    max_rows: 100,
                    max_bytes: 4_096,
                    cell_max_chars: 256,
                    timeout_ms: 2_500,
                },
                source: SourceSummary {
                    source_key: "warehouse".to_owned(),
                    display_name: None,
                    provider: "postgres".to_owned(),
                    status: "active".to_owned(),
                    interfaces: vec!["query".to_owned()],
                },
                sql_normalized: false,
            }
        );
    }

    #[test]
    fn query_validation_from_generated_requires_source_metadata() {
        let error = super::query_validation_from_generated(
            super::types::ValidateQueryResponse {
                request: buffa::MessageField::some(super::types::CliQueryCanonicalRequest {
                    sql: Some("SELECT 1".to_owned()),
                    ..Default::default()
                }),
                normalized_sql: Some("SELECT 1".to_owned()),
                declared_result_window: buffa::MessageField::some(
                    super::types::CliDeclaredQueryResultWindow {
                        max_rows: Some(100),
                        ..Default::default()
                    },
                ),
                sql_normalized: Some(false),
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
                source: buffa::MessageField::some(super::types::CliSource {
                    source_key: Some("warehouse".to_owned()),
                    provider: Some(super::types::SourceProvider::SOURCE_PROVIDER_POSTGRES.into()),
                    status: Some(super::types::SourceStatus::SOURCE_STATUS_ACTIVE.into()),
                    interfaces: vec![super::types::SourceInterface::SOURCE_INTERFACE_QUERY.into()],
                    ..Default::default()
                }),
                row_count: Some(1),
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
    fn query_result_from_generated_requires_truncated_flag() {
        let error = super::query_result_from_generated(
            super::types::ExecuteQueryResponse {
                source: buffa::MessageField::some(super::types::CliSource {
                    source_key: Some("warehouse".to_owned()),
                    provider: Some(super::types::SourceProvider::SOURCE_PROVIDER_POSTGRES.into()),
                    status: Some(super::types::SourceStatus::SOURCE_STATUS_ACTIVE.into()),
                    interfaces: vec![super::types::SourceInterface::SOURCE_INTERFACE_QUERY.into()],
                    ..Default::default()
                }),
                row_count: Some(1),
                elapsed: buffa::MessageField::some(duration_ms(25)),
                page: buffa::MessageField::some(super::types::CliPage {
                    returned_count: Some(1),
                    ..Default::default()
                }),
                ..Default::default()
            },
            Some("req_missing_truncated".to_owned()),
        )
        .expect_err("expected missing truncated flag to fail");

        assert_eq!(
            error,
            ApiFailure::Decode(crate::transport::api_failure::DecodeFailure {
                stage: ErrorStage::ExecuteQuery,
                message: "query execution response missing truncated flag".to_owned(),
                request_id: Some("req_missing_truncated".to_owned()),
            })
        );
    }

    #[test]
    fn query_result_from_generated_requires_source_metadata() {
        let error = super::query_result_from_generated(
            super::types::ExecuteQueryResponse {
                page: buffa::MessageField::some(super::types::CliPage {
                    returned_count: Some(1),
                    ..Default::default()
                }),
                row_count: Some(1),
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

    #[test]
    fn query_validation_from_generated_requires_sql_normalized_flag() {
        let error = super::query_validation_from_generated(
            super::types::ValidateQueryResponse {
                request: buffa::MessageField::some(super::types::CliQueryCanonicalRequest {
                    sql: Some("SELECT 1".to_owned()),
                    max_rows: Some(100),
                    max_bytes: Some(4_096),
                    cell_max_chars: Some(256),
                    timeout: buffa::MessageField::some(duration_ms(2_500)),
                    ..Default::default()
                }),
                normalized_sql: Some("SELECT 1".to_owned()),
                declared_result_window: buffa::MessageField::some(
                    super::types::CliDeclaredQueryResultWindow {
                        max_rows: Some(100),
                        max_bytes: Some(4_096),
                        cell_max_chars: Some(256),
                        timeout: buffa::MessageField::some(duration_ms(2_500)),
                        ..Default::default()
                    },
                ),
                source: buffa::MessageField::some(super::types::CliSource {
                    source_key: Some("warehouse".to_owned()),
                    provider: Some(super::types::SourceProvider::SOURCE_PROVIDER_POSTGRES.into()),
                    status: Some(super::types::SourceStatus::SOURCE_STATUS_ACTIVE.into()),
                    interfaces: vec![super::types::SourceInterface::SOURCE_INTERFACE_QUERY.into()],
                    ..Default::default()
                }),
                ..Default::default()
            },
            Some("req_missing_validation_truncated".to_owned()),
        )
        .expect_err("expected missing SQL normalization flag to fail");

        assert_eq!(
            error,
            ApiFailure::Decode(crate::transport::api_failure::DecodeFailure {
                stage: ErrorStage::ReadQueryInput,
                message: "query validation response missing SQL normalization flag".to_owned(),
                request_id: Some("req_missing_validation_truncated".to_owned()),
            })
        );
    }
}
