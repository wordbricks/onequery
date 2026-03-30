package ralphloop

import (
	"context"
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
	"time"
)

type worktreeNaming struct {
	WorktreeName string
	WorkBranch   string
	Source       string
	Reason       string
}

type namingResponse struct {
	WorktreeName string `json:"worktree_name"`
	WorkBranch   string `json:"work_branch"`
}

var jsonFencePattern = regexp.MustCompile("(?is)```(?:json)?\\s*([\\s\\S]*?)\\s*```")

func resolveNaming(ctx context.Context, options MainOptions, repoRoot string, spawn func(logFile string) (codexClient, error)) worktreeNaming {
	if options.WorkBranchProvided {
		return namingFromUserBranch(options.WorkBranch)
	}

	client, err := spawn("")
	if err != nil {
		fallback := fallbackWorktreeNaming(options.Prompt, options.WorkBranch)
		fallback.Source = "fallback"
		fallback.Reason = err.Error()
		return fallback
	}
	defer client.Close()

	if err := client.Initialize(ctx); err != nil {
		fallback := fallbackWorktreeNaming(options.Prompt, options.WorkBranch)
		fallback.Source = "fallback"
		fallback.Reason = err.Error()
		return fallback
	}

	fallback := fallbackWorktreeNaming(options.Prompt, options.WorkBranch)
	threadID, err := client.StartThread(ctx, startThreadOptions{
		Model:          options.Model,
		Cwd:            repoRoot,
		ApprovalPolicy: options.ApprovalPolicy,
		Sandbox:        "read-only",
	})
	if err != nil {
		fallback.Source = "fallback"
		fallback.Reason = err.Error()
		return fallback
	}

	timeout := time.Duration(options.TimeoutSeconds) * time.Second
	if timeout <= 0 || timeout > 15*time.Second {
		timeout = 15 * time.Second
	}

	result, err := client.RunTurn(ctx, runTurnOptions{
		ThreadID: threadID,
		Prompt:   buildNamingPrompt(options.Prompt, fallback),
		Timeout:  timeout,
	})
	if err != nil {
		fallback.Source = "fallback"
		fallback.Reason = err.Error()
		return fallback
	}
	if strings.EqualFold(result.Status, "failed") {
		fallback.Source = "fallback"
		if strings.TrimSpace(result.CodexErrorInfo) != "" {
			fallback.Reason = result.CodexErrorInfo
		} else {
			fallback.Reason = "naming turn failed"
		}
		return fallback
	}

	parsedResponse, err := parseNamingResponse(result.AgentText)
	if err != nil {
		fallback.Source = "fallback"
		fallback.Reason = err.Error()
		return fallback
	}

	normalized := normalizeNamingResponse(parsedResponse, fallback)
	normalized.Source = "ai"
	return normalized
}

func namingFromUserBranch(workBranch string) worktreeNaming {
	normalizedBranch := sanitizeBranchName(workBranch)
	fallback := fallbackWorktreeNaming(workBranch, normalizedBranch)
	worktreeName := deriveWorktreeName(normalizedBranch)
	if worktreeName == "" {
		worktreeName = fallback.WorktreeName
	}
	if normalizedBranch == "" {
		normalizedBranch = fallback.WorkBranch
	}
	return worktreeNaming{
		WorktreeName: worktreeName,
		WorkBranch:   normalizedBranch,
		Source:       "user",
	}
}

func fallbackWorktreeNaming(prompt string, fallbackBranch string) worktreeNaming {
	promptSlug := sanitizeToken(slugifyPrompt(prompt), 48)
	if promptSlug == "" {
		promptSlug = "task"
	}
	branch := sanitizeBranchName(fallbackBranch)
	if branch == "" {
		branch = "ralph-" + promptSlug
	}
	worktreeName := deriveWorktreeName(branch)
	if worktreeName == "" {
		worktreeName = promptSlug
	}
	return worktreeNaming{
		WorktreeName: worktreeName,
		WorkBranch:   branch,
		Source:       "fallback",
	}
}

