#![allow(dead_code)]
#![allow(clippy::unwrap_used)]

include!(concat!(env!("OUT_DIR"), "/_connectrpc.rs"));

pub(crate) type Client = onequery::cli::v1::CliServiceClient<connectrpc::client::HttpClient>;
pub(crate) use onequery::cli::v1 as types;
