use buffa::EnumValue;
use onequery_cli_core::error::ErrorStage;
use serde::Deserialize;
use serde::Serialize;

use crate::transport::api_failure::ApiFailure;
use crate::transport::api_failure::ApiSuccess;
use crate::transport::api_failure::decode_failure;
use crate::transport::api_failure::failure_from_connect;
use crate::transport::api_failure::response_request_id;
use crate::transport::api_failure::try_into_value;
use crate::transport::client::AuthenticatedApiClient;
use crate::transport::generated::types;
use crate::transport::labels::source_provider_to_str;
use crate::transport::labels::source_status_to_str;
use crate::transport::pagination::page_info_from_generated;
use crate::transport::pagination::page_request_from_controls;
use crate::transport::read_controls::PageInfo;
use crate::transport::read_controls::ReadRequestControls;
use crate::transport::read_controls::SinglePageReadControls;
use crate::transport::response_decode::require_non_empty_text;
use crate::transport::well_known::required_duration_ms;

#[derive(Debug, Clone, Deserialize, Serialize, Eq, PartialEq, Default)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct SourceSummary {
    pub(crate) source_key: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) display_name: Option<String>,
    pub(crate) provider: String,
    pub(crate) queryable: bool,
    pub(crate) status: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, Eq, PartialEq)]
#[serde(deny_unknown_fields)]
pub(crate) struct SourceListPayload {
    #[serde(default)]
    pub(crate) sources: Vec<SourceSummary>,
    pub(crate) page: PageInfo,
}

#[derive(Debug, Clone, Deserialize, Serialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct SourceTestPayload {
    pub(crate) source: SourceSummary,
    pub(crate) outcome: SourceTestOutcome,
}

#[derive(Debug, Clone, Deserialize, Serialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase", tag = "kind", deny_unknown_fields)]
pub(crate) enum SourceTestOutcome {
    Supported {
        result: SourceTestSupportedResult,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        latency_ms: Option<u64>,
    },
    Unsupported {
        message: String,
        reason: String,
    },
}

