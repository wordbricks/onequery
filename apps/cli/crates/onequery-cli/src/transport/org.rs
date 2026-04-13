use connectrpc::ErrorCode;
use onequery_cli_core::error::ErrorStage;
use serde::Deserialize;
use serde::Serialize;

use crate::transport::api_failure::ApiFailure;
use crate::transport::api_failure::ApiSuccess;
use crate::transport::api_failure::ResponseFailureStages;
use crate::transport::api_failure::decode_failure;
use crate::transport::api_failure::failure_from_connect;
use crate::transport::api_failure::response_request_id;
use crate::transport::api_failure::try_into_option;
use crate::transport::api_failure::try_into_value;
use crate::transport::client::AuthenticatedApiClient;
use crate::transport::generated::types;
use crate::transport::labels::org_capability_to_str;
use crate::transport::pagination::optional_page_size;
use crate::transport::pagination::page_info_from_generated;
use crate::transport::read_controls::PageInfo;
use crate::transport::read_controls::ReadRequestControls;
use crate::transport::read_controls::SinglePageReadControls;

#[derive(Debug, Clone, Deserialize, Serialize, Eq, PartialEq, Default)]
pub(crate) struct OrgSummary {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) slug: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) name: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, Eq, PartialEq, Default)]
pub(crate) struct OrgDetails {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) slug: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) roles: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) capabilities: Option<Vec<String>>,
}

pub(crate) async fn get_org_with_controls(
    client: &AuthenticatedApiClient,
    org: &str,
    _controls: &ReadRequestControls,
) -> Result<ApiSuccess<OrgDetails>, ApiFailure> {
    let org_slug: String = try_into_value(org, ErrorStage::ResolveOrg)?;
    let response = match client
        .cli()
        .get_organization(types::GetOrganizationRequest {
            org_slug,
            ..Default::default()
        })
        .await
    {
        Ok(response) => response,
        Err(error) => {
            return Err(failure_from_connect(
                error,
                ResponseFailureStages::from_connect_code(get_org_problem_stage_for_code),
            ));
        }
    };
    let request_id = response_request_id(response.headers());

    Ok(ApiSuccess {
        payload: org_details_from_generated(response.into_owned()),
        request_id,
    })
}

pub(crate) async fn list_orgs_with_controls(
    client: &AuthenticatedApiClient,
    controls: &ReadRequestControls,
) -> Result<ApiSuccess<OrgListPayload>, ApiFailure> {
    let response = fetch_org_page(client, controls.single_page()).await?;

    if !controls.page_all {
        return Ok(response);
    }

    let request_id = response.request_id.clone();
    let mut organizations = response.payload.organizations;
    let mut next_cursor = response.payload.page.next_cursor;

    while let Some(cursor) = next_cursor {
        let next_response = fetch_org_page(client, controls.with_cursor(Some(cursor))).await?;
        organizations.extend(next_response.payload.organizations);
        next_cursor = next_response.payload.page.next_cursor;
    }

    let returned = organizations.len();
    Ok(ApiSuccess {
        payload: OrgListPayload {
            organizations,
            page: PageInfo::aggregated(returned),
        },
        request_id,
    })
}

async fn fetch_org_page(
    client: &AuthenticatedApiClient,
    controls: SinglePageReadControls,
) -> Result<ApiSuccess<OrgListPayload>, ApiFailure> {
    let cursor: Option<String> = try_into_option(controls.cursor.as_deref(), ErrorStage::Http)?;
    let limit = optional_page_size(controls.page_size, ErrorStage::Http)?;
    let response = match client
        .cli()
        .list_organizations(types::ListOrganizationsRequest {
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
                ResponseFailureStages::from_connect_code(list_org_problem_stage_for_code),
            ));
        }
    };
    let request_id = response_request_id(response.headers());
    let payload = response.into_owned();
    let page = payload.page.into_option().ok_or_else(|| {
        decode_failure(
            ErrorStage::Http,
            "organization list response missing page metadata",
            request_id.clone(),
        )
    })?;

    Ok(ApiSuccess {
        payload: OrgListPayload {
            organizations: payload
                .organizations
                .into_iter()
                .map(org_summary_from_generated)
                .collect(),
            page: page_info_from_generated(page),
        },
        request_id,
    })
}

fn get_org_problem_stage_for_code(code: ErrorCode) -> ErrorStage {
    if matches!(
        code,
        ErrorCode::Unauthenticated | ErrorCode::PermissionDenied
    ) {
        ErrorStage::Auth
    } else {
        ErrorStage::ResolveOrg
    }
}

