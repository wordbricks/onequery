use onequery_cli_core::error::ErrorStage;
use serde::Deserialize;
use serde::Serialize;

use crate::transport::client::AuthenticatedApiClient;
use crate::transport::generated::types;
use crate::transport::http::ApiFailure;
use crate::transport::http::ApiSuccess;
use crate::transport::http::ResponseFailureStages;
use crate::transport::http::decode_failure;
use crate::transport::http::failure_from_connect;
use crate::transport::http::response_request_id;
use crate::transport::http::try_into_option;
use crate::transport::http::try_into_value;
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
    pub(crate) name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) display_name: Option<String>,
    #[serde(rename = "provider")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) provider_kind: Option<String>,
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
    let fields: Option<String> = try_into_option(controls.fields.as_deref(), ErrorStage::Http)?;
    let limit = optional_page_size(controls.page_size, ErrorStage::Http)?;
    let response = match client
        .cli()
        .list_sources(types::ListSourcesRequest {
            org_slug,
            fields,
            limit,
            cursor,
            ..Default::default()
        })
        .await
    {
        Ok(response) => response,
        Err(error) => {
            return Err(failure_from_connect(
                error,
                ResponseFailureStages::from_status(list_sources_problem_stage_for_status),
            ));
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
    controls: &ReadRequestControls,
) -> Result<ApiSuccess<SourceSummary>, ApiFailure> {
    let org_slug: String = try_into_value(org, ErrorStage::ResolveSource)?;
    let source_key: String = try_into_value(source_key, ErrorStage::ResolveSource)?;
    let fields: Option<String> =
        try_into_option(controls.fields.as_deref(), ErrorStage::ResolveSource)?;
    let response = match client
        .cli()
        .get_source(types::GetSourceRequest {
            org_slug,
            source_key,
            fields,
            ..Default::default()
        })
        .await
    {
        Ok(response) => response,
        Err(error) => {
            return Err(failure_from_connect(
                error,
                ResponseFailureStages::from_status(get_source_problem_stage_for_status),
            ));
        }
    };

    let request_id = response_request_id(response.headers());
    let payload = response.into_owned();

    Ok(ApiSuccess {
        payload: source_summary_from_get_response(payload),
        request_id,
    })
}

fn list_sources_problem_stage_for_status(status: reqwest::StatusCode) -> ErrorStage {
    if matches!(
        status,
        reqwest::StatusCode::UNAUTHORIZED | reqwest::StatusCode::FORBIDDEN
    ) {
        ErrorStage::Auth
    } else {
        ErrorStage::Http
    }
}

fn get_source_problem_stage_for_status(status: reqwest::StatusCode) -> ErrorStage {
    if matches!(
        status,
        reqwest::StatusCode::UNAUTHORIZED | reqwest::StatusCode::FORBIDDEN
    ) {
        ErrorStage::Auth
    } else {
        ErrorStage::ResolveSource
    }
}

pub(crate) fn source_summary_from_generated(summary: types::CliSourceSummary) -> SourceSummary {
    SourceSummary {
        name: non_empty(summary.name),
        display_name: non_empty_option(summary.display_name),
        provider_kind: Some(source_provider_to_str(summary.provider)),
        queryable: Some(summary.queryable),
        status: Some(source_status_to_str(summary.status)),
    }
}

fn source_summary_from_get_response(response: types::GetSourceResponse) -> SourceSummary {
    SourceSummary {
        name: non_empty(response.name),
        display_name: non_empty_option(response.display_name),
        provider_kind: Some(source_provider_to_str(response.provider)),
        queryable: Some(response.queryable),
        status: Some(source_status_to_str(response.status)),
    }
}

fn non_empty(value: String) -> Option<String> {
    (!value.is_empty()).then_some(value)
}

fn non_empty_option(value: Option<String>) -> Option<String> {
    value.filter(|value| !value.is_empty())
}

#[cfg(test)]
mod tests {
    use pretty_assertions::assert_eq;
    use reqwest::StatusCode;
    use serde_json::json;

    use crate::transport::read_controls::PageInfo;

    use super::SourceListPayload;
    use super::SourceSummary;
    use super::get_source_problem_stage_for_status;
    use super::list_sources_problem_stage_for_status;
    use onequery_cli_core::error::ErrorStage;

    #[test]
    fn source_problem_stage_mappings_preserve_auth_failures() {
        assert_eq!(
            [
                list_sources_problem_stage_for_status(StatusCode::UNAUTHORIZED),
                list_sources_problem_stage_for_status(StatusCode::BAD_REQUEST),
                get_source_problem_stage_for_status(StatusCode::FORBIDDEN),
                get_source_problem_stage_for_status(StatusCode::NOT_FOUND),
            ],
            [
                ErrorStage::Auth,
                ErrorStage::Http,
                ErrorStage::Auth,
                ErrorStage::ResolveSource,
            ]
        );
    }

    #[test]
    fn source_list_response_deserializes_canonical_shape() {
        let payload = json!({
            "sources": [
                {
                    "name": "warehouse",
                    "provider": "postgres",
                    "queryable": true,
                    "status": "active"
                },
                {
                    "name": "github_main",
                    "provider": "github",
                    "queryable": false,
                    "status": "active"
                }
            ],
            "page": {
                "nextCursor": null,
                "returned": 2,
                "hasMore": false
            }
        });

        let parsed = serde_json::from_value::<SourceListPayload>(payload)
            .expect("canonical source list payload should deserialize");
        assert_eq!(
            parsed,
            SourceListPayload {
                sources: vec![
                    SourceSummary {
                        name: Some("warehouse".to_owned()),
                        display_name: None,
                        provider_kind: Some("postgres".to_owned()),
                        queryable: Some(true),
                        status: Some("active".to_owned()),
                    },
                    SourceSummary {
                        name: Some("github_main".to_owned()),
                        display_name: None,
                        provider_kind: Some("github".to_owned()),
                        queryable: Some(false),
                        status: Some("active".to_owned()),
                    },
                ],
                page: PageInfo {
                    next_cursor: None,
                    returned: 2,
                    has_more: false,
                },
            }
        );
    }

    #[test]
    fn source_summary_deserializes_provider_field_into_provider_kind() {
        let payload = json!({
            "name": "warehouse",
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
                name: Some("warehouse".to_owned()),
                display_name: Some("Warehouse".to_owned()),
                provider_kind: Some("mysql".to_owned()),
                queryable: Some(true),
                status: Some("active".to_owned()),
            }
        );
    }
}
