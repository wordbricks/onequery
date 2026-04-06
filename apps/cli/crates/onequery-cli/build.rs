use std::env;
use std::path::Path;
use std::path::PathBuf;
use std::process::Command;

const PROTO_ROOT: &str = "proto";
const PROTO_FILES: [&str; 7] = [
    "onequery/cli/v1/auth.proto",
    "onequery/cli/v1/cli.proto",
    "onequery/cli/v1/common.proto",
    "onequery/cli/v1/org.proto",
    "onequery/cli/v1/query.proto",
    "onequery/cli/v1/source.proto",
    "onequery/cli/v1/use.proto",
];

fn main() {
    let manifest_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
    let repo_root = repo_root(manifest_dir);
    emit_rerun_triggers(&repo_root);

    let out_dir = env::var("OUT_DIR").unwrap_or_else(|error| panic!("expected OUT_DIR: {error}"));
    let descriptor_path = Path::new(&out_dir).join("onequery-cli.fds");
    build_descriptor_set(&repo_root, &descriptor_path);

    connectrpc_build::Config::new()
        .files(&PROTO_FILES)
        .descriptor_set(&descriptor_path)
        .emit_register_fn(false)
        .include_file("_connectrpc.rs")
        .compile()
        .unwrap_or_else(|error| panic!("expected Connect client generation to succeed: {error}"));
}

fn repo_root(manifest_dir: &Path) -> PathBuf {
    manifest_dir
        .join("../../../../")
        .canonicalize()
        .unwrap_or_else(|error| panic!("expected repo root from {manifest_dir:?}: {error}"))
}

fn emit_rerun_triggers(repo_root: &Path) {
    println!(
        "cargo:rerun-if-changed={}",
        repo_root.join("buf.yaml").display()
    );
    println!(
        "cargo:rerun-if-changed={}",
        repo_root.join("buf.gen.yaml").display()
    );
    println!(
        "cargo:rerun-if-changed={}",
        repo_root.join("buf.lock").display()
    );
    for proto_file in PROTO_FILES {
        println!(
            "cargo:rerun-if-changed={}",
            repo_root.join(PROTO_ROOT).join(proto_file).display()
        );
    }
}

fn build_descriptor_set(repo_root: &Path, descriptor_path: &Path) {
    let mut buf_command = Command::new("buf");
    buf_command
        .current_dir(repo_root)
        .arg("build")
        .arg("--as-file-descriptor-set")
        .arg("-o")
        .arg(descriptor_path);
    for proto_file in PROTO_FILES {
        buf_command
            .arg("--path")
            .arg(Path::new(PROTO_ROOT).join(proto_file));
    }

    let output = buf_command.output().unwrap_or_else(|error| {
        panic!(
            "expected to spawn `buf build` for descriptor generation: {error}. \
             Install `buf` or run `nix shell nixpkgs#buf nixpkgs#protobuf --command cargo test -p onequery-cli`"
        )
    });
    if !output.status.success() {
        panic!(
            "expected `buf build` descriptor generation to succeed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }
}
