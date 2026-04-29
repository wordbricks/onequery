use std::env;
use std::ffi::OsString;
use std::io::ErrorKind;
use std::path::MAIN_SEPARATOR;
use std::path::Path;
use std::path::PathBuf;
use std::process::Command;

use buffa::Message;
use buffa_codegen::generated::descriptor::FileDescriptorSet;

const PROTO_ROOT: &str = "proto";
const CLI_PROTO_DIR: &str = "onequery/cli/v1";
const CLI_PROTO_ENTRYPOINT: &str = "onequery/cli/v1/cli.proto";
const GOOGLE_RPC_ERROR_DETAILS_PROTO: &str = "google/rpc/error_details.proto";
const GENERATED_INCLUDE_FILE: &str = "_connectrpc.rs";

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
    let repo_root = onequery_utils::repo_root()
        .unwrap_or_else(|error| panic!("expected repo root from onequery-utils: {error}"));
    let discovered_proto_files = discover_proto_files(&repo_root);
    let cli_proto_entrypoint = PathBuf::from(CLI_PROTO_ENTRYPOINT);
    emit_rerun_triggers(&repo_root, &discovered_proto_files);

    let out_dir = env::var("OUT_DIR").unwrap_or_else(|error| panic!("expected OUT_DIR: {error}"));
    let descriptor_path = Path::new(&out_dir).join("onequery-proto-cli.fds");
    build_descriptor_set(&repo_root, &descriptor_path, &cli_proto_entrypoint);
    generate_connect_modules(
        &descriptor_path,
        Path::new(&out_dir),
        &discovered_proto_files,
    );
}

fn discover_proto_files(repo_root: &Path) -> Vec<PathBuf> {
    let cli_proto_dir = repo_root.join(PROTO_ROOT).join(CLI_PROTO_DIR);
    let entries = std::fs::read_dir(&cli_proto_dir).unwrap_or_else(|error| {
        panic!(
            "expected to read CLI proto directory {}: {error}",
            cli_proto_dir.display()
        )
    });
    let mut proto_files = entries
        .map(|entry| {
            entry.unwrap_or_else(|error| {
                panic!(
                    "expected to read CLI proto directory entry under {}: {error}",
                    cli_proto_dir.display()
                )
            })
        })
        .filter_map(|entry| {
            let path = entry.path();
            if !path.is_file()
                || path
                    .extension()
                    .is_none_or(|extension| extension != "proto")
            {
                return None;
            }

            Some(
                path.strip_prefix(repo_root.join(PROTO_ROOT))
                    .unwrap_or_else(|error| {
                        panic!(
                            "expected proto file {} to live under {}: {error}",
                            path.display(),
                            repo_root.join(PROTO_ROOT).display()
                        )
                    })
                    .to_path_buf(),
            )
        })
        .collect::<Vec<_>>();
    proto_files.sort();

    if proto_files.is_empty() {
        panic!(
            "expected at least one CLI proto file under {}",
            cli_proto_dir.display()
        );
    }

    proto_files
}

fn emit_rerun_triggers(repo_root: &Path, proto_files: &[PathBuf]) {
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
    println!(
        "cargo:rerun-if-changed={}",
        proto_root.join(CLI_PROTO_DIR).display()
    );
    for proto_file in proto_files {
        println!(
            "cargo:rerun-if-changed={}",
            proto_root.join(proto_file).display()
        );
    }
}

fn build_descriptor_set(repo_root: &Path, descriptor_path: &Path, cli_proto_entrypoint: &Path) {
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
            .arg(descriptor_path)
            .arg("--path")
            .arg(cli_proto_entrypoint);

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
         or run `nix shell nixpkgs#buf nixpkgs#protobuf --command cargo test -p onequery-proto-cli`",
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
        // COMMENT: `@bufbuild/buf` ships a JS launcher, not the real Buf
        // binary. Keep the fallback aligned with this repo's Bun runtime
        // instead of guessing platform-specific shims under node_modules/.bin.
        candidates.push(BufCommand::via_interpreter("bun", &workspace_buf));
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

fn generate_connect_modules(
    descriptor_path: &Path,
    out_dir: &Path,
    discovered_proto_files: &[PathBuf],
) {
    let descriptor_bytes = std::fs::read(descriptor_path).unwrap_or_else(|error| {
        panic!(
            "expected descriptor set at {}: {error}",
            descriptor_path.display()
        )
    });
    let file_descriptor_set = FileDescriptorSet::decode_from_slice(&descriptor_bytes)
        .unwrap_or_else(|error| {
            panic!(
                "expected descriptor set {} to decode: {error}",
                descriptor_path.display()
            )
        });

    let proto_files_to_generate =
        proto_relative_names_with_google_rpc_details(discovered_proto_files, &file_descriptor_set);
    let files_to_generate = proto_files_to_generate
        .iter()
        .map(PathBuf::from)
        .collect::<Vec<_>>();
    connectrpc_build::Config::new()
        .files(&files_to_generate)
        .descriptor_set(descriptor_path)
        .include_file(GENERATED_INCLUDE_FILE)
        .emit_register_fn(false)
        .compile()
        .unwrap_or_else(|error| {
            panic!(
                "expected ConnectRPC code generation from descriptor {} into {} to succeed: {error}",
                descriptor_path.display(),
                out_dir.display()
            )
        });
}

fn proto_relative_names(proto_files: &[PathBuf]) -> Vec<String> {
    proto_files
        .iter()
        .map(|proto_file| proto_relative_name(proto_file))
        .collect()
}

fn proto_relative_names_with_google_rpc_details(
    proto_files: &[PathBuf],
    descriptor_set: &FileDescriptorSet,
) -> Vec<String> {
    let mut proto_relative_names = proto_relative_names(proto_files);
    let google_rpc_error_details_present = descriptor_set.file.iter().any(|file_descriptor| {
        file_descriptor.name.as_deref() == Some(GOOGLE_RPC_ERROR_DETAILS_PROTO)
    });
    if google_rpc_error_details_present {
        proto_relative_names.push(GOOGLE_RPC_ERROR_DETAILS_PROTO.to_owned());
    }

    proto_relative_names
}

fn proto_relative_name(proto_file: &Path) -> String {
    let proto_relative_name = proto_file.to_str().map(str::to_owned).unwrap_or_else(|| {
        panic!(
            "expected proto-relative path {} to be valid UTF-8",
            proto_file.display()
        )
    });

    // COMMENT: Buf descriptor names always use `/`, even on Windows runners.
    // Normalize the discovered proto paths before handing them to Buffa and
    // Connect codegen so descriptor lookups stay platform-independent.
    proto_relative_name.replace(MAIN_SEPARATOR, "/")
}
