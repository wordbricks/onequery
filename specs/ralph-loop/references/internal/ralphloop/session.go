package ralphloop

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"time"
)

func registerRalphSession(worktree worktreeInitMetadata, logPath string, startedAt time.Time) (func(), error) {
	pidPath, metadataPath, err := ralphSessionPaths(worktree)
	if err != nil {
		return nil, err
	}
	pid := os.Getpid()
	if err := os.WriteFile(pidPath, []byte(strconv.Itoa(pid)+"\n"), 0o644); err != nil {
		return nil, err
	}

	payload := ralphSessionState{
		PID:          pid,
		WorktreeID:   worktree.WorktreeID,
		WorktreePath: worktree.WorktreePath,
		WorkBranch:   worktree.WorkBranch,
		BaseBranch:   worktree.BaseBranch,
		RuntimeRoot:  worktree.RuntimeRoot,
		LogPath:      logPath,
		StartedAt:    startedAt.UTC().Format(time.RFC3339),
	}
	metadataBytes, err := json.MarshalIndent(payload, "", "  ")
	if err != nil {
		return nil, err
	}
	if err := os.WriteFile(metadataPath, metadataBytes, 0o644); err != nil {
		return nil, err
	}

	cleanup := func() {
		_ = os.Remove(pidPath)
		_ = os.Remove(metadataPath)
	}
	return cleanup, nil
}

func ralphSessionPaths(worktree worktreeInitMetadata) (string, string, error) {
	runDir := filepath.Join(worktree.WorktreePath, worktree.RuntimeRoot, "run")
	if err := os.MkdirAll(runDir, 0o755); err != nil {
		return "", "", err
	}
	return filepath.Join(runDir, "ralph-loop.pid"), filepath.Join(runDir, "ralph-loop.json"), nil
}

func pidIsRunning(pid int) bool {
	if pid <= 0 {
		return false
	}
	return exec.Command("kill", "-0", strconv.Itoa(pid)).Run() == nil
}
