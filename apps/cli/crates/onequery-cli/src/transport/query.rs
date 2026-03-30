use reqwest::StatusCode;
use serde::Deserialize;
use serde::Serialize;
use onequery_cli_core::error::ErrorStage;

use crate::output_metadata::UntrustedOutputMetadata;
use crate::transport::client::AuthenticatedApiClient;
use crate::transport::generated::types;
use crate::transport::http::ApiFailure;
use crate::transport::http::ApiSuccess;
use crate::transport::http::ResponseFailureStages;
use crate::transport::http::conversion_failure;
use crate::transport::http::decode_failure;
use crate::transport::http::failure_from_generated;
use crate::transport::http::response_request_id;
use crate::transport::http::try_into_option;
use crate::transport::http::try_into_value;
use crate::transport::http::untrusted_output_metadata_from_generated;
use crate::transport::pagination::page_info_from_generated;
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
    pub(crate) output_metadata: UntrustedOutputMetadata,
}

#[derive(Debug, Clone, Deserialize, Serialize, Eq, PartialEq, Default)]
pub(crate) struct QueryParameter {
    #[serde(rename = "type")]
    pub(crate) parameter_type: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) value: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, Eq, PartialEq, Default)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct QueryRequestPayload {
    pub(crate) sql: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) parameters: Option<Vec<QueryParameter>>,
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
    pub(crate) parameters: Option<Vec<QueryParameter>>,
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

// CONTEXT: retry lifecycle belongs in command workflow state transitions.
// This adapter executes a single HTTP attempt and leaves retry policy to the caller.
#[cfg(test)]
pub(crate) async fn execute_read_only_query(
    client: &AuthenticatedApiClient,
    org: &str,
    source_key: &str,
    payload: &QueryRequestPayload,
) -> Result<ApiSuccess<QueryResult>, ApiFailure> {
    execute_read_only_query_with_controls(
        client,
        org,
        source_key,
        payload,
        &ReadRequestControls::default(),
    )
    .await
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
    let org_slug = try_into_value(org, ErrorStage::ExecuteQuery)?;
    let source_key = try_into_value(source_key, ErrorStage::ExecuteQuery)?;
    let cursor = try_into_option(controls.cursor.as_deref(), ErrorStage::ExecuteQuery)?;
    let fields = try_into_option(controls.fields.as_deref(), ErrorStage::ExecuteQuery)?;
    let body = query_request_from_payload(payload)?;
    let response = match client
        .cli()
        .cli_query_execute(
            &org_slug,
            &source_key,
            cursor.as_ref(),
            fields.as_ref(),
            controls.page_size.and_then(non_zero_u64),
            &body,
        )
        .await
    {
        Ok(response) => response,
        Err(error) => {
            return Err(failure_from_generated(
                error,
                ResponseFailureStages::from_status(
                    execute_query_problem_stage_for_status,
                    ErrorStage::ExecuteQuery,
                ),
            )
            .await);
        }
    };
    let request_id = response_request_id(response.headers());
    let payload = response.into_inner();

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
    controls: &ReadRequestControls,
) -> Result<ApiSuccess<QueryValidationResult>, ApiFailure> {
    let org_slug = try_into_value(org, ErrorStage::ReadQueryInput)?;
    let source_key = try_into_value(source_key, ErrorStage::ReadQueryInput)?;
    let fields = try_into_option(controls.fields.as_deref(), ErrorStage::ReadQueryInput)?;
    let body = query_request_from_payload(payload)?;
    let response = match client
        .cli()
        .cli_query_validate(&org_slug, &source_key, fields.as_ref(), &body)
        .await
    {
        Ok(response) => response,
        Err(error) => {
            return Err(failure_from_generated(
                error,
                ResponseFailureStages::from_status(
                    validate_query_problem_stage_for_status,
                    ErrorStage::ReadQueryInput,
                ),
            )
            .await);
        }
    };
    let request_id = response_request_id(response.headers());
    let payload = response.into_inner();

    Ok(ApiSuccess {
        payload: query_validation_from_generated(payload),
        request_id,
    })
}

fn execute_query_problem_stage_for_status(status: StatusCode) -> ErrorStage {
    if matches!(status, StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN) {
        ErrorStage::Auth
    } else {
        ErrorStage::ExecuteQuery
    }
}

