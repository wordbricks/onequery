package ralphloop

import (
	"fmt"
	"path/filepath"
	"strings"
)

type setupPromptOptions struct {
	UserPrompt   string
	PlanPath     string
	WorktreePath string
	WorktreeID   string
	WorkBranch   string
	BaseBranch   string
}

type codingPromptOptions struct {
	UserPrompt string
	PlanPath   string
}

type prPromptOptions struct {
	PlanPath   string
	BaseBranch string
}

func defaultPlanFilename(prompt string) string {
	slug := slugifyPrompt(planFilenameSeed(prompt))
	if len(slug) > 80 {
		slug = slug[:80]
		slug = strings.Trim(slug, "-")
	}
	if slug == "" {
		slug = "task"
	}
	return slug + ".md"
}

func planFilenameSeed(prompt string) string {
	issueIdentifier := ""
	issueTitle := ""
	for _, line := range strings.Split(prompt, "\n") {
		trimmed := strings.TrimSpace(line)
		switch {
		case strings.HasPrefix(trimmed, "Issue:"):
			issueIdentifier = strings.TrimSpace(strings.TrimPrefix(trimmed, "Issue:"))
		case strings.HasPrefix(trimmed, "Title:"):
			issueTitle = strings.TrimSpace(strings.TrimPrefix(trimmed, "Title:"))
		}
	}
	switch {
	case issueIdentifier != "" && issueTitle != "":
		return issueIdentifier + " " + issueTitle
	case issueIdentifier != "":
		return issueIdentifier
	default:
		return prompt
	}
}

func buildSetupPrompt(options setupPromptOptions) string {
	planName := strings.TrimSuffix(filepath.Base(options.PlanPath), filepath.Ext(options.PlanPath))
	return fmt.Sprintf(`You are the setup agent for an automated coding loop. The worktree environment is already initialized.

Task: %s

Prepared environment:
- Worktree path: %s
- Worktree ID: %s
- Working branch: %s
- Base branch: %s

Do the following steps in order:

1. Read AGENTS.md, ARCHITECTURE.md, docs/PLANS.md, and any other relevant repository docs needed to understand the task.
2. Create an execution plan at %s using the checked-in plan structure:
   - Goal / scope
   - Background
   - Milestones
   - Current progress
   - Key decisions
   - Remaining issues / open questions
   - Links to related documents
3. Break the work into 3-7 concrete milestones, each small enough for one coding-loop iteration.
4. Mark every milestone as not started.
5. Stage and commit the new plan with message: plan: %s
6. Print the absolute plan file path.

Output <promise>COMPLETE</promise> when done.`, options.UserPrompt, options.WorktreePath, options.WorktreeID, options.WorkBranch, options.BaseBranch, options.PlanPath, planName)
}

func buildCodingPrompt(options codingPromptOptions) string {
	return fmt.Sprintf(`You are a coding agent working in an automated loop. You will iterate until the task is fully complete.

## Task
%s

## Execution plan
Read the plan at %s to understand the milestones and current progress. Pick up where the last iteration left off.

## Rules
- One milestone per iteration. Complete exactly one milestone, then stop.
- Work through milestones sequentially.
- After completing the milestone, update the plan file with progress, decisions, and remaining issues.
- Stage and commit all changes from the iteration, including the plan update.
- If blocked, document the blocker in the plan and commit the current state.

## Completion signal
When all milestones are done:
- Perform the final plan update.
- Commit all remaining changes.
- Output <promise>COMPLETE</promise>.

If work remains after this iteration, do not output the completion token.`, options.UserPrompt, options.PlanPath)
}

func buildRecoveryPrompt(planPath string) string {
	return fmt.Sprintf("The previous iteration failed. Review the current git state, inspect the last errors, repair the workspace, and continue from the plan at %s. Commit the recovery work before stopping.", planPath)
}

func buildPrPrompt(options prPromptOptions) string {
	return fmt.Sprintf(`You are a PR agent. Create a pull request for the completed work on this branch.

Instructions:
1. Read the completed plan at %s.
2. Review commits with git log %s..HEAD --oneline.
3. Review scope with git diff %s...HEAD --stat.
4. Move the plan from docs/exec-plans/active/ to docs/exec-plans/completed/ and commit that move.
5. Create a pull request with:
   - Title: concise, under 70 characters
   - Body:
     ## Summary
     <2-4 bullet points>

     ## Milestones completed
     <from the plan>

     ## Key decisions
     <from the plan>

     ## Test plan
     <how to verify>

     Generated with Ralph Loop
6. Do not enable auto-merge and do not merge the PR.
7. Print the PR URL and report that the branch is ready for review.

Output <promise>COMPLETE</promise> when done.`, options.PlanPath, options.BaseBranch, options.BaseBranch)
}
