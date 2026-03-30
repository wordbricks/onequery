use reqwest::StatusCode;
use serde::Deserialize;
use serde::Serialize;

use crate::transport::client::AuthenticatedApiClient;
use crate::transport::generated::types;
use crate::transport::http::ApiFailure;
use crate::transport::http::ApiSuccess;
use crate::transport::http::ResponseFailureStages;
use crate::transport::http::decode_failure;
use crate::transport::http::failure_from_generated;
use crate::transport::http::response_request_id;
use crate::transport::http::try_into_option;
use crate::transport::http::try_into_value;
use crate::transport::pagination::optional_page_size;
use crate::transport::pagination::page_info_from_generated;
use crate::transport::read_controls::PageInfo;
use crate::transport::read_controls::ReadRequestControls;
use crate::transport::read_controls::SinglePageReadControls;
use onequery_cli_core::error::ErrorStage;

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

#[cfg(test)]
pub(crate) async fn list_orgs(
    client: &AuthenticatedApiClient,
) -> Result<ApiSuccess<OrgListPayload>, ApiFailure> {
    list_orgs_with_controls(client, &ReadRequestControls::default()).await
}

pub(crate) async fn get_org_with_controls(
    client: &AuthenticatedApiClient,
    org: &str,
    controls: &ReadRequestControls,
) -> Result<ApiSuccess<OrgDetails>, ApiFailure> {
    let org_slug = try_into_value(org, ErrorStage::ResolveOrg)?;
    let fields = try_into_option(controls.fields.as_deref(), ErrorStage::ResolveOrg)?;
    let response = match client.cli().cli_org_get(&org_slug, fields.as_ref()).await {
        Ok(response) => response,
        Err(error) => {
            return Err(failure_from_generated(
                error,
                ResponseFailureStages::fixed(ErrorStage::ResolveOrg, ErrorStage::Http),
            )
            .await);
        }
    };
    let request_id = response_request_id(response.headers());
    let payload = response.into_inner();

    Ok(ApiSuccess {
        payload: org_details_from_generated(payload.data),
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
    let cursor = try_into_option(controls.cursor.as_deref(), ErrorStage::Http)?;
    let fields = try_into_option(controls.fields.as_deref(), ErrorStage::Http)?;
    let limit = optional_page_size(controls.page_size, ErrorStage::Http)?;
    let response = match client
        .cli()
        .cli_org_list(cursor.as_ref(), fields.as_ref(), limit)
        .await
    {
        Ok(response) => response,
        Err(error) => {
            return Err(failure_from_generated(
                error,
                ResponseFailureStages::from_status(fallback_stage_for_status, ErrorStage::Http),
            )
            .await);
        }
    };
    let request_id = response_request_id(response.headers());
    let payload = response.into_inner();
    let page = payload.page.ok_or_else(|| {
        decode_failure(
            ErrorStage::Http,
            "organization list response missing page metadata",
            request_id.clone(),
        )
    })?;

    Ok(ApiSuccess {
        payload: OrgListPayload {
            organizations: payload
                .data
                .organizations
                .into_iter()
                .map(org_summary_from_generated)
                .collect(),
            page: page_info_from_generated(page),
        },
        request_id,
    })
}

fn fallback_stage_for_status(status: StatusCode) -> ErrorStage {
    if matches!(status, StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN) {
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

fn org_summary_from_generated(summary: types::CliOrgSummary) -> OrgSummary {
    OrgSummary {
        slug: summary.slug.map(Into::into),
        name: summary.name.map(Into::into),
    }
}

fn org_details_from_generated(details: types::CliOrgReadResponse) -> OrgDetails {
    OrgDetails {
        slug: details.slug.map(Into::into),
        name: details.name.map(Into::into),
        roles: Some(details.roles.into_iter().map(Into::into).collect()),
        capabilities: Some(
            details
                .capabilities
                .into_iter()
                .map(|capability| capability.to_string())
                .collect(),
        ),
    }
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

    use crate::transport::client::AuthenticatedApiClient;
    use crate::transport::http::ApiFailure;
    use crate::transport::http::ApiProblem;
    use crate::transport::http::ApiSuccess;
    use crate::transport::read_controls::PageInfo;
    use crate::transport::read_controls::ReadRequestControls;
    use onequery_cli_core::error::ErrorStage;

    use super::OrgDetails;
    use super::OrgListPayload;
    use super::OrgSummary;
    use super::fallback_stage_for_status;
    use super::get_org_with_controls;
    use super::list_orgs;

    fn success_envelope(request_id: &str, data: serde_json::Value) -> String {
        json!({
            "requestId": request_id,
            "data": data,
            "warnings": [],
        })
        .to_string()
    }

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
    fn fallback_stage_for_status_maps_auth_failures_to_auth_stage() {
        assert_eq!(
            [
                fallback_stage_for_status(StatusCode::UNAUTHORIZED),
                fallback_stage_for_status(StatusCode::FORBIDDEN),
                fallback_stage_for_status(StatusCode::BAD_REQUEST),
            ],
            [ErrorStage::Auth, ErrorStage::Auth, ErrorStage::Http]
        );
    }

    #[tokio::test]
    async fn list_orgs_decodes_payload_and_request_id() {
        let listener =
            TcpListener::bind("127.0.0.1:0").expect("expected test TCP listener to bind");
        let address = listener
            .local_addr()
            .expect("expected test listener address");
        let (request_line_tx, request_line_rx) = mpsc::channel();

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

            let request = String::from_utf8_lossy(&request_bytes);
            let request_line = request
                .lines()
                .next()
                .expect("expected HTTP request line")
                .to_owned();
            request_line_tx
                .send(request_line)
                .expect("expected request line receiver");

            let response_body = paged_success_envelope(
                "req_orgs",
                json!({
                    "organizations": [
                        {"slug": "acme", "name": "Acme"},
                        {"slug": "globex", "name": "Globex"},
                    ],
                }),
                json!({
                    "nextCursor": null,
                    "returned": 2,
                    "hasMore": false,
                }),
            );
            let response = format!(
                "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nx-request-id: req_orgs\r\nconnection: close\r\n\r\n{}",
                response_body.len(),
                response_body
            );
            stream
                .write_all(response.as_bytes())
                .expect("expected response write to CLI");
        });

        let client = AuthenticatedApiClient::new(&format!("http://{address}"), 5, "pat_123")
            .expect("expected API client");

        let response = list_orgs(&client)
            .await
            .expect("expected org list response");
        let request_line = request_line_rx
            .recv_timeout(Duration::from_secs(2))
            .expect("expected captured request line");

        assert_eq!(
            (response, request_line),
            (
                ApiSuccess {
                    payload: OrgListPayload {
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
                    },
                    request_id: Some("req_orgs".to_owned()),
                },
                "GET /api/cli/organizations HTTP/1.1".to_owned(),
            )
        );
    }

    #[tokio::test]
    async fn list_orgs_maps_unauthorized_problem_to_auth_stage() {
        let listener =
            TcpListener::bind("127.0.0.1:0").expect("expected test TCP listener to bind");
        let address = listener
            .local_addr()
            .expect("expected test listener address");

        let response_body = json!({
            "type": "https://onequery.invalid/problems/cli/not-logged-in",
            "status": 401,
            "title": "Not Logged In",
            "detail": "no authenticated session was found",
            "code": "not_logged_in",
            "stage": "auth",
            "hint": "login via the OneQuery web app and retry",
            "requestId": "req_auth",
            "retryable": false,
        })
        .to_string();
        let expected_raw_body = response_body.clone();

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
                "HTTP/1.1 401 Unauthorized\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{}",
                response_body.len(),
                response_body
            );
            stream
                .write_all(response.as_bytes())
                .expect("expected response write to CLI");
        });

        let client = AuthenticatedApiClient::new(&format!("http://{address}"), 5, "pat_123")
            .expect("expected API client");

        let error = list_orgs(&client).await.expect_err("expected auth failure");

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
    async fn get_org_decodes_payload_and_projection_controls() {
        let listener =
            TcpListener::bind("127.0.0.1:0").expect("expected test TCP listener to bind");
        let address = listener
            .local_addr()
            .expect("expected test listener address");
        let (request_line_tx, request_line_rx) = mpsc::channel();

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

            let request = String::from_utf8_lossy(&request_bytes);
            let request_line = request
                .lines()
                .next()
                .expect("expected HTTP request line")
                .to_owned();
            request_line_tx
                .send(request_line)
                .expect("expected request line receiver");

            let response_body = success_envelope(
                "req_org",
                json!({
                    "slug": "acme",
                    "name": "Acme",
                    "roles": ["member", "admin"],
                    "capabilities": ["org.list", "org.read"],
                }),
            );
            let response = format!(
                "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nx-request-id: req_org\r\nconnection: close\r\n\r\n{}",
                response_body.len(),
                response_body
            );
            stream
                .write_all(response.as_bytes())
                .expect("expected response write to CLI");
        });

        let client = AuthenticatedApiClient::new(&format!("http://{address}"), 5, "pat_123")
            .expect("expected API client");

        let response = get_org_with_controls(
            &client,
            "acme",
            &ReadRequestControls {
                fields: Some("slug,capabilities".to_owned()),
                ..ReadRequestControls::default()
            },
        )
        .await
        .expect("expected org read response");
        let request_line = request_line_rx
            .recv_timeout(Duration::from_secs(2))
            .expect("expected captured request line");

        assert_eq!(
            (response, request_line),
            (
                ApiSuccess {
                    payload: OrgDetails {
                        slug: Some("acme".to_owned()),
                        name: Some("Acme".to_owned()),
                        roles: Some(vec!["member".to_owned(), "admin".to_owned()]),
                        capabilities: Some(vec!["org.list".to_owned(), "org.read".to_owned()]),
                    },
                    request_id: Some("req_org".to_owned()),
                },
                "GET /api/cli/organizations/acme?fields=slug%2Ccapabilities HTTP/1.1".to_owned(),
            )
        );
    }
}
