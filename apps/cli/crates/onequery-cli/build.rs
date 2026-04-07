use std::env;
use std::ffi::OsString;
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

struct BufCommand {
    program: PathBuf,
    prefix_args: Vec<OsString>,
    display: String,
}

impl BufCommand {
    fn direct(program: impl Into<PathBuf>) -> Self {
        let program = program.into();
        Self {
            display: program.display().to_string(),
            program,
            prefix_args: Vec::new(),
        }
    }

    fn via_interpreter(interpreter: &str, script: &Path) -> Self {
        Self {
            display: format!("{interpreter} {}", script.display()),
            program: PathBuf::from(interpreter),
            prefix_args: vec![script.as_os_str().to_os_string()],
        }
    }
}

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
    let candidates = candidate_buf_commands(repo_root);
    let tried_candidates = candidates
        .iter()
        .map(|candidate| candidate.display.clone())
        .collect::<Vec<_>>();
    let mut spawn_errors = Vec::new();
    for candidate in candidates {
        let mut buf_command = Command::new(&candidate.program);
        // Buf config now lives under proto/, so descriptor builds must run from
        // that workspace root while the generated descriptor still lands in OUT_DIR.
        buf_command
            .args(&candidate.prefix_args)
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
                    "expected descriptor generation via `{}` to succeed: {}",
                    candidate.display,
                    String::from_utf8_lossy(&output.stderr)
                );
            }
            Err(error) if error.kind() == ErrorKind::NotFound => {
                spawn_errors.push(format!("{}: {error}", candidate.display));
            }
            Err(error) => {
                panic!(
                    "expected to spawn `{}` for descriptor generation: {error}",
                    candidate.display
                );
            }
        }
    }

    panic!(
        "expected to find `buf` for descriptor generation. Tried: {}. \
         Install dependencies with `bun install`, install `buf`, set BUF_BIN, \
         or run `nix shell nixpkgs#buf nixpkgs#protobuf --command cargo test -p onequery-cli`",
        if spawn_errors.is_empty() {
            tried_candidates.join(", ")
        } else {
            spawn_errors.join(", ")
        }
    );
}

fn candidate_buf_commands(repo_root: &Path) -> Vec<BufCommand> {
    let mut candidates = Vec::new();
    if let Some(configured) = env::var_os("BUF_BIN") {
        let configured = PathBuf::from(configured);
        if !configured.as_os_str().is_empty() {
            candidates.push(BufCommand::direct(configured));
        }
    }
    candidates.push(BufCommand::direct("buf"));

    let workspace_buf = workspace_buf_script(repo_root);
    if workspace_buf.exists() {
        // COMMENT: `@bufbuild/buf` ships a JS launcher. Bun's Windows install
        // did not materialize a stable `node_modules/.bin/buf.cmd` shim for
        // Cargo to spawn directly, so invoke the launcher through Bun/Node
        // instead of guessing platform-specific bin-link names.
        if !cfg!(windows) {
            candidates.push(BufCommand::direct(workspace_buf.clone()));
        }
        candidates.push(BufCommand::via_interpreter("bun", &workspace_buf));
        candidates.push(BufCommand::via_interpreter("node", &workspace_buf));
    }
    candidates
}

fn workspace_buf_script(repo_root: &Path) -> PathBuf {
    repo_root
        .join("node_modules")
        .join("@bufbuild")
        .join("buf")
        .join("bin")
        .join("buf")
}