fn validate_query_problem_stage_for_status(status: StatusCode) -> ErrorStage {
    if matches!(status, StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN) {
        ErrorStage::Auth
    } else {
        ErrorStage::ReadQueryInput
    }
}

fn query_request_from_payload(
    payload: &QueryRequestPayload,
) -> Result<types::CliQueryRequest, ApiFailure> {
    Ok(types::CliQueryRequest {
        parameters: payload
            .parameters
            .clone()
            .unwrap_or_default()
            .into_iter()
            .map(query_parameter_to_generated)
            .collect::<Result<Vec<_>, _>>()?,
        sql: try_into_value(payload.sql.as_str(), ErrorStage::ReadQueryInput)?,
        max_rows: payload.max_rows.and_then(non_zero_u64),
        max_bytes: payload.max_bytes.and_then(non_zero_u64),
        cell_max_chars: payload.cell_max_chars.and_then(non_zero_u64),
        timeout_ms: payload.timeout_ms.and_then(std::num::NonZeroU64::new),
    })
}

fn query_result_from_generated(
    result: types::CliQueryExecuteEnvelope,
    request_id: Option<String>,
) -> Result<QueryResult, ApiFailure> {
    let page = result.page.ok_or_else(|| {
        decode_failure(
            ErrorStage::ExecuteQuery,
            "query execution response missing page metadata",
            request_id,
        )
    })?;

    Ok(QueryResult {
        output_metadata: untrusted_output_metadata_from_generated(
            result.untrusted_paths,
            result.sanitization,
        ),
        source: result.data.source.map(source_summary_from_generated),
        row_count: result
            .data
            .row_count
            .and_then(|row_count| usize::try_from(row_count).ok()),
        elapsed_ms: result
            .data
            .elapsed_ms
            .and_then(|elapsed_ms| u64::try_from(elapsed_ms).ok()),
        columns: Some(
            result
                .data
                .columns
                .into_iter()
                .map(|column| QueryColumn {
                    name: column.name.map(Into::into),
                    logical_type: column
                        .logical_type
                        .map(|logical_type| logical_type.to_string()),
                })
                .collect(),
        ),
        rows: Some(result.data.rows),
        truncated: result.data.truncated,
        page: page_info_from_generated(page),
    })
}

fn query_validation_from_generated(
    result: types::CliQueryValidateEnvelope,
) -> QueryValidationResult {
    QueryValidationResult {
        request: result
            .data
            .request
            .map(query_canonical_request_from_generated),
        normalized_sql: result.data.normalized_sql.map(Into::into),
        declared_result_window: result
            .data
            .declared_result_window
            .map(query_result_window_from_generated),
        source: result.data.source.map(source_summary_from_generated),
        truncated: result.data.truncated,
    }
}

fn query_canonical_request_from_generated(
    request: types::CliQueryCanonicalRequest,
) -> QueryCanonicalRequest {
    QueryCanonicalRequest {
        sql: request.sql.map(Into::into),
        parameters: (!request.parameters.is_empty()).then(|| {
            request
                .parameters
                .into_iter()
                .map(query_parameter_from_generated)
                .collect()
        }),
        max_rows: request
            .max_rows
            .map(std::num::NonZeroU64::get)
            .and_then(|value| usize::try_from(value).ok()),
        max_bytes: request
            .max_bytes
            .map(std::num::NonZeroU64::get)
            .and_then(|value| usize::try_from(value).ok()),
        cell_max_chars: request
            .cell_max_chars
            .map(std::num::NonZeroU64::get)
            .and_then(|value| usize::try_from(value).ok()),
        timeout_ms: request.timeout_ms.map(std::num::NonZeroU64::get),
    }
}

fn query_result_window_from_generated(
    window: types::CliDeclaredQueryResultWindow,
) -> QueryResultWindow {
    QueryResultWindow {
        max_rows: window
            .max_rows
            .map(std::num::NonZeroU64::get)
            .and_then(|value| usize::try_from(value).ok()),
        max_bytes: window
            .max_bytes
            .map(std::num::NonZeroU64::get)
            .and_then(|value| usize::try_from(value).ok()),
        cell_max_chars: window
            .cell_max_chars
            .map(std::num::NonZeroU64::get)
            .and_then(|value| usize::try_from(value).ok()),
        timeout_ms: window.timeout_ms.map(std::num::NonZeroU64::get),
    }
}

