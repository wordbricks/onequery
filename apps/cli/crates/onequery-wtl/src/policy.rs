use std::path::Path;

use crate::runtime::TurnFailure;

pub const WTL_COMPLETION_MARKER: &str = "##WTL_DONE##";
pub const RALPH_COMPLETION_MARKER: &str = "<promise>COMPLETE</promise>";

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub enum ThreadMode {
    Reuse,
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub struct ExecutionPlan {
    pub phase: &'static str,
    pub prompt: String,
    pub thread_mode: ThreadMode,
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub enum PolicyDirective<S> {
    Continue {
        next_state: S,
        next_plan: ExecutionPlan,
    },
    Retry {
        next_state: S,
        next_plan: ExecutionPlan,
    },
    Complete,
}

pub trait LoopPolicy: Clone {
    type State: Clone + std::fmt::Debug + Eq + PartialEq;

    fn developer_instructions(&self) -> String;
    fn initial_state(&self) -> Self::State;
    fn initial_plan(&self) -> ExecutionPlan;
    fn evaluate_success(&self, state: Self::State, response: &str) -> PolicyDirective<Self::State>;
    fn evaluate_failure(
        &self,
        state: Self::State,
        failure: &TurnFailure,
    ) -> PolicyDirective<Self::State>;
}

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub struct PolicyState {
    pub successful_turns: usize,
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub struct SimpleLoopPolicy {
    request: String,
}

impl SimpleLoopPolicy {
    pub fn new(request: String) -> Self {
        Self { request }
    }

    pub fn initial_plan(&self) -> ExecutionPlan {
        ExecutionPlan {
            phase: "single_loop",
            prompt: self.request.clone(),
            thread_mode: ThreadMode::Reuse,
        }
    }
}

impl LoopPolicy for SimpleLoopPolicy {
    type State = PolicyState;

    fn developer_instructions(&self) -> String {
        format!(
            concat!(
                "You are executing inside the WhatTheLoop minimal CLI.\n",
                "Work on the user's request across as many turns as needed.\n",
                "When you determine that the task is fully complete, include ",
                "{marker} at the end of your response. Do not include it if the ",
                "task is still in progress or requires additional steps.\n",
            ),
            marker = WTL_COMPLETION_MARKER
        )
    }

    fn initial_state(&self) -> Self::State {
        PolicyState {
            successful_turns: 0,
        }
    }

    fn initial_plan(&self) -> ExecutionPlan {
        Self::initial_plan(self)
    }

    fn evaluate_success(&self, state: Self::State, response: &str) -> PolicyDirective<Self::State> {
        if response.contains(WTL_COMPLETION_MARKER) {
            return PolicyDirective::Complete;
        }

        PolicyDirective::Continue {
            next_state: PolicyState {
                successful_turns: state.successful_turns + 1,
            },
            next_plan: ExecutionPlan {
                phase: "single_loop",
                prompt: format!(
                    concat!(
                        "Continue working on the same request until it is fully complete.\n",
                        "Only include {marker} when the task is actually done."
                    ),
                    marker = WTL_COMPLETION_MARKER
                ),
                thread_mode: ThreadMode::Reuse,
            },
        }
    }

    fn evaluate_failure(
        &self,
        state: Self::State,
        _failure: &TurnFailure,
    ) -> PolicyDirective<Self::State> {
        PolicyDirective::Retry {
            next_state: state,
            next_plan: ExecutionPlan {
                phase: "single_loop",
                prompt: format!(
                    concat!(
                        "Retry the same request after the previous turn failed.\n",
                        "Keep working toward completion and only include {marker} ",
                        "when the task is fully done."
                    ),
                    marker = WTL_COMPLETION_MARKER
                ),
                thread_mode: ThreadMode::Reuse,
            },
        }
    }
}

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub struct RalphPolicyState {
    pub attempts: usize,
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub struct CompletionTokenPolicy {
    phase: &'static str,
    prompt: String,
    developer_instructions: String,
}

impl CompletionTokenPolicy {
    pub fn new(phase: &'static str, prompt: String, developer_instructions: String) -> Self {
        Self {
            phase,
            prompt,
            developer_instructions,
        }
    }

    fn plan(&self) -> ExecutionPlan {
        ExecutionPlan {
            phase: self.phase,
            prompt: self.prompt.clone(),
            thread_mode: ThreadMode::Reuse,
        }
    }
}

impl LoopPolicy for CompletionTokenPolicy {
    type State = RalphPolicyState;

    fn developer_instructions(&self) -> String {
        self.developer_instructions.clone()
    }

    fn initial_state(&self) -> Self::State {
        RalphPolicyState { attempts: 0 }
    }

    fn initial_plan(&self) -> ExecutionPlan {
        self.plan()
    }

    fn evaluate_success(&self, state: Self::State, response: &str) -> PolicyDirective<Self::State> {
        if response.contains(RALPH_COMPLETION_MARKER) {
            return PolicyDirective::Complete;
        }

        PolicyDirective::Continue {
            next_state: RalphPolicyState {
                attempts: state.attempts + 1,
            },
            next_plan: self.plan(),
        }
    }

    fn evaluate_failure(
        &self,
        state: Self::State,
        _failure: &TurnFailure,
    ) -> PolicyDirective<Self::State> {
        PolicyDirective::Retry {
            next_state: RalphPolicyState {
                attempts: state.attempts + 1,
            },
            next_plan: self.plan(),
        }
    }
}

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub struct CodingLoopState {
    pub iteration: usize,
    pub failures: usize,
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub struct CodingLoopPolicy {
    user_prompt: String,
    plan_path: String,
}

impl CodingLoopPolicy {
    pub fn new(user_prompt: String, plan_path: impl Into<String>) -> Self {
        Self {
            user_prompt,
            plan_path: plan_path.into(),
        }
    }

    fn coding_prompt(&self) -> String {
        format!(
            concat!(
                "You are a coding agent working in an automated loop. You will iterate until the task is fully complete.\n\n",
                "## Task\n",
                "{task}\n\n",
                "## Execution plan\n",
                "Read the plan at `{plan_path}` to understand the milestones and current progress. ",
                "Pick up where the last iteration left off.\n\n",
                "## Rules\n",
                "- One milestone per iteration. Complete exactly one milestone, then stop.\n",
                "- Work through the milestones sequentially.\n",
                "- After completing the milestone, update the plan file:\n",
                "  - Mark the completed milestone as done\n",
                "  - Update current progress with what you accomplished\n",
                "  - Add key decisions you made\n",
                "  - Note remaining issues\n",
                "- Stage and commit all changes from the iteration, including the updated plan.\n",
                "- If you encounter a blocker you cannot resolve, document it in the plan and commit the current state.\n\n",
                "## Completion signal\n",
                "When all milestones are complete:\n",
                "- Perform the final plan update.\n",
                "- Commit all remaining changes.\n",
                "- Output {marker}\n\n",
                "If work remains after this iteration, do not output the completion token."
            ),
            task = self.user_prompt,
            plan_path = self.plan_path,
            marker = RALPH_COMPLETION_MARKER
        )
    }

    fn recovery_prompt(&self) -> String {
        format!(
            concat!(
                "The previous iteration failed. Check git status, inspect the last errors, and fix the workspace first.\n",
                "Then continue from the plan at `{plan_path}`.\n",
                "Commit the recovery work before stopping and only output {marker} if the whole task is complete."
            ),
            plan_path = self.plan_path,
            marker = RALPH_COMPLETION_MARKER
        )
    }
}

impl LoopPolicy for CodingLoopPolicy {
    type State = CodingLoopState;

    fn developer_instructions(&self) -> String {
        format!(
            concat!(
                "You are executing the coding phase inside Ralph Loop.\n",
                "Treat the plan file as the source of truth.\n",
                "Work on exactly one milestone per turn.\n",
                "Only emit {marker} when the task is fully complete.\n"
            ),
            marker = RALPH_COMPLETION_MARKER
        )
    }

    fn initial_state(&self) -> Self::State {
        CodingLoopState {
            iteration: 0,
            failures: 0,
        }
    }

    fn initial_plan(&self) -> ExecutionPlan {
        ExecutionPlan {
            phase: "coding",
            prompt: self.coding_prompt(),
            thread_mode: ThreadMode::Reuse,
        }
    }

    fn evaluate_success(&self, state: Self::State, response: &str) -> PolicyDirective<Self::State> {
        if response.contains(RALPH_COMPLETION_MARKER) {
            return PolicyDirective::Complete;
        }

        PolicyDirective::Continue {
            next_state: CodingLoopState {
                iteration: state.iteration + 1,
                failures: 0,
            },
            next_plan: self.initial_plan(),
        }
    }

    fn evaluate_failure(
        &self,
        state: Self::State,
        failure: &TurnFailure,
    ) -> PolicyDirective<Self::State> {
        let next_prompt = if failure.code.as_deref() == Some("ContextWindowExceeded") {
            self.recovery_prompt()
        } else {
            self.recovery_prompt()
        };

        PolicyDirective::Retry {
            next_state: CodingLoopState {
                iteration: state.iteration,
                failures: state.failures + 1,
            },
            next_plan: ExecutionPlan {
                phase: "coding_recovery",
                prompt: next_prompt,
                thread_mode: ThreadMode::Reuse,
            },
        }
    }
}

pub fn plan_filename_for_prompt(prompt: &str) -> String {
    let slug = slugify(prompt);
    if slug.is_empty() {
        return "task.md".to_owned();
    }

    format!("{slug}.md")
}

pub fn default_plan_path(worktree_path: &Path, prompt: &str) -> String {
    worktree_path
        .join(".worktree")
        .join("plans")
        .join("active")
        .join(plan_filename_for_prompt(prompt))
        .to_string_lossy()
        .into_owned()
}

fn slugify(input: &str) -> String {
    let mut slug = String::new();
    let mut last_was_dash = false;

    for ch in input.chars().flat_map(char::to_lowercase) {
        if ch.is_ascii_alphanumeric() {
            slug.push(ch);
            last_was_dash = false;
            continue;
        }

        if !last_was_dash {
            slug.push('-');
            last_was_dash = true;
        }
    }

    let trimmed = slug.trim_matches('-');
    let mut value = trimmed.to_owned();
    if value.len() > 80 {
        value.truncate(80);
        value = value.trim_matches('-').to_owned();
    }
    value
}

#[cfg(test)]
mod tests {
    use pretty_assertions::assert_eq;

    use super::CodingLoopPolicy;
    use super::CompletionTokenPolicy;
    use super::ExecutionPlan;
    use super::LoopPolicy;
    use super::PolicyDirective;
    use super::PolicyState;
    use super::RALPH_COMPLETION_MARKER;
    use super::SimpleLoopPolicy;
    use super::ThreadMode;
    use super::WTL_COMPLETION_MARKER;
    use crate::runtime::TurnFailure;

    #[test]
    fn success_without_marker_continues() {
        let policy = SimpleLoopPolicy::new("ship it".to_owned());

        let directive = policy.evaluate_success(
            PolicyState {
                successful_turns: 0,
            },
            "still working",
        );

        assert_eq!(
            directive,
            PolicyDirective::Continue {
                next_state: PolicyState {
                    successful_turns: 1,
                },
                next_plan: ExecutionPlan {
                    phase: "single_loop",
                    prompt: format!(
                        concat!(
                            "Continue working on the same request until it is fully complete.\n",
                            "Only include {marker} when the task is actually done."
                        ),
                        marker = WTL_COMPLETION_MARKER
                    ),
                    thread_mode: ThreadMode::Reuse,
                },
            }
        );
    }

    #[test]
    fn success_with_marker_completes() {
        let policy = SimpleLoopPolicy::new("ship it".to_owned());

        let directive = policy.evaluate_success(
            PolicyState {
                successful_turns: 0,
            },
            &format!("done {WTL_COMPLETION_MARKER}"),
        );

        assert_eq!(directive, PolicyDirective::Complete);
    }

    #[test]
    fn completion_token_policy_waits_for_promise_marker() {
        let policy =
            CompletionTokenPolicy::new("setup", "prepare".to_owned(), "instructions".to_owned());

        assert_eq!(
            policy.evaluate_success(
                super::RalphPolicyState { attempts: 0 },
                &format!("done {RALPH_COMPLETION_MARKER}")
            ),
            PolicyDirective::Complete
        );
    }

    #[test]
    fn coding_policy_failures_schedule_recovery_prompt() {
        let policy = CodingLoopPolicy::new("ship it".to_owned(), "/tmp/plan.md");

        let directive = policy.evaluate_failure(
            super::CodingLoopState {
                iteration: 1,
                failures: 0,
            },
            &TurnFailure {
                message: "boom".to_owned(),
                code: None,
            },
        );

        match directive {
            PolicyDirective::Retry { next_plan, .. } => {
                assert_eq!(next_plan.phase, "coding_recovery");
                assert!(next_plan.prompt.contains("/tmp/plan.md"));
            }
            other => panic!("expected retry directive, got {other:?}"),
        }
    }
}
