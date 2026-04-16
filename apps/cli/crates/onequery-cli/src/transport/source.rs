use buffa::EnumValue;
use onequery_cli_core::error::ErrorStage;
use serde::Deserialize;
use serde::Serialize;

use crate::transport::api_failure::ApiFailure;
use crate::transport::api_failure::ApiSuccess;
use crate::transport::api_failure::decode_failure;
use crate::transport::api_failure::failure_from_connect;
use crate::transport::api_failure::response_request_id;
use crate::transport::api_failure::try_into_option;
use crate::transport::api_failure::try_into_value;
use crate::transport::client::AuthenticatedApiClient;
use crate::transport::generated::types;
use crate::transport::labels::source_provider_to_str;
use crate::transport::labels::source_status_to_str;
use crate::transport::pagination::optional_page_size;
use crate::transport::pagination::page_info_from_generated;
use crate::transport::read_controls::PageInfo;
use crate::transport::read_controls::ReadRequestControls;
use crate::transport::read_controls::SinglePageReadControls;

#[derive(Debug, Clone, Deserialize, Serialize, Eq, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SourceSummary {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) source_key: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) display_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) provider: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) queryable: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) status: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, Eq, PartialEq)]
pub(crate) struct SourceListPayload {
    #[serde(default)]
    pub(crate) sources: Vec<SourceSummary>,
    pub(crate) page: PageInfo,
}

#[derive(Debug, Clone, Deserialize, Serialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SourceTestPayload {
    pub(crate) source: SourceSummary,
    pub(crate) outcome: SourceTestOutcome,
}

#[derive(Debug, Clone, Deserialize, Serialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SourceTestOutcome {
    pub(crate) kind: String,
    pub(crate) message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) success: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) error: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) latency_ms: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) reason: Option<String>,
}

pub(crate) async fn list_sources_with_controls(
    client: &AuthenticatedApiClient,
    org: &str,
    controls: &ReadRequestControls,
) -> Result<ApiSuccess<SourceListPayload>, ApiFailure> {
    let response = fetch_source_page(client, org, controls.single_page()).await?;

    if !controls.page_all {
        return Ok(response);
    }

    let request_id = response.request_id.clone();
    let mut sources = response.payload.sources;
    let mut next_cursor = response.payload.page.next_cursor;

    while let Some(cursor) = next_cursor {
        let next_response =
            fetch_source_page(client, org, controls.with_cursor(Some(cursor))).await?;
        sources.extend(next_response.payload.sources);
        next_cursor = next_response.payload.page.next_cursor;
    }

    let returned = sources.len();
    Ok(ApiSuccess {
        payload: SourceListPayload {
            sources,
            page: PageInfo::aggregated(returned),
        },
        request_id,
    })
}

async fn fetch_source_page(
    client: &AuthenticatedApiClient,
    org: &str,
    controls: SinglePageReadControls,
) -> Result<ApiSuccess<SourceListPayload>, ApiFailure> {
    let org_slug: String = try_into_value(org, ErrorStage::Http)?;
    let cursor: Option<String> = try_into_option(controls.cursor.as_deref(), ErrorStage::Http)?;
    let limit = optional_page_size(controls.page_size, ErrorStage::Http)?;
    let response = match client
        .cli()
        .list_sources(types::ListSourcesRequest {
            org_slug: Some(org_slug),
            limit,
            cursor,
            ..Default::default()
        })
        .await
    {
        Ok(response) => response,
        Err(error) => {
            return Err(failure_from_connect(error, ErrorStage::Http));
        }
    };
    let request_id = response_request_id(response.headers());
    let payload = response.into_owned();
    let page = payload.page.into_option().ok_or_else(|| {
        decode_failure(
            ErrorStage::Http,
            "source list response missing page metadata",
            request_id.clone(),
        )
    })?;

    Ok(ApiSuccess {
        payload: SourceListPayload {
            sources: payload
                .sources
                .into_iter()
                .map(source_summary_from_generated)
                .collect(),
            page: page_info_from_generated(page),
        },
        request_id,
    })
}

pub(crate) async fn get_source_by_key_with_controls(
    client: &AuthenticatedApiClient,
    org: &str,
    source_key: &str,
    _controls: &ReadRequestControls,
) -> Result<ApiSuccess<SourceSummary>, ApiFailure> {
    let org_slug: String = try_into_value(org, ErrorStage::ResolveSource)?;
    let source_key: String = try_into_value(source_key, ErrorStage::ResolveSource)?;
    let response = match client
        .cli()
        .get_source(types::GetSourceRequest {
            org_slug: Some(org_slug),
            source_key: Some(source_key),
            ..Default::default()
        })
        .await
    {
        Ok(response) => response,
        Err(error) => {
            return Err(failure_from_connect(error, ErrorStage::ResolveSource));
        }
    };

    let request_id = response_request_id(response.headers());
    let payload = response.into_owned();
    let source = payload.source.into_option().ok_or_else(|| {
        decode_failure(
            ErrorStage::ResolveSource,
            "source get response missing source",
            request_id.clone(),
        )
    })?;

    Ok(ApiSuccess {
        payload: source_summary_from_generated(source),
        request_id,
    })
}

