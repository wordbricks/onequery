use buffa::EnumValue;
use onequery_core::error::ErrorStage;
use serde::Deserialize;
use serde::Serialize;

use crate::transport::api_failure::ApiFailure;
use crate::transport::api_failure::ApiSuccess;
use crate::transport::api_failure::decode_failure;
use crate::transport::api_failure::failure_from_connect;
use crate::transport::api_failure::success_response_request_id;
use crate::transport::api_failure::try_into_value;
use crate::transport::client::AuthenticatedApiClient;
use crate::transport::generated::types;
use crate::transport::pagination::page_info_from_generated;
use crate::transport::pagination::page_request_from_controls;
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
        .organization()
        .get_organization(types::GetOrganizationRequest {
            org_slug: Some(org_slug),
            ..Default::default()
        })
        .await
    {
        Ok(response) => response,
        Err(error) => {
            return Err(failure_from_connect(error, ErrorStage::ResolveOrg));
        }
    };
    let request_id = success_response_request_id(&response);

    Ok(ApiSuccess {
        payload: org_details_from_generated(response.into_owned(), request_id.clone())?,
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
    let page = page_request_from_controls(controls, ErrorStage::Http)?;
    let response = match client
        .organization()
        .list_organizations(types::ListOrganizationsRequest {
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
    let request_id = success_response_request_id(&response);
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

#[derive(Debug, Clone, Deserialize, Serialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OrgListPayload {
    #[serde(default)]
    pub(crate) organizations: Vec<OrgSummary>,
    pub(crate) page: PageInfo,
}

fn org_summary_from_generated(summary: types::CliOrganizationSummary) -> OrgSummary {
    OrgSummary {
        slug: summary.slug,
        name: summary.name,
    }
}

fn org_details_from_generated(
    details: types::GetOrganizationResponse,
    request_id: Option<String>,
) -> Result<OrgDetails, ApiFailure> {
    let types::GetOrganizationResponse {
        slug,
        name,
        roles,
        capabilities,
        ..
    } = details;

    Ok(OrgDetails {
        slug,
        name,
        roles: Some(
            roles
                .into_iter()
                .map(|role| org_role_from_generated(role, request_id.clone()))
                .collect::<Result<Vec<_>, _>>()?,
        ),
        capabilities: Some(
            capabilities
                .into_iter()
                .map(|capability| org_capability_from_generated(capability, request_id.clone()))
                .collect::<Result<Vec<_>, _>>()?,
        ),
    })
}

fn org_role_from_generated(
    value: EnumValue<types::OrganizationRole>,
    request_id: Option<String>,
) -> Result<String, ApiFailure> {
    match value.as_known() {
        Some(types::OrganizationRole::ORGANIZATION_ROLE_OWNER) => Ok("owner".to_owned()),
        Some(types::OrganizationRole::ORGANIZATION_ROLE_ADMIN) => Ok("admin".to_owned()),
        Some(types::OrganizationRole::ORGANIZATION_ROLE_MEMBER) => Ok("member".to_owned()),
        Some(types::OrganizationRole::ORGANIZATION_ROLE_UNSPECIFIED) | None => Err(decode_failure(
            ErrorStage::ResolveOrg,
            "organization response has invalid role",
            request_id,
        )),
    }
}

fn org_capability_from_generated(
    value: EnumValue<types::OrgCapability>,
    request_id: Option<String>,
) -> Result<String, ApiFailure> {
    match value.as_known() {
        Some(types::OrgCapability::ORG_CAPABILITY_ORG_LIST) => Ok("org.list".to_owned()),
        Some(types::OrgCapability::ORG_CAPABILITY_ORG_READ) => Ok("org.read".to_owned()),
        Some(types::OrgCapability::ORG_CAPABILITY_SOURCE_CONNECT) => {
            Ok("source.connect".to_owned())
        }
        Some(types::OrgCapability::ORG_CAPABILITY_SOURCE_LIST) => Ok("source.list".to_owned()),
        Some(types::OrgCapability::ORG_CAPABILITY_SOURCE_READ) => Ok("source.read".to_owned()),
        Some(types::OrgCapability::ORG_CAPABILITY_SOURCE_WRITE) => Ok("source.write".to_owned()),
        Some(types::OrgCapability::ORG_CAPABILITY_QUERY_EXECUTE) => Ok("query.execute".to_owned()),
        Some(types::OrgCapability::ORG_CAPABILITY_SOURCE_API_DESCRIBE) => {
            Ok("source_api.describe".to_owned())
        }
        Some(types::OrgCapability::ORG_CAPABILITY_SOURCE_API_EXECUTE) => {
            Ok("source_api.execute".to_owned())
        }
        Some(types::OrgCapability::ORG_CAPABILITY_UNSPECIFIED) | None => Err(decode_failure(
            ErrorStage::ResolveOrg,
            "organization response has invalid capability",
            request_id,
        )),
    }
}

#[cfg(test)]
mod tests {
    use onequery_core::error::ErrorStage;
    use pretty_assertions::assert_eq;

    use crate::transport::api_failure::ApiFailure;
    use crate::transport::read_controls::PageInfo;

    use super::OrgDetails;
    use super::OrgListPayload;
    use super::OrgSummary;
    use super::org_details_from_generated;
    use super::org_summary_from_generated;
    use super::types;

    #[test]
    fn org_summary_from_generated_maps_list_payload() {
        let summary = org_summary_from_generated(types::CliOrganizationSummary {
            slug: Some("acme".to_owned()),
            name: Some("Acme".to_owned()),
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
        let details = org_details_from_generated(
            types::GetOrganizationResponse {
                slug: Some("acme".to_owned()),
                name: Some("Acme".to_owned()),
                roles: vec![
                    types::OrganizationRole::ORGANIZATION_ROLE_MEMBER.into(),
                    types::OrganizationRole::ORGANIZATION_ROLE_ADMIN.into(),
                ],
                capabilities: vec![
                    types::OrgCapability::ORG_CAPABILITY_ORG_LIST.into(),
                    types::OrgCapability::ORG_CAPABILITY_SOURCE_API_DESCRIBE.into(),
                    types::OrgCapability::ORG_CAPABILITY_SOURCE_API_EXECUTE.into(),
                    types::OrgCapability::ORG_CAPABILITY_ORG_READ.into(),
                    types::OrgCapability::ORG_CAPABILITY_SOURCE_WRITE.into(),
                ],
                ..Default::default()
            },
            Some("req_org".to_owned()),
        )
        .expect("expected organization details");

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
                    "source.write".to_owned(),
                ]),
            }
        );
    }

    #[test]
    fn org_details_from_generated_rejects_invalid_role() {
        let error = org_details_from_generated(
            types::GetOrganizationResponse {
                slug: Some("acme".to_owned()),
                name: Some("Acme".to_owned()),
                roles: vec![types::OrganizationRole::ORGANIZATION_ROLE_UNSPECIFIED.into()],
                ..Default::default()
            },
            Some("req_org_role".to_owned()),
        )
        .expect_err("expected invalid role to fail");

        assert_eq!(
            error,
            ApiFailure::Decode(crate::transport::api_failure::DecodeFailure {
                stage: ErrorStage::ResolveOrg,
                message: "organization response has invalid role".to_owned(),
                request_id: Some("req_org_role".to_owned()),
            })
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
                "returnedCount": 2
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
                    returned_count: 2,
                },
            }
        );
    }
}
