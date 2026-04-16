use std::io::Write;

use buffa::Message;
use buffa::MessageField;

use crate::transport::generated::types;

pub(crate) fn refresh_session_response_body(
    access_token: &str,
    active_org_slug: Option<&str>,
    issued_at_seconds: i64,
    expires_at_seconds: i64,
) -> Vec<u8> {
    types::RefreshSessionResponse {
        access_token: Some(access_token.to_owned()),
        auth_mode: Some(types::AuthMode::AUTH_MODE_BEARER_TOKEN.into()),
        user: MessageField::some(types::CliAuthUser {
            id: Some("user-1".to_owned()),
            email: Some("alice@example.com".to_owned()),
            display_name: Some("Alice".to_owned()),
            ..Default::default()
        }),
        active_org_slug: active_org_slug.map(ToOwned::to_owned),
        issued_at: MessageField::some(timestamp(issued_at_seconds)),
        expires_at: MessageField::some(timestamp(expires_at_seconds)),
        ..Default::default()
    }
    .encode_to_bytes()
    .to_vec()
}

pub(crate) fn write_proto_response(
    stream: &mut std::net::TcpStream,
    request_id: &str,
    body: &[u8],
) -> std::io::Result<()> {
    let response_head = format!(
        "HTTP/1.1 200 OK\r\ncontent-type: application/proto\r\nx-request-id: {request_id}\r\ncontent-length: {}\r\nconnection: close\r\n\r\n",
        body.len(),
    );
    stream.write_all(response_head.as_bytes())?;
    stream.write_all(body)
}

fn timestamp(seconds: i64) -> buffa_types::google::protobuf::Timestamp {
    buffa_types::google::protobuf::Timestamp {
        seconds,
        ..Default::default()
    }
}