pub(crate) async fn test_source(
    client: &AuthenticatedApiClient,
    org: &str,
    source_key: &str,
) -> Result<ApiSuccess<SourceTestPayload>, ApiFailure> {
    let org_slug: String = try_into_value(org, ErrorStage::ResolveSource)?;
    let source_key: String = try_into_value(source_key, ErrorStage::ResolveSource)?;
    let response = match client
        .cli()
        .test_source(types::TestSourceRequest {
            org_slug: Some(org_slug),
            source_key: Some(source_key),
            ..Default::default()
        })
        .await
    {
        Ok(response) => response,
        Err(error) => {
            return Err(failure_from_connect(error, ErrorStage::ResolveSource));
        }
    };

    let request_id = response_request_id(response.headers());
    let payload = response.into_owned();
    let source = payload.source.into_option().ok_or_else(|| {
        decode_failure(
            ErrorStage::ResolveSource,
            "source test response missing source",
            request_id.clone(),
        )
    })?;
    let outcome = payload.outcome.ok_or_else(|| {
        decode_failure(
            ErrorStage::ResolveSource,
            "source test response missing outcome",
            request_id.clone(),
        )
    })?;

    let outcome = match outcome {
        types::test_source_response::Outcome::Supported(supported) => SourceTestOutcome {
            kind: "supported".to_owned(),
            message: supported.message.unwrap_or_default(),
            success: supported.success,
            error: supported.error,
            latency_ms: supported.latency_ms,
            reason: None,
        },
        types::test_source_response::Outcome::Unsupported(unsupported) => SourceTestOutcome {
            kind: "unsupported".to_owned(),
            message: unsupported.message.unwrap_or_default(),
            success: None,
            error: None,
            latency_ms: None,
            reason: unsupported
                .reason
                .map(source_test_unsupported_reason_to_str),
        },
    };

    Ok(ApiSuccess {
        payload: SourceTestPayload {
            source: source_summary_from_generated(source),
            outcome,
        },
        request_id,
    })
}

pub(crate) fn source_summary_from_generated(summary: types::CliSource) -> SourceSummary {
    let types::CliSource {
        source_key,
        display_name,
        provider,
        queryable,
        status,
        ..
    } = summary;

    SourceSummary {
        source_key,
        display_name,
        provider: provider.map(source_provider_to_str),
        queryable,
        status: status.map(source_status_to_str),
    }
}

fn source_test_unsupported_reason_to_str(
    value: EnumValue<types::CliSourceTestUnsupportedReason>,
) -> String {
    match value.as_known() {
        Some(types::CliSourceTestUnsupportedReason::CLI_SOURCE_TEST_UNSUPPORTED_REASON_OAUTH) => {
            "oauth".to_owned()
        }
        Some(
            types::CliSourceTestUnsupportedReason::CLI_SOURCE_TEST_UNSUPPORTED_REASON_NOT_IMPLEMENTED,
        ) => "not_implemented".to_owned(),
        Some(
            types::CliSourceTestUnsupportedReason::CLI_SOURCE_TEST_UNSUPPORTED_REASON_UNSPECIFIED,
        )
        | None => {
            "unknown".to_owned()
        }
    }
}

#[cfg(test)]
mod tests {
    use pretty_assertions::assert_eq;
    use serde_json::json;

    use crate::transport::read_controls::PageInfo;

    use super::SourceListPayload;
    use super::SourceSummary;

    #[test]
    fn source_list_response_deserializes_canonical_shape() {
        let payload = json!({
            "sources": [
                {
                    "sourceKey": "warehouse",
                    "provider": "postgres",
                    "queryable": true,
                    "status": "active"
                },
                {
                    "sourceKey": "github_main",
                    "provider": "github",
                    "queryable": false,
                    "status": "active"
                }
            ],
            "page": {
                "nextCursor": null,
                "returnedCount": 2
            }
        });

        let parsed = serde_json::from_value::<SourceListPayload>(payload)
            .expect("canonical source list payload should deserialize");
        assert_eq!(
            parsed,
            SourceListPayload {
                sources: vec![
                    SourceSummary {
                        source_key: Some("warehouse".to_owned()),
                        display_name: None,
                        provider: Some("postgres".to_owned()),
                        queryable: Some(true),
                        status: Some("active".to_owned()),
                    },
                    SourceSummary {
                        source_key: Some("github_main".to_owned()),
                        display_name: None,
                        provider: Some("github".to_owned()),
                        queryable: Some(false),
                        status: Some("active".to_owned()),
                    },
                ],
                page: PageInfo {
                    next_cursor: None,
                    returned_count: 2,
                },
            }
        );
    }

    #[test]
    fn source_summary_deserializes_provider_field_into_provider() {
        let payload = json!({
            "sourceKey": "warehouse",
            "displayName": "Warehouse",
            "provider": "mysql",
            "queryable": true,
            "status": "active"
        });

        let parsed = serde_json::from_value::<SourceSummary>(payload)
            .expect("canonical source summary should deserialize");
        assert_eq!(
            parsed,
            SourceSummary {
                source_key: Some("warehouse".to_owned()),
                display_name: Some("Warehouse".to_owned()),
                provider: Some("mysql".to_owned()),
                queryable: Some(true),
                status: Some("active".to_owned()),
            }
        );
    }
}