fn list_org_problem_stage_for_code(code: ErrorCode) -> ErrorStage {
    if matches!(
        code,
        ErrorCode::Unauthenticated | ErrorCode::PermissionDenied
    ) {
        ErrorStage::Auth
    } else {
        ErrorStage::Http
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OrgListPayload {
    #[serde(default)]
    pub(crate) organizations: Vec<OrgSummary>,
    pub(crate) page: PageInfo,
}

fn org_summary_from_generated(summary: types::CliOrganizationSummary) -> OrgSummary {
    OrgSummary {
        slug: Some(summary.slug),
        name: Some(summary.name),
    }
}

fn org_details_from_generated(details: types::GetOrganizationResponse) -> OrgDetails {
    OrgDetails {
        slug: Some(details.slug),
        name: Some(details.name),
        roles: Some(details.roles),
        capabilities: Some(
            details
                .capabilities
                .into_iter()
                .map(org_capability_to_str)
                .collect(),
        ),
    }
}

#[cfg(test)]
mod tests {
    use connectrpc::ErrorCode;
    use onequery_cli_core::error::ErrorStage;
    use pretty_assertions::assert_eq;

    use crate::transport::read_controls::PageInfo;

    use super::OrgDetails;
    use super::OrgListPayload;
    use super::OrgSummary;
    use super::get_org_problem_stage_for_code;
    use super::list_org_problem_stage_for_code;
    use super::org_details_from_generated;
    use super::org_summary_from_generated;
    use super::types;

    #[test]
    fn org_problem_stage_mappings_preserve_auth_failures() {
        assert_eq!(
            [
                list_org_problem_stage_for_code(ErrorCode::Unauthenticated),
                list_org_problem_stage_for_code(ErrorCode::InvalidArgument),
                get_org_problem_stage_for_code(ErrorCode::PermissionDenied),
                get_org_problem_stage_for_code(ErrorCode::NotFound),
            ],
            [
                ErrorStage::Auth,
                ErrorStage::Http,
                ErrorStage::Auth,
                ErrorStage::ResolveOrg,
            ]
        );
    }

    #[test]
    fn org_summary_from_generated_maps_list_payload() {
        let summary = org_summary_from_generated(types::CliOrganizationSummary {
            slug: "acme".to_owned(),
            name: "Acme".to_owned(),
            ..Default::default()
        });

        assert_eq!(
            summary,
            OrgSummary {
                slug: Some("acme".to_owned()),
                name: Some("Acme".to_owned()),
            }
        );
    }

    #[test]
    fn org_details_from_generated_maps_capabilities() {
        let details = org_details_from_generated(types::GetOrganizationResponse {
            slug: "acme".to_owned(),
            name: "Acme".to_owned(),
            roles: vec!["member".to_owned(), "admin".to_owned()],
            capabilities: vec![
                types::CliOrgCapability::CLI_ORG_CAPABILITY_ORG_LIST.into(),
                types::CliOrgCapability::CLI_ORG_CAPABILITY_SOURCE_API_DESCRIBE.into(),
                types::CliOrgCapability::CLI_ORG_CAPABILITY_SOURCE_API_EXECUTE.into(),
                types::CliOrgCapability::CLI_ORG_CAPABILITY_ORG_READ.into(),
            ],
            ..Default::default()
        });

        assert_eq!(
            details,
            OrgDetails {
                slug: Some("acme".to_owned()),
                name: Some("Acme".to_owned()),
                roles: Some(vec!["member".to_owned(), "admin".to_owned()]),
                capabilities: Some(vec![
                    "org.list".to_owned(),
                    "source_api.describe".to_owned(),
                    "source_api.execute".to_owned(),
                    "org.read".to_owned(),
                ]),
            }
        );
    }

    #[test]
    fn org_list_payload_deserializes_canonical_shape() {
        let parsed = serde_json::from_value::<OrgListPayload>(serde_json::json!({
            "organizations": [
                {"slug": "acme", "name": "Acme"},
                {"slug": "globex", "name": "Globex"}
            ],
            "page": {
                "nextCursor": null,
                "returned": 2,
                "hasMore": false
            }
        }))
        .expect("canonical org list payload should deserialize");

        assert_eq!(
            parsed,
            OrgListPayload {
                organizations: vec![
                    OrgSummary {
                        slug: Some("acme".to_owned()),
                        name: Some("Acme".to_owned()),
                    },
                    OrgSummary {
                        slug: Some("globex".to_owned()),
                        name: Some("Globex".to_owned()),
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
}
