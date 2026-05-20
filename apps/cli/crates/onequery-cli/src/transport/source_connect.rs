use onequery_core::error::ErrorStage;
use onequery_source_connect_cli::SourceConnectProtoError;
use onequery_source_connect_cli::SourceConnectProvider;
use onequery_source_connect_cli::connect_source_request_from_input;
use onequery_source_connect_cli::get_source_connect_guide_request;
use onequery_source_connect_cli::source_connect_guide_from_generated;
use onequery_source_connect_cli::source_connect_result_from_generated;
use serde_json::Map;
use serde_json::Value;

use crate::transport::api_failure::ApiFailure;
use crate::transport::api_failure::ApiSuccess;
use crate::transport::api_failure::conversion_failure;
use crate::transport::api_failure::decode_failure;
use crate::transport::api_failure::failure_from_connect;
use crate::transport::api_failure::success_response_request_id;
use crate::transport::client::AuthenticatedApiClient;

pub(crate) use onequery_source_connect_cli::SourceConnectGuide;
pub(crate) use onequery_source_connect_cli::SourceConnectResult;

pub(crate) async fn load_source_connect_guide(
    client: &AuthenticatedApiClient,
    org_slug: &str,
    source: SourceConnectProvider,
) -> Result<ApiSuccess<SourceConnectGuide>, ApiFailure> {
    let response = match client
        .source()
        .get_source_connect_guide(get_source_connect_guide_request(org_slug, &source))
        .await
    {
        Ok(response) => response,
        Err(error) => {
            return Err(failure_from_connect(error, ErrorStage::ResolveSource));
        }
    };

    let request_id = success_response_request_id(&response);
    let payload = response.into_owned();

    Ok(ApiSuccess {
        payload: source_connect_guide_from_generated(payload, request_id.clone())
            .map_err(api_failure_from_source_connect_proto_error)?,
        request_id,
    })
}

pub(crate) async fn connect_source(
    client: &AuthenticatedApiClient,
    org_slug: &str,
    source: &SourceConnectProvider,
    input: Map<String, Value>,
) -> Result<ApiSuccess<SourceConnectResult>, ApiFailure> {
    let request = connect_source_request_from_input(org_slug, source, input)
        .map_err(api_failure_from_source_connect_proto_error)?;
    let response = match client.source().connect_source(request).await {
        Ok(response) => response,
        Err(error) => {
            return Err(failure_from_connect(error, ErrorStage::ResolveSource));
        }
    };

    let request_id = success_response_request_id(&response);
    let payload = response.into_owned();

    Ok(ApiSuccess {
        payload: source_connect_result_from_generated(payload, request_id.clone())
            .map_err(api_failure_from_source_connect_proto_error)?,
        request_id,
    })
}

fn api_failure_from_source_connect_proto_error(error: SourceConnectProtoError) -> ApiFailure {
    match error {
        SourceConnectProtoError::Conversion(message) => {
            conversion_failure(ErrorStage::ResolveSource, message)
        }
        SourceConnectProtoError::Decode {
            message,
            request_id,
        } => decode_failure(ErrorStage::ResolveSource, message, request_id),
    }
}
