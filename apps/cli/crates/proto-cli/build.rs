use onequery_proto_build_support::ConnectProtoBuildConfig;

fn main() {
    onequery_proto_build_support::generate_connect_proto(&ConnectProtoBuildConfig::new(
        "onequery/cli/v1",
        "onequery/cli/v1/cli.proto",
        "onequery-proto-cli.fds",
        "_connectrpc.rs",
        "onequery-proto-cli",
    ));
}
