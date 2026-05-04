use std::collections::BTreeSet;
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
const GOOGLE_RPC_ERROR_DETAILS_PROTO: &str = "google/rpc/error_details.proto";

#[derive(Debug, Clone)]
struct ConnectProtoBuildConfig {
    proto_dir: &'static str,
    descriptor_path: &'static str,
    descriptor_file_name: &'static str,
    include_file_name: &'static str,
    output_dir: &'static str,
    crate_name: &'static str,
}

impl ConnectProtoBuildConfig {
    #[must_use]
    const fn new(
        proto_dir: &'static str,
        descriptor_path: &'static str,
        descriptor_file_name: &'static str,
        include_file_name: &'static str,
        output_dir: &'static str,
        crate_name: &'static str,
    ) -> Self {
        Self {
            proto_dir,
            descriptor_path,
            descriptor_file_name,
            include_file_name,
            output_dir,
            crate_name,
        }
    }
}

const CONNECT_PROTO_CONFIGS: &[ConnectProtoBuildConfig] = &[
    ConnectProtoBuildConfig::new(
        "onequery/cli/v1",
        "onequery/cli/v1/cli.proto",
        "onequery-proto-cli.fds",
        "_connectrpc.rs",
        "apps/cli/crates/proto-cli/src/generated",
        "onequery-proto-cli",
    ),
    ConnectProtoBuildConfig::new(
        "onequery/runtime/v1",
        "onequery/runtime/v1",
        "onequery-proto-runtime.fds",
        "_runtime_control_connectrpc.rs",
        "apps/cli/crates/proto-runtime/src/generated",
        "onequery-proto-runtime",
    ),
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

pub fn generate_all_connect_proto() {
    for config in CONNECT_PROTO_CONFIGS {
        generate_connect_proto(config);
    }
}

fn generate_connect_proto(config: &ConnectProtoBuildConfig) {
    let repo_root = onequery_utils::repo_root()
        .unwrap_or_else(|error| panic!("expected repo root from onequery-utils: {error}"));
    let discovered_proto_files = discover_proto_files(&repo_root, config.proto_dir);

    let descriptor_dir = repo_root
        .join("apps")
        .join("cli")
        .join("target")
        .join("proto-descriptors");
    std::fs::create_dir_all(&descriptor_dir).unwrap_or_else(|error| {
        panic!(
            "expected descriptor directory {} to be creatable: {error}",
            descriptor_dir.display()
        )
    });
    let descriptor_path = descriptor_dir.join(config.descriptor_file_name);
    build_descriptor_set(
        &repo_root,
        descriptor_path.as_path(),
        Path::new(config.descriptor_path),
        config.crate_name,
    );
    let output_dir = repo_root.join(config.output_dir);
    generate_connect_modules(
        descriptor_path.as_path(),
        &discovered_proto_files,
        config.include_file_name,
        &output_dir,
    );
}

fn discover_proto_files(repo_root: &Path, proto_dir: &str) -> Vec<PathBuf> {
    let proto_dir_path = repo_root.join(PROTO_ROOT).join(proto_dir);
    let entries = std::fs::read_dir(&proto_dir_path).unwrap_or_else(|error| {
        panic!(
            "expected proto directory {}: {error}",
            proto_dir_path.display()
        )
    });
    let mut proto_files = entries
        .map(|entry| {
            entry.unwrap_or_else(|error| {
                panic!(
                    "expected to read proto directory entry under {}: {error}",
                    proto_dir_path.display()
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
            "expected at least one proto file under {}",
            proto_dir_path.display()
        );
    }

    proto_files
}

fn build_descriptor_set(
    repo_root: &Path,
    descriptor_path: &Path,
    proto_entrypoint: &Path,
    crate_name: &str,
) {
    let proto_root = repo_root.join(PROTO_ROOT);
    let candidates = candidate_buf_commands(repo_root);
    let tried_candidates = candidates
        .iter()
        .map(|candidate| candidate.display.clone())
        .collect::<Vec<_>>();
    let mut spawn_errors = Vec::new();
    for candidate in candidates {
        let mut buf_command = Command::new(&candidate.program);
        // COMMENT: `connectrpc_build::Config::use_buf()` owns the normal Buf
        // path, but it cannot choose this repo's BUF_BIN/Bun launcher or run
        // from the nested proto workspace. Keep this wrapper limited to
        // descriptor acquisition, then hand the descriptor back to
        // connectrpc-build for code generation.
        buf_command
            .args(&candidate.prefix_args)
            .current_dir(&proto_root)
            .arg("build")
            .arg("--as-file-descriptor-set")
            .arg("-o")
            .arg(descriptor_path)
            .arg("--path")
            .arg(proto_entrypoint);

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
         or run `nix shell nixpkgs#buf nixpkgs#protobuf --command cargo test -p {crate_name}`",
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
    discovered_proto_files: &[PathBuf],
    include_file_name: &str,
    output_dir: &Path,
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
        .out_dir(output_dir)
        .include_file(include_file_name)
        .emit_register_fn(false)
        .compile()
        .unwrap_or_else(|error| {
            panic!(
                "expected ConnectRPC code generation from descriptor {} to succeed: {error}",
                descriptor_path.display()
            )
        });
    remove_stale_generated_modules(output_dir, include_file_name, &proto_files_to_generate);
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

fn remove_stale_generated_modules(
    output_dir: &Path,
    include_file_name: &str,
    proto_files_to_generate: &[String],
) {
    let mut expected_files = proto_files_to_generate
        .iter()
        .map(|proto_file| buffa_codegen::proto_path_to_rust_module(proto_file))
        .collect::<BTreeSet<_>>();
    expected_files.insert(include_file_name.to_owned());

    let entries = std::fs::read_dir(output_dir).unwrap_or_else(|error| {
        panic!(
            "expected generated output directory {}: {error}",
            output_dir.display()
        )
    });
    for entry in entries {
        let entry = entry.unwrap_or_else(|error| {
            panic!(
                "expected to read generated output directory entry under {}: {error}",
                output_dir.display()
            )
        });
        let path = entry.path();
        if !path.is_file() || path.extension().is_none_or(|extension| extension != "rs") {
            continue;
        }

        let file_name = entry.file_name().to_string_lossy().into_owned();
        if expected_files.contains(&file_name) {
            continue;
        }

        std::fs::remove_file(&path).unwrap_or_else(|error| {
            panic!(
                "expected stale generated Rust file {} to be removable: {error}",
                path.display()
            )
        });
    }
}
