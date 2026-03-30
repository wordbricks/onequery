use std::path::Path;

pub(crate) fn setup_developer_instructions() -> String {
    "You are the setup agent for Ralph Loop. Follow the prompt exactly and only output <promise>COMPLETE</promise> when the setup phase is fully done.".to_owned()
}

pub(crate) fn pr_developer_instructions() -> String {
    "You are the PR agent for Ralph Loop. Follow the prompt exactly and only output <promise>COMPLETE</promise> when the PR phase is fully done.".to_owned()
}

pub(crate) fn build_setup_prompt(
    user_prompt: &str,
    plan_path: &Path,
    worktree_path: &Path,
    worktree_id: &str,
    work_branch: &str,
    base_branch: &str,
) -> String {
    format!(
        concat!(
            "You are the setup agent for an automated coding loop. The worktree environment is already initialized.\n\n",
            "Task: {task}\n\n",
            "Prepared environment:\n",
            "- Worktree path: {worktree_path}\n",
            "- Worktree ID: {worktree_id}\n",
            "- Working branch: {work_branch}\n",
            "- Base branch: {base_branch}\n\n",
            "Do the following steps in order:\n\n",
            "1. Read `AGENTS.md`, `apps/cli/AGENTS.md`, and `apps/cli/docs/ARCHITECTURE.md`.\n",
            "2. Create an execution plan at `{plan_path}` using the checked-in plan structure.\n",
            "3. Break the work into 3-7 concrete milestones, each small enough for one coding-loop iteration.\n",
            "4. Mark every milestone as not started.\n",
            "5. Stage and commit the new plan with message: `plan: {plan_name}`.\n",
            "6. Print the absolute plan file path.\n\n",
            "Output <promise>COMPLETE</promise> when done."
        ),
        task = user_prompt,
        plan_path = plan_path.display(),
        plan_name = plan_path
            .file_stem()
            .and_then(|value| value.to_str())
            .unwrap_or("task"),
        worktree_path = worktree_path.display(),
        worktree_id = worktree_id,
        work_branch = work_branch,
        base_branch = base_branch
    )
}

pub(crate) fn build_pr_prompt(plan_path: &Path, base_branch: &str) -> String {
    format!(
        concat!(
            "You are a PR agent. Create a pull request for the completed work on this branch.\n\n",
            "Instructions:\n",
            "1. Read the completed plan at `{plan_path}`.\n",
            "2. Review commits with `git log {base_branch}..HEAD --oneline`.\n",
            "3. Review scope with `git diff {base_branch}...HEAD --stat`.\n",
            "4. Move the plan from `.worktree/plans/active/` to `.worktree/plans/completed/` and commit that move.\n",
            "5. Create a pull request with:\n",
            "   - Title: concise, under 70 characters\n",
            "   - Body sections: Summary, Milestones completed, Key decisions, Test plan, and `Generated with Ralph Loop`.\n",
            "6. Do not merge the PR yourself.\n",
            "7. Print the PR URL and report that the branch is ready for review.\n\n",
            "Output <promise>COMPLETE</promise> when done."
        ),
        plan_path = plan_path.display(),
        base_branch = base_branch
    )
}
