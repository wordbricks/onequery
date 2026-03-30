package ralphloop

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

type initWorktreeOptions struct {
	RepoRoot     string
	BaseBranch   string
	WorkBranch   string
	WorktreeName string
}

type worktreeInitMetadata struct {
	WorktreeID   string `json:"worktree_id"`
	WorktreePath string `json:"worktree_path"`
	WorkBranch   string `json:"work_branch"`
	BaseBranch   string `json:"base_branch"`
	RuntimeRoot  string `json:"runtime_root"`
}

func initWorktree(ctx context.Context, options initWorktreeOptions) (worktreeInitMetadata, error) {
	scriptPath := filepath.Join(options.RepoRoot, "scripts", "harness", "init.sh")
	args := []string{
		"--base-branch", options.BaseBranch,
		"--work-branch", options.WorkBranch,
	}
	if strings.TrimSpace(options.WorktreeName) != "" {
		args = append(args, "--worktree-name", options.WorktreeName)
	}
	result, err := runCommand(ctx, options.RepoRoot, scriptPath, args...)
	if err != nil {
		return worktreeInitMetadata{}, fmt.Errorf("init.sh failed: %s", commandFailureMessage(result, err, "init.sh"))
	}
	metadata := worktreeInitMetadata{}
	if err := json.Unmarshal([]byte(result.Stdout), &metadata); err != nil {
		return worktreeInitMetadata{}, fmt.Errorf("failed to parse init.sh output as JSON: %w", err)
	}
	if strings.TrimSpace(metadata.WorktreePath) == "" {
		return worktreeInitMetadata{}, fmt.Errorf("init.sh output missing worktree_path")
	}
	return metadata, nil
}

func ensureRalphLogPath(worktree worktreeInitMetadata) (string, error) {
	logPath := filepath.Join(worktree.WorktreePath, worktree.RuntimeRoot, "logs", "ralph-loop.log")
	if err := os.MkdirAll(filepath.Dir(logPath), 0o755); err != nil {
		return "", err
	}
	return logPath, nil
}

func cleanupWorktree(ctx context.Context, repoRoot string, worktreePath string) error {
	resolvedRepoRoot, err := filepath.Abs(repoRoot)
	if err != nil {
		return err
	}
	resolvedWorktree, err := filepath.Abs(worktreePath)
	if err != nil {
		return err
	}
	if filepath.Clean(resolvedRepoRoot) == filepath.Clean(resolvedWorktree) {
		return nil
	}
	result, err := runCommand(ctx, repoRoot, "git", "-C", repoRoot, "worktree", "remove", "--force", worktreePath)
	if err != nil {
		return fmt.Errorf("failed to remove worktree %s: %s", worktreePath, commandFailureMessage(result, err, "git worktree remove"))
	}
	return nil
}

type commandResult struct {
	Stdout string
	Stderr string
}

func runCommand(ctx context.Context, dir string, command string, args ...string) (commandResult, error) {
	cmd := exec.CommandContext(ctx, command, args...)
	cmd.Dir = dir

	var stdout bytes.Buffer
	var stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	err := cmd.Run()
	return commandResult{
		Stdout: stdout.String(),
		Stderr: stderr.String(),
	}, err
}

func commandFailureMessage(result commandResult, err error, fallback string) string {
	if message := strings.TrimSpace(result.Stderr); message != "" {
		return message
	}
	if message := strings.TrimSpace(result.Stdout); message != "" {
		return message
	}
	if err != nil {
		return err.Error()
	}
	return fallback
}
