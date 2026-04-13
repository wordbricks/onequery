use std::env;
use std::ffi::OsString;
use std::io::ErrorKind;
use std::path::MAIN_SEPARATOR;
use std::path::Path;
use std::path::PathBuf;
use std::process::Command;

use buffa::Message;
use buffa_codegen::CodeGenConfig;
use buffa_codegen::GeneratedFile;
use buffa_codegen::generated::descriptor::FileDescriptorProto;
use buffa_codegen::generated::descriptor::FileDescriptorSet;
use connectrpc_codegen::codegen::Options as ConnectOptions;

const PROTO_ROOT: &str = "proto";
const CLI_PROTO_DIR: &str = "onequery/cli/v1";
const CLI_PROTO_ENTRYPOINT: &str = "onequery/cli/v1/cli.proto";
const GOOGLE_RPC_ERROR_DETAILS_PROTO: &str = "google/rpc/error_details.proto";
const GENERATED_MODULE_ROOT: &str = "crate::transport::generated";
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
    let manifest_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
    let repo_root = repo_root(manifest_dir);
    let discovered_proto_files = discover_proto_files(&repo_root);
    let cli_proto_entrypoint = PathBuf::from(CLI_PROTO_ENTRYPOINT);
    emit_rerun_triggers(&repo_root, &discovered_proto_files);

    let out_dir = env::var("OUT_DIR").unwrap_or_else(|error| panic!("expected OUT_DIR: {error}"));
    let descriptor_path = Path::new(&out_dir).join("onequery-cli.fds");
    build_descriptor_set(&repo_root, &descriptor_path, &cli_proto_entrypoint);
    generate_connect_modules(
        &descriptor_path,
        Path::new(&out_dir),
        &discovered_proto_files,
        &cli_proto_entrypoint,
    );
}

fn repo_root(manifest_dir: &Path) -> PathBuf {
    manifest_dir
        .join("../../../../")
        .canonicalize()
        .unwrap_or_else(|error| panic!("expected repo root from {manifest_dir:?}: {error}"))
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
    cli_proto_entrypoint: &Path,
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
    let cli_service_entrypoint = proto_relative_name(cli_proto_entrypoint);
    let mut buffa_config = CodeGenConfig::default();
    buffa_config.generate_views = true;
    buffa_config.generate_json = true;
    buffa_config.emit_register_fn = false;

    let mut generated_files = buffa_codegen::generate(
        &file_descriptor_set.file,
        &proto_files_to_generate,
        &buffa_config,
    )
    .unwrap_or_else(|error| panic!("expected Buffa code generation to succeed: {error}"));

    // COMMENT: `connectrpc-build`'s unified path emits one Rust module per
    // `.files()` input. The CLI service entrypoint lives in `cli.proto`, but
    // its request/response messages are split across imported files, so we
    // generate message modules for every discovered proto and append only the
    // Connect client/service bindings from the single service entrypoint.
    let mut connect_options = ConnectOptions::default();
    connect_options
        .extern_paths
        .push((".".to_owned(), GENERATED_MODULE_ROOT.to_owned()));
    let connect_service_files = connectrpc_codegen::codegen::generate_services(
        &file_descriptor_set.file,
        std::slice::from_ref(&cli_service_entrypoint),
        &connect_options,
    )
    .unwrap_or_else(|error| panic!("expected Connect service generation to succeed: {error}"));
    append_connect_services(
        &mut generated_files,
        &connect_service_files,
        &cli_service_entrypoint,
    );

    write_generated_files(out_dir, &file_descriptor_set.file, &generated_files);
}

fn append_connect_services(
    generated_files: &mut [GeneratedFile],
    connect_service_files: &[GeneratedFile],
    cli_service_entrypoint: &str,
) {
    for service_file in connect_service_files {
        let target = generated_files
            .iter_mut()
            .find(|generated_file| generated_file.name == service_file.name)
            .unwrap_or_else(|| {
                panic!(
                    "expected generated module {} for service entrypoint {}",
                    service_file.name, cli_service_entrypoint
                )
            });
        target.content.push('\n');
        target.content.push_str(&service_file.content);
    }
}

fn write_generated_files(
    out_dir: &Path,
    file_descriptors: &[FileDescriptorProto],
    generated_files: &[GeneratedFile],
) {
    std::fs::create_dir_all(out_dir)
        .unwrap_or_else(|error| panic!("expected output directory {}: {error}", out_dir.display()));

    for generated_file in generated_files {
        write_if_changed(
            &out_dir.join(&generated_file.name),
            generated_file.content.as_bytes(),
        );
    }

    let packages_by_generated_file = file_descriptors
        .iter()
        .filter_map(|file_descriptor| {
            let proto_name = file_descriptor.name.as_deref()?;
            Some((
                buffa_codegen::proto_path_to_rust_module(proto_name),
                file_descriptor
                    .package
                    .as_deref()
                    .unwrap_or_default()
                    .to_owned(),
            ))
        })
        .collect::<std::collections::HashMap<_, _>>();
    let mut module_tree_entries = generated_files
        .iter()
        .map(|generated_file| {
            let package = packages_by_generated_file
                .get(&generated_file.name)
                .unwrap_or_else(|| panic!("expected package for {}", generated_file.name));
            (generated_file.name.as_str(), package.as_str())
        })
        .collect::<Vec<_>>();
    module_tree_entries.sort_unstable_by(|(left, _), (right, _)| left.cmp(right));

    let module_tree = buffa_codegen::generate_module_tree(&module_tree_entries, "", false);
    write_if_changed(
        &out_dir.join(GENERATED_INCLUDE_FILE),
        module_tree.as_bytes(),
    );
}

fn write_if_changed(path: &Path, contents: &[u8]) {
    let matches_existing = std::fs::read(path)
        .map(|existing_contents| existing_contents == contents)
        .unwrap_or(false);
    if matches_existing {
        return;
    }

    std::fs::write(path, contents).unwrap_or_else(|error| {
        panic!(
            "expected to write generated file {}: {error}",
            path.display()
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
