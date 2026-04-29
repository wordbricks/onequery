pub(crate) type AuthClient =
    onequery_proto_cli::onequery::cli::v1::CliAuthServiceClient<connectrpc::client::HttpClient>;
pub(crate) type OrganizationClient =
    onequery_proto_cli::onequery::cli::v1::CliOrganizationServiceClient<
        connectrpc::client::HttpClient,
    >;
pub(crate) type SourceClient =
    onequery_proto_cli::onequery::cli::v1::CliSourceServiceClient<connectrpc::client::HttpClient>;
pub(crate) type SourceApiClient = onequery_proto_cli::onequery::cli::v1::CliSourceApiServiceClient<
    connectrpc::client::HttpClient,
>;
pub(crate) type QueryClient =
    onequery_proto_cli::onequery::cli::v1::CliQueryServiceClient<connectrpc::client::HttpClient>;
pub(crate) use onequery_proto_cli::google;
pub(crate) use onequery_proto_cli::onequery::cli::v1 as types;