fn query_parameter_to_generated(
    parameter: QueryParameter,
) -> Result<types::CliQueryParameter, ApiFailure> {
    let type_ = types::CliQueryParameterType::try_from(parameter.parameter_type.as_str())
        .map_err(|error| conversion_failure(ErrorStage::ReadQueryInput, error.to_string()))?;

    Ok(types::CliQueryParameter {
        type_,
        value: parameter.value,
    })
}

fn query_parameter_from_generated(parameter: types::CliQueryParameter) -> QueryParameter {
    QueryParameter {
        parameter_type: parameter.type_.to_string(),
        value: parameter.value,
    }
}

fn non_zero_u64(value: usize) -> Option<std::num::NonZeroU64> {
    u64::try_from(value)
        .ok()
        .and_then(std::num::NonZeroU64::new)
}

#[cfg(test)]
mod tests {
    use std::io::Read;
    use std::io::Write;
    use std::net::TcpListener;
    use std::sync::mpsc;
    use std::time::Duration;

    use pretty_assertions::assert_eq;
    use reqwest::StatusCode;
    use serde_json::json;
    use onequery_cli_core::error::ErrorStage;

    use crate::output_metadata::UntrustedOutputMetadata;
    use crate::transport::client::AuthenticatedApiClient;
    use crate::transport::http::ApiFailure;
    use crate::transport::http::ApiProblem;
    use crate::transport::http::ApiSuccess;
    use crate::transport::read_controls::PageInfo;
    use crate::transport::read_controls::ReadRequestControls;
    use crate::transport::source::SourceSummary;

    use super::QueryColumn;
    use super::QueryParameter;
    use super::QueryRequestPayload;
    use super::QueryResult;
    use super::QueryResultWindow;
    use super::QueryValidationResult;
    use super::execute_query_problem_stage_for_status;
    use super::execute_read_only_query;
    use super::validate_query_problem_stage_for_status;
    use super::validate_read_only_query_with_controls;

