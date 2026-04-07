use std::env;
use std::io::ErrorKind;
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
    let proto_root = repo_root.join(PROTO_ROOT);
    println!(
        "cargo:rerun-if-changed={}",
        proto_root.join("buf.yaml").display()
    );
    println!(
        "cargo:rerun-if-changed={}",
        proto_root.join("buf.gen.yaml").display()
    );
    println!(
        "cargo:rerun-if-changed={}",
        proto_root.join("buf.lock").display()
    );
    for proto_file in PROTO_FILES {
        println!(
            "cargo:rerun-if-changed={}",
            proto_root.join(proto_file).display()
        );
    }
}

fn build_descriptor_set(repo_root: &Path, descriptor_path: &Path) {
    let proto_root = repo_root.join(PROTO_ROOT);
    let mut spawn_errors = Vec::new();
    for executable in candidate_buf_executables(repo_root) {
        let mut buf_command = Command::new(&executable);
        // Buf config now lives under proto/, so descriptor builds must run from
        // that workspace root while the generated descriptor still lands in OUT_DIR.
        buf_command
            .current_dir(&proto_root)
            .arg("build")
            .arg(".")
            .arg("--as-file-descriptor-set")
            .arg("-o")
            .arg(descriptor_path);
        for proto_file in PROTO_FILES {
            buf_command.arg("--path").arg(proto_file);
        }

        match buf_command.output() {
            Ok(output) => {
                if output.status.success() {
                    return;
                }

                panic!(
                    "expected `{} build` descriptor generation to succeed: {}",
                    executable.display(),
                    String::from_utf8_lossy(&output.stderr)
                );
            }
            Err(error) if error.kind() == ErrorKind::NotFound => {
                spawn_errors.push(format!("{}: {error}", executable.display()));
            }
            Err(error) => {
                panic!(
                    "expected to spawn `{}` for descriptor generation: {error}",
                    executable.display()
                );
            }
        }
    }

    let workspace_buf = workspace_buf_executable(repo_root);
    panic!(
        "expected to find `buf` for descriptor generation. Tried: {}. \
         Install dependencies with `bun install`, install `buf`, set BUF_BIN, \
         or run `nix shell nixpkgs#buf nixpkgs#protobuf --command cargo test -p onequery-cli`",
        if spawn_errors.is_empty() {
            format!("buf and {}", workspace_buf.display())
        } else {
            spawn_errors.join(", ")
        }
    );
}

fn candidate_buf_executables(repo_root: &Path) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(configured) = env::var_os("BUF_BIN") {
        let configured = PathBuf::from(configured);
        if !configured.as_os_str().is_empty() {
            candidates.push(configured);
        }
    }
    candidates.push(PathBuf::from("buf"));
    candidates.push(workspace_buf_executable(repo_root));
    candidates
}

fn workspace_buf_executable(repo_root: &Path) -> PathBuf {
    let bin_dir = repo_root.join("node_modules").join(".bin");

    if cfg!(windows) {
        return bin_dir.join("buf.cmd");
    }

    bin_dir.join("buf")
}
