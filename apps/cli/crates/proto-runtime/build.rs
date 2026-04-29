use onequery_proto_build_support::ConnectProtoBuildConfig;

fn main() {
    onequery_proto_build_support::generate_connect_proto(&ConnectProtoBuildConfig::new(
        "onequery/runtime/v1",
        "onequery/runtime/v1",
        "onequery-proto-runtime.fds",
        "_runtime_control_connectrpc.rs",
        "onequery-proto-runtime",
    ));
}
