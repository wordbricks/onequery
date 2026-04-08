use connectrpc::ErrorCode;
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
use crate::transport::http::ResponseFailureStages;
use crate::transport::http::TransportFailure;
use crate::transport::http::TransportFailureKind;
use crate::transport::http::decode_failure;
use crate::transport::http::failure_from_connect;
use crate::transport::http::response_request_id;
use crate::transport::labels::content_format_to_str;
use crate::transport::labels::use_source_to_str;
use crate::transport::use_source::UseSource;

#[derive(Debug, Clone, Deserialize, Serialize, Eq, PartialEq)]
pub(crate) struct UseSkill {
    pub(crate) source: String,
    pub(crate) title: String,
    pub(crate) description: String,
    pub(crate) format: String,
    pub(crate) content: String,
}

pub(crate) async fn load_use_skill<State>(
    client: &ApiClient<State>,
    source: UseSource,
    org_slug: Option<&str>,
) -> Result<ApiSuccess<UseSkill>, ApiFailure> {
    let org_slug = org_slug
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned);
    let response = match client
        .cli()
        .r#use(types::UseRequest {
            source: types::CliUseSource::from(source).into(),
            org_slug,
            ..Default::default()
        })
        .await
    {
        Ok(response) => response,
        Err(error) => {
            return Err(failure_from_connect(
                error,
                ResponseFailureStages::from_connect_code(use_problem_stage_for_code),
            ));
        }
    };
    let request_id = response_request_id(response.headers());
    let payload = response.into_owned();

    Ok(ApiSuccess {
        payload: UseSkill {
            source: use_source_to_str(payload.source),
            title: payload.title,
            description: payload.description,
            format: content_format_to_str(payload.format),
            content: payload.content,
        },
        request_id,
    })
}

// Comment: the provider relay still executes against `/api/data-sources/{source}/query`,
// which remains intentionally outside `CliService` for now.
pub(crate) async fn execute_use_input(
    client: &AuthenticatedApiClient,
    source: UseSource,
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
        connect_code: None,
        status: Some(status),
        title: Some("Use Execution Failed".to_owned()),
        detail,
        code: None,
        retryable: status.is_server_error(),
        retry_after_ms: None,
        stage,
        hint: None,
        request_id,
        validation_issues: Vec::new(),
        raw_body,
    }))
}

fn use_problem_stage_for_code(code: ErrorCode) -> ErrorStage {
    if matches!(
        code,
        ErrorCode::Unauthenticated | ErrorCode::PermissionDenied
    ) {
        ErrorStage::Auth
    } else {
        ErrorStage::ResolveSource
    }
}
