#![allow(dead_code)]
#![allow(clippy::unwrap_used)]
// Generated Connect/Buffa transport code does not follow this workspace's
// stricter Clippy policy. Keep the lint boundary at the checked-in wrapper
// rather than patching emitted files under OUT_DIR.
#![allow(clippy::redundant_closure)]
#![allow(clippy::redundant_closure_for_method_calls)]
#![allow(clippy::enum_variant_names)]
#![allow(clippy::uninlined_format_args)]

include!(concat!(env!("OUT_DIR"), "/_connectrpc.rs"));

pub(crate) type AuthClient =
    onequery::cli::v1::CliAuthServiceClient<connectrpc::client::HttpClient>;
pub(crate) type OrganizationClient =
    onequery::cli::v1::CliOrganizationServiceClient<connectrpc::client::HttpClient>;
pub(crate) type SourceClient =
    onequery::cli::v1::CliSourceServiceClient<connectrpc::client::HttpClient>;
pub(crate) type SourceApiClient =
    onequery::cli::v1::CliSourceApiServiceClient<connectrpc::client::HttpClient>;
pub(crate) type QueryClient =
    onequery::cli::v1::CliQueryServiceClient<connectrpc::client::HttpClient>;
pub(crate) use onequery::cli::v1 as types;
