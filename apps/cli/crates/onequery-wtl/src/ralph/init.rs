use std::fs;
use std::path::Path;
use std::path::PathBuf;
use std::process::Command;
use std::time::SystemTime;

use serde::Serialize;
use sha2::Digest;
use sha2::Sha256;

use crate::error::WtlError;

use super::cli::RalphInitArgs;

#[derive(Debug, Clone, Serialize, Eq, PartialEq)]
pub struct InitResult {
    pub worktree_id: String,
    pub worktree_path: String,
    pub work_branch: String,
    pub base_branch: String,
    pub deps_installed: bool,
    pub build_verified: bool,
    pub runtime_root: String,
}

#[derive(Debug, Clone, Serialize, Eq, PartialEq)]
pub struct InitDryRunResult {
    pub command: &'static str,
    pub dry_run: bool,
    pub repo_root: String,
    pub worktree_path: String,
    pub worktree_id: String,
    pub work_branch: String,
    pub base_branch: String,
    pub runtime_root: String,
    pub planned_effects: Vec<String>,
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub struct PreparedEnvironment {
    pub init: InitResult,
    pub repo_root: PathBuf,
    pub worktree_path: PathBuf,
}

#[derive(Debug, Clone, Eq, PartialEq)]
struct RepoContext {
    repo_root: PathBuf,
    current_worktree_root: PathBuf,
    reusing_existing_worktree: bool,
}

pub fn run_init(args: &RalphInitArgs, cwd: &Path) -> Result<InitCommandResult, WtlError> {
    let repo = resolve_repo_context(cwd)?;
    let requested_branch = if repo.reusing_existing_worktree {
        run_git(&repo.current_worktree_root, ["branch", "--show-current"])?
    } else {
        args.work_branch
            .clone()
            .unwrap_or_else(|| default_work_branch_for_prompt("init"))
    };
    let worktree_path = derive_target_worktree_path(&repo, &requested_branch);
    let worktree_id = derive_worktree_id(if repo.reusing_existing_worktree {
        &repo.current_worktree_root
    } else {
        &worktree_path
    })?;
    let runtime_root = format!(".worktree/{worktree_id}");

    if args.dry_run {
        return Ok(InitCommandResult::DryRun(InitDryRunResult {
            command: "init",
            dry_run: true,
            repo_root: repo.repo_root.to_string_lossy().into_owned(),
            worktree_path: if repo.reusing_existing_worktree {
                repo.current_worktree_root.to_string_lossy().into_owned()
            } else {
                worktree_path.to_string_lossy().into_owned()
            },
            worktree_id,
            work_branch: requested_branch,
            base_branch: args.base_branch.clone(),
            runtime_root,
            planned_effects: vec![
                "resolve repository root".to_owned(),
                "create or reuse worktree".to_owned(),
                "clean git state in the worktree".to_owned(),
                "install Bun dependencies with `bun install --frozen-lockfile`".to_owned(),
                "verify the repository with `bun run typecheck`".to_owned(),
                "ensure .worktree/plans scaffolding exists".to_owned(),
                "create .worktree/<id> runtime directories".to_owned(),
            ],
        }));
    }

    let worktree_path = ensure_worktree(&repo, &args.base_branch, &requested_branch)?;
    clean_git_state(&worktree_path)?;
    ensure_plan_scaffold(&worktree_path)?;
    install_dependencies(&worktree_path)?;
    verify_build(&worktree_path)?;
    ensure_env_config(&worktree_path, &worktree_id)?;
    let runtime_root_path = worktree_path.join(".worktree").join(&worktree_id);
    ensure_runtime_root(&runtime_root_path)?;

    Ok(InitCommandResult::Prepared(PreparedEnvironment {
        init: InitResult {
            worktree_id: worktree_id.clone(),
            worktree_path: worktree_path.to_string_lossy().into_owned(),
            work_branch: requested_branch,
            base_branch: args.base_branch.clone(),
            deps_installed: true,
            build_verified: true,
            runtime_root: format!(".worktree/{worktree_id}"),
        },
        repo_root: repo.repo_root,
        worktree_path,
    }))
}

pub enum InitCommandResult {
    DryRun(InitDryRunResult),
    Prepared(PreparedEnvironment),
}

pub fn cleanup_worktree(repo_root: &Path, worktree_path: &Path) -> Result<(), WtlError> {
    let repo_root = canonicalize_or_original(repo_root.to_path_buf())?;
    let worktree_path = canonicalize_or_original(worktree_path.to_path_buf())?;
    if repo_root == worktree_path {
        return Ok(());
    }

    let mut command = Command::new("git");
    command
        .arg("-C")
        .arg(&repo_root)
        .arg("worktree")
        .arg("remove")
        .arg("--force")
        .arg(&worktree_path);
    run_command(command)
}

fn resolve_repo_context(cwd: &Path) -> Result<RepoContext, WtlError> {
    let current_worktree_root = canonicalize_or_original(
        run_git(cwd, ["rev-parse", "--show-toplevel"])?
            .trim()
            .into(),
    )?;
    let common_dir_text = run_git(cwd, ["rev-parse", "--git-common-dir"])?;
    let common_dir = {
        let candidate = PathBuf::from(common_dir_text.trim());
        if candidate.is_absolute() {
            candidate
        } else {
            current_worktree_root.join(candidate)
        }
    };
    let repo_root = canonicalize_or_original(
        common_dir
            .parent()
            .ok_or_else(|| WtlError::InvalidPath("git common dir had no parent".to_owned()))?
            .to_path_buf(),
    )?;

    Ok(RepoContext {
        reusing_existing_worktree: current_worktree_root != repo_root,
        repo_root,
        current_worktree_root,
    })
}

fn derive_target_worktree_path(repo: &RepoContext, work_branch: &str) -> PathBuf {
    if repo.reusing_existing_worktree {
        return repo.current_worktree_root.clone();
    }

    repo.repo_root
        .join(".worktrees")
        .join(work_branch.trim_start_matches("ralph-"))
}

pub fn default_work_branch_for_prompt(seed: &str) -> String {
    let mut slug = seed
        .chars()
        .flat_map(char::to_lowercase)
        .map(|ch| if ch.is_ascii_alphanumeric() { ch } else { '-' })
        .collect::<String>();
    while slug.contains("--") {
        slug = slug.replace("--", "-");
    }
    let slug = slug.trim_matches('-');
    let slug = if slug.is_empty() { "task" } else { slug };
    format!("ralph-{slug}")
}

fn ensure_worktree(
    repo: &RepoContext,
    base_branch: &str,
    work_branch: &str,
) -> Result<PathBuf, WtlError> {
    if repo.reusing_existing_worktree {
        return Ok(repo.current_worktree_root.clone());
    }

    let worktree_path = derive_target_worktree_path(repo, work_branch);
    if worktree_path.join(".git").exists() {
        return canonicalize_or_original(worktree_path);
    }

    fs::create_dir_all(
        worktree_path
            .parent()
            .ok_or_else(|| WtlError::InvalidPath("worktree path had no parent".to_owned()))?,
    )
    .map_err(WtlError::RuntimeIo)?;

    let base_ref = resolve_base_ref(&repo.repo_root, base_branch)?;
    let mut command = Command::new("git");
    command
        .arg("-C")
        .arg(&repo.repo_root)
        .arg("worktree")
        .arg("add")
        .arg("-b")
        .arg(work_branch)
        .arg(&worktree_path)
        .arg(base_ref);
    run_command(command)?;

    canonicalize_or_original(worktree_path)
}

fn resolve_base_ref(repo_root: &Path, base_branch: &str) -> Result<String, WtlError> {
    let local_ref = format!("refs/heads/{base_branch}");
    if git_ref_exists(repo_root, &local_ref)? {
        return Ok(base_branch.to_owned());
    }

    let remote_ref = format!("refs/remotes/origin/{base_branch}");
    if git_ref_exists(repo_root, &remote_ref)? {
        return Ok(format!("origin/{base_branch}"));
    }

    Err(WtlError::CommandFailed {
        program: "git".to_owned(),
        message: format!("base branch `{base_branch}` does not exist locally or on origin"),
    })
}

fn git_ref_exists(repo_root: &Path, reference: &str) -> Result<bool, WtlError> {
    let output = Command::new("git")
        .arg("-C")
        .arg(repo_root)
        .arg("show-ref")
        .arg("--verify")
        .arg(reference)
        .output()
        .map_err(WtlError::RuntimeIo)?;
    Ok(output.status.success())
}

fn clean_git_state(worktree_path: &Path) -> Result<(), WtlError> {
    let status = run_git(worktree_path, ["status", "--porcelain"])?;
    if status.trim().is_empty() {
        return Ok(());
    }

    let mut command = Command::new("git");
    command
        .arg("-C")
        .arg(worktree_path)
        .arg("stash")
        .arg("push")
        .arg("-u")
        .arg("-m")
        .arg(format!(
            "ralph-loop init auto-stash {:?}",
            SystemTime::now()
        ));
    run_command(command)
}

fn install_dependencies(worktree_path: &Path) -> Result<(), WtlError> {
    if !worktree_path.join("package.json").exists() {
        return Ok(());
    }

    let mut command = Command::new("bun");
    command
        .arg("install")
        .arg("--frozen-lockfile")
        .current_dir(worktree_path);
    run_command(command)
}

fn verify_build(worktree_path: &Path) -> Result<(), WtlError> {
    let mut command = Command::new("bun");
    command
        .arg("run")
        .arg("typecheck")
        .current_dir(worktree_path);
    run_command(command)
}

fn ensure_env_config(worktree_path: &Path, worktree_id: &str) -> Result<(), WtlError> {
    let env_example = worktree_path.join(".env.example");
    let env_path = worktree_path.join(".env");
    if env_example.exists() && !env_path.exists() {
        fs::copy(env_example, &env_path).map_err(WtlError::RuntimeIo)?;
    }

    if !env_path.exists() {
        return Ok(());
    }

    let existing = fs::read_to_string(&env_path).map_err(WtlError::RuntimeIo)?;
    if existing.contains("DISCODE_WORKTREE_ID=") {
        return Ok(());
    }

    let mut next = existing;
    if !next.ends_with('\n') {
        next.push('\n');
    }
    next.push_str(&format!("DISCODE_WORKTREE_ID={worktree_id}\n"));
    fs::write(env_path, next).map_err(WtlError::RuntimeIo)
}

fn ensure_plan_scaffold(worktree_path: &Path) -> Result<(), WtlError> {
    let plans_dir = worktree_path.join(".worktree").join("plans");
    fs::create_dir_all(plans_dir.join("active")).map_err(WtlError::RuntimeIo)?;
    fs::create_dir_all(plans_dir.join("completed")).map_err(WtlError::RuntimeIo)?;

    let plans_path = plans_dir.join("README.md");
    if plans_path.exists() {
        return Ok(());
    }

    fs::write(
        plans_path,
        concat!(
            "# Ralph Loop Plans\n\n",
            "Internal Ralph Loop execution plans live under this directory.\n\n",
            "## Plan Template\n\n",
            "## Goal / scope\n\n",
            "## Background\n\n",
            "## Milestones\n",
            "- [ ] Milestone 1\n\n",
            "## Current progress\n\n",
            "## Key decisions\n\n",
            "## Remaining issues / open questions\n\n",
            "## Links to related documents\n"
        ),
    )
    .map_err(WtlError::RuntimeIo)
}

fn ensure_runtime_root(runtime_root: &Path) -> Result<(), WtlError> {
    fs::create_dir_all(runtime_root.join("logs")).map_err(WtlError::RuntimeIo)?;
    fs::create_dir_all(runtime_root.join("tmp")).map_err(WtlError::RuntimeIo)?;
    fs::create_dir_all(runtime_root.join("run")).map_err(WtlError::RuntimeIo)
}

fn derive_worktree_id(path: &Path) -> Result<String, WtlError> {
    let canonical = canonicalize_or_original(path.to_path_buf())?;
    let name = canonical
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("worktree");
    let mut hasher = Sha256::new();
    hasher.update(canonical.to_string_lossy().as_bytes());
    let digest = hasher.finalize();
    let hash = digest[..4]
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    Ok(format!("{name}-{hash}"))
}

fn run_git<const N: usize>(cwd: &Path, args: [&str; N]) -> Result<String, WtlError> {
    let output = Command::new("git")
        .args(args)
        .current_dir(cwd)
        .output()
        .map_err(WtlError::RuntimeIo)?;
    if output.status.success() {
        return Ok(String::from_utf8_lossy(&output.stdout).trim().to_owned());
    }

    Err(WtlError::ResolveRepoRoot {
        cwd: cwd.to_path_buf(),
        message: String::from_utf8_lossy(&output.stderr).trim().to_owned(),
    })
}

fn run_command(mut command: Command) -> Result<(), WtlError> {
    let program = command.get_program().to_string_lossy().into_owned();
    let output = command.output().map_err(WtlError::RuntimeIo)?;
    if output.status.success() {
        return Ok(());
    }

    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_owned();
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_owned();
    Err(WtlError::CommandFailed {
        program,
        message: if !stderr.is_empty() { stderr } else { stdout },
    })
}

fn canonicalize_or_original(path: PathBuf) -> Result<PathBuf, WtlError> {
    match path.canonicalize() {
        Ok(value) => Ok(value),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(path),
        Err(error) => Err(WtlError::RuntimeIo(error)),
    }
}