#[derive(Debug, Clone, Deserialize, Serialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) enum SourceTestSupportedResult {
    Passed { message: String },
    Failed { message: String, error: String },
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
    let page = page_request_from_controls(controls, ErrorStage::Http)?;
    let response = match client
        .source()
        .list_sources(types::ListSourcesRequest {
            org_slug: Some(org_slug),
            page,
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
                .map(|source| {
                    source_summary_from_generated(source, ErrorStage::Http, request_id.clone())
                })
                .collect::<Result<Vec<_>, ApiFailure>>()?,
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
        .source()
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

    Ok(ApiSuccess {
        payload: decode_required_source_summary(
            payload.source.into_option(),
            ErrorStage::ResolveSource,
            "source get response missing source",
            request_id.clone(),
        )?,
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
        .source()
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
    let source = payload.source.into_option();
    let outcome = payload.outcome.ok_or_else(|| {
        decode_failure(
            ErrorStage::ResolveSource,
            "source test response missing outcome",
            request_id.clone(),
        )
    })?;

    let outcome = match outcome {
        types::test_source_response::Outcome::Supported(supported) => {
            let latency_ms = required_duration_ms(
                supported.latency,
                ErrorStage::ResolveSource,
                "source test supported response missing latency",
                request_id.clone(),
            )?;
            let result = supported.result.ok_or_else(|| {
                decode_failure(
                    ErrorStage::ResolveSource,
                    "source test supported response missing result",
                    request_id.clone(),
                )
            })?;

            match result {
                types::test_source_supported_outcome::Result::Passed(passed) => {
                    SourceTestOutcome::Supported {
                        result: SourceTestSupportedResult::Passed {
                            message: require_non_empty_text(
                                passed.message,
                                ErrorStage::ResolveSource,
                                "source test passed response missing message",
                                request_id.clone(),
                            )?,
                        },
                        latency_ms: Some(latency_ms),
                    }
                }
                types::test_source_supported_outcome::Result::Failed(failed) => {
                    SourceTestOutcome::Supported {
                        result: SourceTestSupportedResult::Failed {
                            message: require_non_empty_text(
                                failed.message,
                                ErrorStage::ResolveSource,
                                "source test failed response missing message",
                                request_id.clone(),
                            )?,
                            error: require_non_empty_text(
                                failed.error,
                                ErrorStage::ResolveSource,
                                "source test failed response missing error",
                                request_id.clone(),
                            )?,
                        },
                        latency_ms: Some(latency_ms),
                    }
                }
            }
        }
        types::test_source_response::Outcome::Unsupported(unsupported) => {
            SourceTestOutcome::Unsupported {
                message: require_non_empty_text(
                    unsupported.message,
                    ErrorStage::ResolveSource,
                    "source test unsupported response missing message",
                    request_id.clone(),
                )?,
                reason: source_test_unsupported_reason_to_str(
                    unsupported.reason.ok_or_else(|| {
                        decode_failure(
                            ErrorStage::ResolveSource,
                            "source test unsupported response missing reason",
                            request_id.clone(),
                        )
                    })?,
                    request_id.clone(),
                )?,
            }
        }
    };

    Ok(ApiSuccess {
        payload: SourceTestPayload {
            source: decode_required_source_summary(
                source,
                ErrorStage::ResolveSource,
                "source test response missing source",
                request_id.clone(),
            )?,
            outcome,
        },
        request_id,
    })
}

fn decode_required_source_summary(
    summary: Option<types::CliSource>,
    stage: ErrorStage,
    message: &str,
    request_id: Option<String>,
) -> Result<SourceSummary, ApiFailure> {
    let summary = summary.ok_or_else(|| decode_failure(stage, message, request_id.clone()))?;
    source_summary_from_generated(summary, stage, request_id)
}

pub(crate) fn source_summary_from_generated(
    summary: types::CliSource,
    stage: ErrorStage,
    request_id: Option<String>,
) -> Result<SourceSummary, ApiFailure> {
    let types::CliSource {
        source_key,
        display_name,
        provider,
        query_support,
        status,
        ..
    } = summary;

    Ok(SourceSummary {
        source_key: require_non_empty_text(
            source_key,
            stage,
            "source response missing source key",
            request_id.clone(),
        )?,
        display_name: display_name.filter(|value| !value.is_empty()),
        provider: provider.map(source_provider_to_str).ok_or_else(|| {
            decode_failure(
                stage,
                "source response missing provider",
                request_id.clone(),
            )
        })?,
        queryable: source_query_support_to_bool(query_support, stage, request_id.clone())?,
        status: status
            .map(source_status_to_str)
            .ok_or_else(|| decode_failure(stage, "source response missing status", request_id))?,
    })
}

fn source_query_support_to_bool(
    value: Option<EnumValue<types::SourceQuerySupport>>,
    stage: ErrorStage,
    request_id: Option<String>,
) -> Result<bool, ApiFailure> {
    match value.and_then(|value| value.as_known()) {
        Some(types::SourceQuerySupport::SOURCE_QUERY_SUPPORT_SUPPORTED) => Ok(true),
        Some(types::SourceQuerySupport::SOURCE_QUERY_SUPPORT_NOT_SUPPORTED) => Ok(false),
        Some(types::SourceQuerySupport::SOURCE_QUERY_SUPPORT_UNSPECIFIED) | None => Err(
            decode_failure(stage, "source response missing query support", request_id),
        ),
    }
}

fn source_test_unsupported_reason_to_str(
    value: EnumValue<types::SourceTestUnsupportedReason>,
    request_id: Option<String>,
) -> Result<String, ApiFailure> {
    match value.as_known() {
        Some(types::SourceTestUnsupportedReason::SOURCE_TEST_UNSUPPORTED_REASON_OAUTH) => {
            Ok("oauth".to_owned())
        }
        Some(
            types::SourceTestUnsupportedReason::SOURCE_TEST_UNSUPPORTED_REASON_NOT_IMPLEMENTED,
        ) => Ok("not_implemented".to_owned()),
        Some(types::SourceTestUnsupportedReason::SOURCE_TEST_UNSUPPORTED_REASON_UNSPECIFIED)
        | None => Err(decode_failure(
            ErrorStage::ResolveSource,
            "source test unsupported response has invalid reason",
            request_id,
        )),
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
                        source_key: "warehouse".to_owned(),
                        display_name: None,
                        provider: "postgres".to_owned(),
                        queryable: true,
                        status: "active".to_owned(),
                    },
                    SourceSummary {
                        source_key: "github_main".to_owned(),
                        display_name: None,
                        provider: "github".to_owned(),
                        queryable: false,
                        status: "active".to_owned(),
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
                source_key: "warehouse".to_owned(),
                display_name: Some("Warehouse".to_owned()),
                provider: "mysql".to_owned(),
                queryable: true,
                status: "active".to_owned(),
            }
        );
    }
}
