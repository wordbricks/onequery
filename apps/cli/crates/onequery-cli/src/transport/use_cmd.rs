use onequery_cli_core::error::ErrorStage;
use reqwest::StatusCode;
use serde::Deserialize;
use serde::Serialize;
use serde_json::Map;
use serde_json::Value;

use crate::transport::client::ApiClient;
use crate::transport::client::AuthenticatedApiClient;
use crate::transport::generated::types;
use crate::transport::http::ApiFailure;
use crate::transport::http::ApiProblem;
use crate::transport::http::ApiSuccess;
use crate::transport::http::TransportFailure;
use crate::transport::http::TransportFailureKind;
use crate::transport::http::decode_failure;
use crate::transport::http::parse_problem_response;
use crate::transport::http::response_request_id;
use crate::transport::http::try_into_value;

const CLI_USE_ORG_HEADER: &str = "x-onequery-org-slug";

#[derive(Debug, Clone, Deserialize, Serialize, Eq, PartialEq)]
pub(crate) struct UseSkill {
    pub(crate) source: String,
    pub(crate) title: String,
    pub(crate) description: String,
    pub(crate) format: String,
    pub(crate) content: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UseSkillEnvelope {
    data: UseSkill,
    request_id: Option<String>,
}

pub(crate) async fn load_use_skill<State>(
    client: &ApiClient<State>,
    source: &str,
    org_slug: Option<&str>,
) -> Result<ApiSuccess<UseSkill>, ApiFailure> {
    let source: types::CliUseSource = try_into_value(source, ErrorStage::ResolveSource)?;
    let source_query = source.to_string();
    let url = client.app_url("/api/cli/use");
    let mut request = client
        .http()
        .get(url)
        .query(&[("source", source_query.as_str())]);

    if let Some(org_slug) = org_slug.map(str::trim).filter(|value| !value.is_empty()) {
        request = request.header(CLI_USE_ORG_HEADER, org_slug);
    }

    let response = request.send().await.map_err(|error| {
        ApiFailure::Transport(TransportFailure {
            kind: TransportFailureKind::SendRequest,
            stage: ErrorStage::Http,
            message: error.to_string(),
            retryable: error.is_connect() || error.is_timeout(),
        })
    })?;
    let request_id = response_request_id(response.headers());
    let status = response.status();
    let body = response.bytes().await.map_err(|error| {
        ApiFailure::Transport(TransportFailure {
            kind: TransportFailureKind::ReadResponseBody,
            stage: ErrorStage::Http,
            message: error.to_string(),
            retryable: error.is_connect() || error.is_timeout(),
        })
    })?;

    if !status.is_success() {
        return Err(ApiFailure::Problem(parse_problem_response(
            status,
            request_id,
            &body,
            ErrorStage::ResolveSource,
        )));
    }

    let payload = serde_json::from_slice::<UseSkillEnvelope>(&body)
        .map_err(|error| decode_failure(ErrorStage::Http, error.to_string(), request_id.clone()))?;

    Ok(ApiSuccess {
        payload: payload.data,
        request_id: payload.request_id.or(request_id),
    })
}

pub(crate) async fn execute_use_input(
    client: &AuthenticatedApiClient,
    source: &str,
    organization_slug: &str,
    mut input: Map<String, Value>,
) -> Result<ApiSuccess<Value>, ApiFailure> {
    input.insert(
        "organizationSlug".to_owned(),
        Value::String(organization_slug.to_owned()),
    );

    let url = client.app_url(format!("/api/data-sources/{source}/query").as_str());
    let response = client
        .http()
        .post(url)
        .json(&Value::Object(input))
        .send()
        .await
        .map_err(|error| {
            ApiFailure::Transport(TransportFailure {
                kind: TransportFailureKind::SendRequest,
                stage: ErrorStage::ExecuteQuery,
                message: error.to_string(),
                retryable: error.is_connect() || error.is_timeout(),
            })
        })?;

    let request_id = response_request_id(response.headers());
    let status = response.status();
    let body = response.bytes().await.map_err(|error| {
        ApiFailure::Transport(TransportFailure {
            kind: TransportFailureKind::ReadResponseBody,
            stage: ErrorStage::ExecuteQuery,
            message: error.to_string(),
            retryable: error.is_connect() || error.is_timeout(),
        })
    })?;

    if status.is_success() {
        let payload = serde_json::from_slice::<Value>(&body).map_err(|error| {
            decode_failure(
                ErrorStage::ExecuteQuery,
                error.to_string(),
                request_id.clone(),
            )
        })?;
        return Ok(ApiSuccess {
            payload,
            request_id,
        });
    }

    let raw_body = String::from_utf8_lossy(&body).into_owned();
    let parsed = serde_json::from_slice::<Value>(&body).ok();
    let detail = parsed
        .as_ref()
        .and_then(|value| value.get("error"))
        .and_then(Value::as_str)
        .map(ToOwned::to_owned)
        .or_else(|| {
            parsed
                .as_ref()
                .and_then(|value| value.get("detail"))
                .and_then(Value::as_str)
                .map(ToOwned::to_owned)
        })
        .or_else(|| (!raw_body.trim().is_empty()).then_some(raw_body.clone()));

    let stage = if matches!(status, StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN) {
        ErrorStage::Auth
    } else {
        ErrorStage::ExecuteQuery
    };

    Err(ApiFailure::Problem(ApiProblem {
        status,
        problem_type: None,
        title: Some("Use Execution Failed".to_owned()),
        detail,
        code: None,
        retryable: status.is_server_error(),
        stage,
        hint: None,
        request_id,
        validation_issues: Vec::new(),
        raw_body,
    }))
}