func normalizeNamingResponse(response *namingResponse, fallback worktreeNaming) worktreeNaming {
	workBranch := ""
	if response != nil {
		workBranch = sanitizeBranchName(response.WorkBranch)
	}
	if workBranch == "" {
		workBranch = fallback.WorkBranch
	}

	worktreeName := ""
	if response != nil {
		nameSeed := response.WorktreeName
		if strings.TrimSpace(nameSeed) == "" {
			nameSeed = deriveWorktreeName(workBranch)
		}
		worktreeName = sanitizeToken(nameSeed, 48)
	}
	if worktreeName == "" {
		worktreeName = deriveWorktreeName(fallback.WorkBranch)
	}
	if worktreeName == "" {
		worktreeName = fallback.WorktreeName
	}

	return worktreeNaming{
		WorktreeName: worktreeName,
		WorkBranch:   workBranch,
		Source:       fallback.Source,
	}
}

func parseNamingResponse(agentText string) (*namingResponse, error) {
	candidate := strings.TrimSpace(agentText)
	if candidate == "" {
		return nil, nil
	}
	if match := jsonFencePattern.FindStringSubmatch(candidate); len(match) == 2 {
		candidate = strings.TrimSpace(match[1])
	}

	parsed := &namingResponse{}
	if err := json.Unmarshal([]byte(candidate), parsed); err != nil {
		return nil, fmt.Errorf("Failed to parse JSON for ralph-loop naming suggestion: %w", err)
	}
	return parsed, nil
}

func buildNamingPrompt(prompt string, fallback worktreeNaming) string {
	return fmt.Sprintf(`You are naming a git worktree and branch for an automated coding task.

Task:
%s

Return JSON only with this exact shape:
{"worktree_name":"lowercase-kebab-case","work_branch":"ralph-lowercase-kebab-case"}

Rules:
- worktree_name: 2-48 chars, lowercase letters, digits, and hyphens only.
- work_branch: start with ralph-, lowercase only, letters digits and hyphens only, max 64 chars.
- Keep both names concise and specific to the task.
- Do not include markdown, explanations, or code fences.

Fallback if unsure:
{"worktree_name":"%s","work_branch":"%s"}`,
		prompt,
		fallback.WorktreeName,
		fallback.WorkBranch,
	)
}

func deriveWorktreeName(workBranch string) string {
	suffix := strings.ReplaceAll(workBranch, "/", "-")
	suffix = strings.TrimPrefix(suffix, "ralph-")
	suffix = strings.TrimPrefix(suffix, "ralph/")
	return sanitizeToken(suffix, 48)
}

func sanitizeBranchName(value string) string {
	normalized := strings.ToLower(strings.TrimSpace(value))
	branchUnsafe := regexp.MustCompile(`[^a-z0-9/-]+`)
	slashes := regexp.MustCompile(`/+`)
	dashes := regexp.MustCompile(`-+`)
	trimInvalid := regexp.MustCompile(`^[/.-]+|[/.-]+$`)
	normalized = branchUnsafe.ReplaceAllString(normalized, "-")
	normalized = slashes.ReplaceAllString(normalized, "-")
	normalized = dashes.ReplaceAllString(normalized, "-")
	normalized = trimInvalid.ReplaceAllString(normalized, "")
	if normalized == "" {
		return ""
	}

	if strings.HasPrefix(normalized, "ralph-") {
		branch := sanitizeToken(normalized, 64)
		if branch == "ralph" {
			return ""
		}
		return branch
	}

	branch := "ralph-" + sanitizeToken(normalized, 58)
	if branch == "ralph-" {
		return ""
	}
	return branch
}

func sanitizeToken(value string, maxLength int) string {
	normalized := strings.ToLower(value)
	normalized = regexp.MustCompile(`[^a-z0-9-]+`).ReplaceAllString(normalized, "-")
	normalized = regexp.MustCompile(`-+`).ReplaceAllString(normalized, "-")
	normalized = regexp.MustCompile(`^-+|-+$`).ReplaceAllString(normalized, "")
	if maxLength > 0 && len(normalized) > maxLength {
		normalized = normalized[:maxLength]
		normalized = regexp.MustCompile(`-+$`).ReplaceAllString(normalized, "")
	}
	return normalized
}
