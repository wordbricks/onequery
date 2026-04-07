#![allow(dead_code)]
#![allow(clippy::unwrap_used)]
// Generated Connect/Buffa transport code does not follow this workspace's
// stricter Clippy policy. Keep the lint boundary at the checked-in wrapper
// rather than patching emitted files under OUT_DIR.
#![allow(clippy::redundant_closure)]
#![allow(clippy::redundant_closure_for_method_calls)]
#![allow(clippy::uninlined_format_args)]

include!(concat!(env!("OUT_DIR"), "/_connectrpc.rs"));

pub(crate) type Client = onequery::cli::v1::CliServiceClient<connectrpc::client::HttpClient>;
pub(crate) use onequery::cli::v1 as types;
