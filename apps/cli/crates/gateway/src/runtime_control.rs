pub(crate) type RuntimeControlClient =
    onequery_proto_runtime::onequery::runtime::v1::RuntimeControlServiceClient<
        connectrpc::client::SharedHttp2Connection,
    >;
#[allow(unused_imports)]
pub(crate) use onequery_proto_runtime::onequery::runtime::v1 as types;