    fn paged_success_envelope(
        request_id: &str,
        data: serde_json::Value,
        page: serde_json::Value,
    ) -> String {
        json!({
            "requestId": request_id,
            "data": data,
            "page": page,
            "warnings": [],
        })
        .to_string()
    }

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
                    provider_kind: Some("postgres".to_owned()),
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
                output_metadata: UntrustedOutputMetadata::default(),
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
                        QueryParameter {
                            parameter_type: "string".to_owned(),
                            value: Some("acme".to_owned()),
                        },
                        QueryParameter {
                            parameter_type: "null".to_owned(),
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
                    provider_kind: Some("postgres".to_owned()),
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
                    status: StatusCode::BAD_GATEWAY,
                    problem_type: None,
                    title: None,
                    detail: None,
                    code: None,
                    retryable: true,
                    stage: ErrorStage::ExecuteQuery,
                    hint: None,
                    request_id: None,
                    validation_issues: Vec::new(),
                    raw_body: String::new(),
                })
                .is_retryable(),
                ApiFailure::Problem(ApiProblem {
                    status: StatusCode::BAD_REQUEST,
                    problem_type: None,
                    title: None,
                    detail: None,
                    code: None,
                    retryable: false,
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
                execute_query_problem_stage_for_status(StatusCode::UNAUTHORIZED),
                execute_query_problem_stage_for_status(StatusCode::FORBIDDEN),
                execute_query_problem_stage_for_status(StatusCode::BAD_REQUEST),
            ],
            [ErrorStage::Auth, ErrorStage::Auth, ErrorStage::ExecuteQuery,]
        );
    }

    #[test]
    fn validate_query_problem_stage_maps_auth_failures_to_auth_stage() {
        assert_eq!(
            [
                validate_query_problem_stage_for_status(StatusCode::UNAUTHORIZED),
                validate_query_problem_stage_for_status(StatusCode::FORBIDDEN),
                validate_query_problem_stage_for_status(StatusCode::BAD_REQUEST),
            ],
            [
                ErrorStage::Auth,
                ErrorStage::Auth,
                ErrorStage::ReadQueryInput
            ]
        );
    }

    #[tokio::test]
    async fn validate_query_maps_unauthorized_problem_to_auth_stage() {
        let listener =
            TcpListener::bind("127.0.0.1:0").expect("expected test TCP listener to bind");
        let address = listener
            .local_addr()
            .expect("expected test listener address");
        let expected_raw_body = serde_json::to_string(&super::types::CliProblem {
            code: super::types::CliProblemCode::NotLoggedIn,
            detail: Some("no authenticated session was found".to_owned()),
            errors: Vec::new(),
            hint: Some("login via the OneQuery web app and retry".to_owned()),
            instance: None,
            request_id: super::types::CliProblemRequestId::try_from("req_auth".to_owned())
                .expect("expected request id"),
            retry_after_ms: None,
            retryable: false,
            stage: super::types::CliProblemStage::Auth,
            status: 401,
            title: "Not Logged In".to_owned(),
            type_: "https://onequery.invalid/problems/cli/not-logged-in".to_owned(),
        })
        .expect("expected canonical problem JSON");
        let response_body = expected_raw_body.clone();

        std::thread::spawn(move || {
            let (mut stream, _) = listener
                .accept()
                .expect("expected CLI request to connect to test listener");

            let mut request_bytes = Vec::new();
            let mut chunk = [0_u8; 1024];
            loop {
                let read = stream
                    .read(&mut chunk)
                    .expect("expected request bytes from CLI");
                if read == 0 {
                    break;
                }

                request_bytes.extend_from_slice(&chunk[..read]);
                if request_bytes.windows(4).any(|window| window == b"\r\n\r\n") {
                    break;
                }
            }

            let response = format!(
                "HTTP/1.1 401 Unauthorized\r\ncontent-type: application/json\r\ncontent-length: {}\r\nx-request-id: req_auth\r\nconnection: close\r\n\r\n{}",
                response_body.len(),
                response_body
            );
            stream
                .write_all(response.as_bytes())
                .expect("expected response write to CLI");
        });

        let client = AuthenticatedApiClient::new(&format!("http://{address}"), 5, "pat_123")
            .expect("expected API client");

        let error = validate_read_only_query_with_controls(
            &client,
            "acme",
            "warehouse",
            &QueryRequestPayload {
                sql: "select 1".to_owned(),
                parameters: None,
                max_rows: None,
                max_bytes: None,
                cell_max_chars: None,
                timeout_ms: Some(2_500),
            },
            &ReadRequestControls::default(),
        )
        .await
        .expect_err("expected auth failure");

        assert_eq!(
            error,
            ApiFailure::Problem(ApiProblem {
                status: StatusCode::UNAUTHORIZED,
                problem_type: Some("https://onequery.invalid/problems/cli/not-logged-in".to_owned(),),
                title: Some("Not Logged In".to_owned()),
                detail: Some("no authenticated session was found".to_owned()),
                code: Some("not_logged_in".to_owned()),
                retryable: false,
                stage: ErrorStage::Auth,
                hint: Some("login via the OneQuery web app and retry".to_owned()),
                request_id: Some("req_auth".to_owned()),
                validation_issues: Vec::new(),
                raw_body: expected_raw_body,
            })
        );
    }

    #[tokio::test]
    async fn execute_read_only_query_posts_canonical_request() {
        let (request_line, request_body) = execute_query_request_capture(QueryRequestPayload {
            sql: "select 42".to_owned(),
            parameters: Some(vec![
                QueryParameter {
                    parameter_type: "string".to_owned(),
                    value: Some("acme".to_owned()),
                },
                QueryParameter {
                    parameter_type: "null".to_owned(),
                    value: None,
                },
            ]),
            max_rows: None,
            max_bytes: None,
            cell_max_chars: None,
            timeout_ms: Some(2500),
        })
        .await;
        let request_json =
            serde_json::from_str::<serde_json::Value>(&request_body).expect("expected JSON body");

        assert_eq!(
            (request_line, request_json),
            (
                "POST /api/cli/organizations/acme/sources/warehouse/queries:execute HTTP/1.1"
                    .to_owned(),
                json!({
                    "parameters": [
                        {"type": "string", "value": "acme"},
                        {"type": "null", "value": null},
                    ],
                    "sql": "select 42",
                    "timeoutMs": 2500,
                }),
            )
        );
    }

    #[tokio::test]
    async fn execute_read_only_query_omits_timeout_when_unset() {
        let (_, request_body) = execute_query_request_capture(QueryRequestPayload {
            sql: "select 99".to_owned(),
            parameters: None,
            max_rows: None,
            max_bytes: None,
            cell_max_chars: None,
            timeout_ms: None,
        })
        .await;
        let request_json =
            serde_json::from_str::<serde_json::Value>(&request_body).expect("expected JSON body");

        assert_eq!(
            request_json,
            json!({
                "sql": "select 99",
            })
        );
    }

    async fn execute_query_request_capture(payload: QueryRequestPayload) -> (String, String) {
        let listener =
            TcpListener::bind("127.0.0.1:0").expect("expected test TCP listener to bind");
        let address = listener
            .local_addr()
            .expect("expected test listener address");
        let (request_line_tx, request_line_rx) = mpsc::channel();
        let (request_body_tx, request_body_rx) = mpsc::channel();

        std::thread::spawn(move || {
            let (mut stream, _) = listener
                .accept()
                .expect("expected CLI request to connect to test listener");

            let mut request_bytes = Vec::new();
            let mut chunk = [0_u8; 1024];
            let header_end = loop {
                let read = stream
                    .read(&mut chunk)
                    .expect("expected request bytes from CLI");
                if read == 0 {
                    panic!("expected HTTP request before client closed connection");
                }

                request_bytes.extend_from_slice(&chunk[..read]);
                if let Some(position) = request_bytes
                    .windows(4)
                    .position(|window| window == b"\r\n\r\n")
                {
                    break position + 4;
                }
            };

            let header_bytes = &request_bytes[..header_end];
            let header_text = String::from_utf8_lossy(header_bytes).into_owned();
            let content_length = header_text
                .lines()
                .find_map(|line| {
                    let (name, value) = line.split_once(':')?;
                    if name.eq_ignore_ascii_case("content-length") {
                        return value.trim().parse::<usize>().ok();
                    }

                    None
                })
                .unwrap_or(0);

            while request_bytes.len() < header_end + content_length {
                let read = stream
                    .read(&mut chunk)
                    .expect("expected request body bytes from CLI");
                if read == 0 {
                    break;
                }

                request_bytes.extend_from_slice(&chunk[..read]);
            }

            let request_line = header_text
                .lines()
                .next()
                .expect("expected HTTP request line")
                .to_owned();
            request_line_tx
                .send(request_line)
                .expect("expected request line receiver");

            let request_body = String::from_utf8_lossy(&request_bytes[header_end..]).into_owned();
            request_body_tx
                .send(request_body)
                .expect("expected request body receiver");

            let response_body = paged_success_envelope(
                "req_query",
                json!({
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
                }),
                json!({
                    "nextCursor": null,
                    "returned": 1,
                    "hasMore": false,
                }),
            );
            let response = format!(
                "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nx-request-id: req_query\r\nconnection: close\r\n\r\n{}",
                response_body.len(),
                response_body
            );
            stream
                .write_all(response.as_bytes())
                .expect("expected response write to CLI");
        });

        let client = AuthenticatedApiClient::new(&format!("http://{address}"), 5, "pat_123")
            .expect("expected API client");

        let response = execute_read_only_query(&client, "acme", "warehouse", &payload)
            .await
            .expect("expected query response");

        assert_eq!(
            response,
            ApiSuccess {
                payload: QueryResult {
                    source: Some(SourceSummary {
                        name: Some("warehouse".to_owned()),
                        display_name: None,
                        provider_kind: Some("postgres".to_owned()),
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
                    output_metadata: UntrustedOutputMetadata::default(),
                },
                request_id: Some("req_query".to_owned()),
            }
        );

        let request_line = request_line_rx
            .recv_timeout(Duration::from_secs(2))
            .expect("expected captured request line");
        let request_body = request_body_rx
            .recv_timeout(Duration::from_secs(2))
            .expect("expected captured request body");
        (request_line, request_body)
    }
}
