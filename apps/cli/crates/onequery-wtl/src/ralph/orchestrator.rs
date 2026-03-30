use std::io::Write;
use std::path::Path;
use std::path::PathBuf;

use serde::Serialize;

use crate::engine::EngineConfig;
use crate::engine::RunTerminalState;
use crate::error::WtlError;
use crate::observer::CliObserver;
use crate::policy::CodingLoopPolicy;
use crate::policy::CompletionTokenPolicy;
use crate::policy::default_plan_path;
use crate::runtime::codex_app_server::CodexAppServerRuntime;
use crate::runtime::codex_app_server::CodexRuntimeConfig;

use super::cli::RalphInitArgs;
use super::cli::RalphRunArgs;
use super::init::InitCommandResult;
use super::init::InitDryRunResult;
use super::init::InitResult;
use super::init::cleanup_worktree;
use super::init::default_work_branch_for_prompt;
use super::init::run_init;
use super::prompts::build_pr_prompt;
use super::prompts::build_setup_prompt;
use super::prompts::pr_developer_instructions;
use super::prompts::setup_developer_instructions;

#[derive(Debug, Clone, Serialize, Eq, PartialEq)]
pub struct RalphRunResult {
    pub command: &'static str,
    pub status: String,
    pub worktree_id: String,
    pub worktree_path: String,
    pub work_branch: String,
    pub base_branch: String,
    pub iterations: usize,
    pub plan_path: String,
    pub pr_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Eq, PartialEq)]
pub struct RalphRunDryRunResult {
    pub command: &'static str,
    pub dry_run: bool,
    pub init: InitDryRunResult,
    pub plan_path: String,
}

pub async fn run_main(args: &RalphRunArgs, cwd: &Path) -> Result<RalphCommandResult, WtlError> {
    let init_args = RalphInitArgs {
        output: args.output,
        base_branch: args.base_branch.clone(),
        work_branch: args
            .work_branch
            .clone()
            .or_else(|| Some(default_work_branch_for_prompt(&args.prompt))),
        dry_run: args.dry_run,
        cwd: Some(cwd.to_path_buf()),
    };

    let prepared = match run_init(&init_args, cwd)? {
        InitCommandResult::Prepared(prepared) => prepared,
        InitCommandResult::DryRun(dry_run) => {
            let plan_path = PathBuf::from(&dry_run.worktree_path)
                .join(".worktree")
                .join("plans")
                .join("active")
                .join(crate::policy::plan_filename_for_prompt(&args.prompt))
                .to_string_lossy()
                .into_owned();
            return Ok(RalphCommandResult::DryRun(RalphRunDryRunResult {
                command: "main",
                dry_run: true,
                init: dry_run,
                plan_path,
            }));
        }
    };

    let plan_path = PathBuf::from(default_plan_path(&prepared.worktree_path, &args.prompt));
    let mut stderr = std::io::stderr();
    writeln!(stderr, "Phase 1/3: setup").map_err(WtlError::ObserverIo)?;
    run_phase(
        &prepared.worktree_path,
        args,
        EngineConfig {
            max_iter: 2,
            max_retry: 1,
        },
        CompletionTokenPolicy::new(
            "setup",
            build_setup_prompt(
                &args.prompt,
                &plan_path,
                &prepared.worktree_path,
                &prepared.init.worktree_id,
                &prepared.init.work_branch,
                &prepared.init.base_branch,
            ),
            setup_developer_instructions(),
        ),
    )
    .await?;

    if !plan_path.exists() {
        return Err(WtlError::InvalidPath(format!(
            "setup phase did not create plan file at {}",
            plan_path.display()
        )));
    }

    writeln!(stderr, "Phase 2/3: coding").map_err(WtlError::ObserverIo)?;
    run_phase(
        &prepared.worktree_path,
        args,
        EngineConfig {
            max_iter: args.max_iterations,
            max_retry: 3,
        },
        CodingLoopPolicy::new(
            args.prompt.clone(),
            plan_path.to_string_lossy().into_owned(),
        ),
    )
    .await?;

    writeln!(stderr, "Phase 3/3: pr").map_err(WtlError::ObserverIo)?;
    let pr_output = run_phase(
        &prepared.worktree_path,
        args,
        EngineConfig {
            max_iter: 2,
            max_retry: 1,
        },
        CompletionTokenPolicy::new(
            "pr",
            build_pr_prompt(&plan_path, &prepared.init.base_branch),
            pr_developer_instructions(),
        ),
    )
    .await?;

    if !args.preserve_worktree {
        cleanup_worktree(&prepared.repo_root, &prepared.worktree_path)?;
    }

    Ok(RalphCommandResult::Completed(RalphRunResult {
        command: "main",
        status: "completed".to_owned(),
        worktree_id: prepared.init.worktree_id,
        worktree_path: prepared.init.worktree_path,
        work_branch: prepared.init.work_branch,
        base_branch: prepared.init.base_branch,
        iterations: args.max_iterations,
        plan_path: plan_path.to_string_lossy().into_owned(),
        pr_url: extract_pr_url(&pr_output),
    }))
}

pub enum RalphCommandResult {
    DryRun(RalphRunDryRunResult),
    Completed(RalphRunResult),
}

async fn run_phase<P>(
    worktree_path: &Path,
    args: &RalphRunArgs,
    config: EngineConfig,
    policy: P,
) -> Result<String, WtlError>
where
    P: crate::policy::LoopPolicy,
{
    let mut runtime_config = CodexRuntimeConfig::from_env(worktree_path.to_path_buf());
    runtime_config.model = args.model.clone();
    runtime_config.turn_timeout = std::time::Duration::from_secs(args.timeout);
    runtime_config.approval_policy = args.approval_policy.clone();
    runtime_config.sandbox = args.sandbox.clone();

    let mut runtime = CodexAppServerRuntime::connect(runtime_config).await?;
    let mut observer = CliObserver::new(Vec::new());
    let result = crate::engine::run(config, policy, &mut runtime, &mut observer).await?;
    let transcript = String::from_utf8(observer.into_inner())
        .map_err(|error| WtlError::protocol(error.to_string()))?;
    eprint!("{transcript}");
    match result {
        RunTerminalState::Completed => Ok(transcript),
        RunTerminalState::Exhausted { message } => Err(WtlError::protocol(message)),
        RunTerminalState::Interrupted => Err(WtlError::protocol("run interrupted")),
    }
}

fn extract_pr_url(output: &str) -> Option<String> {
    output
        .split_whitespace()
        .find(|token| token.starts_with("https://github.com/") && token.contains("/pull/"))
        .map(|token| {
            token
                .trim_end_matches(|ch: char| matches!(ch, '.' | ',' | ')' | ']'))
                .to_owned()
        })
}

pub fn render_json<T: Serialize>(value: &T) -> Result<String, WtlError> {
    serde_json::to_string_pretty(value).map_err(WtlError::SerializeJson)
}

pub fn init_output(result: InitCommandResult) -> InitOutput {
    match result {
        InitCommandResult::DryRun(dry_run) => InitOutput::DryRun(dry_run),
        InitCommandResult::Prepared(prepared) => InitOutput::Prepared(prepared.init),
    }
}

#[derive(Debug, Clone, Serialize, Eq, PartialEq)]
#[serde(untagged)]
pub enum InitOutput {
    DryRun(InitDryRunResult),
    Prepared(InitResult),
}
