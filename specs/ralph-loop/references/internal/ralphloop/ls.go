package ralphloop

import (
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"text/tabwriter"
)

type ralphSessionState struct {
	PID          int    `json:"pid"`
	WorktreeID   string `json:"worktree_id"`
	WorktreePath string `json:"worktree_path"`
	WorkBranch   string `json:"work_branch"`
	BaseBranch   string `json:"base_branch"`
	RuntimeRoot  string `json:"runtime_root"`
	LogPath      string `json:"log_path"`
	StartedAt    string `json:"started_at"`
}

type ralphSessionView struct {
	PID                 int
	WorktreeID          string
	WorktreePath        string
	WorkBranch          string
	LogPath             string
	StartedAt           string
	RelativeWorktreeDir string
	RelativeLogPath     string
}

func runListCommand(repoRoot string, options ListOptions, stdout io.Writer) error {
	sessions, err := listRunningRalphSessions(repoRoot, options.Selector)
	if err != nil {
		return err
	}
	if len(sessions) == 0 {
		_, _ = fmt.Fprintf(stdout, "No running Ralph Loop sessions found under %s\n", repoRoot)
		return nil
	}

	_, _ = fmt.Fprintln(stdout, "Running Ralph Loop sessions:")
	writer := tabwriter.NewWriter(stdout, 0, 0, 2, ' ', 0)
	_, _ = fmt.Fprintln(writer, "PID\tWORKTREE\tBRANCH\tSTARTED\tLOG")
	for _, session := range sessions {
		worktree := session.RelativeWorktreeDir
		if worktree == "" {
			worktree = session.WorktreePath
		}
		logPath := session.RelativeLogPath
		if logPath == "" {
			logPath = session.LogPath
		}
		branch := strings.TrimSpace(session.WorkBranch)
		if branch == "" {
			branch = "-"
		}
		startedAt := strings.TrimSpace(session.StartedAt)
		if startedAt == "" {
			startedAt = "-"
		}
		_, _ = fmt.Fprintf(writer, "%d\t%s\t%s\t%s\t%s\n", session.PID, filepath.ToSlash(worktree), branch, startedAt, filepath.ToSlash(logPath))
	}
	return writer.Flush()
}

func listRunningRalphSessions(repoRoot string, selector string) ([]ralphSessionView, error) {
	pidFiles, err := listRalphSessionPIDFiles(repoRoot)
	if err != nil {
		return nil, err
	}
	sessions := make([]ralphSessionView, 0, len(pidFiles))
	for _, pidPath := range pidFiles {
		session, ok := loadRunningRalphSession(repoRoot, pidPath)
		if !ok {
			continue
		}
		if strings.TrimSpace(selector) != "" && !matchesSessionSelector(session, selector) {
			continue
		}
		sessions = append(sessions, session)
	}
	sort.Slice(sessions, func(i, j int) bool {
		if sessions[i].StartedAt != sessions[j].StartedAt {
			return sessions[i].StartedAt > sessions[j].StartedAt
		}
		return sessions[i].WorktreePath < sessions[j].WorktreePath
	})
	return sessions, nil
}

func listRalphSessionPIDFiles(repoRoot string) ([]string, error) {
	roots := []string{
		filepath.Join(repoRoot, ".worktree"),
		filepath.Join(repoRoot, ".worktrees"),
	}
	files := make([]string, 0, 8)
	seen := map[string]struct{}{}
	for _, root := range roots {
		if _, err := os.Stat(root); err != nil {
			if os.IsNotExist(err) {
				continue
			}
			return nil, err
		}
		err := filepath.WalkDir(root, func(path string, entry fs.DirEntry, walkErr error) error {
			if walkErr != nil {
				return walkErr
			}
			if entry.IsDir() {
				return nil
			}
			if !strings.HasSuffix(filepath.ToSlash(path), "/run/ralph-loop.pid") {
				return nil
			}
			if _, ok := seen[path]; ok {
				return nil
			}
			seen[path] = struct{}{}
			files = append(files, path)
			return nil
		})
		if err != nil {
			return nil, err
		}
	}
	sort.Strings(files)
	return files, nil
}

func loadRunningRalphSession(repoRoot string, pidPath string) (ralphSessionView, bool) {
	content, err := os.ReadFile(pidPath)
	if err != nil {
		return ralphSessionView{}, false
	}
	pidText := strings.TrimSpace(string(content))
	if pidText == "" {
		return ralphSessionView{}, false
	}
	pid := 0
	if _, err := fmt.Sscanf(pidText, "%d", &pid); err != nil || !pidIsRunning(pid) {
		return ralphSessionView{}, false
	}

	state := ralphSessionState{}
	metadataPath := strings.TrimSuffix(pidPath, ".pid") + ".json"
	if metadataBytes, err := os.ReadFile(metadataPath); err == nil {
		_ = json.Unmarshal(metadataBytes, &state)
	}
	state.PID = pid

	view := ralphSessionView{
		PID:          state.PID,
		WorktreeID:   state.WorktreeID,
		WorktreePath: state.WorktreePath,
		WorkBranch:   state.WorkBranch,
		LogPath:      state.LogPath,
		StartedAt:    state.StartedAt,
	}
	if view.WorktreePath == "" {
		view.WorktreePath = inferWorktreePathFromPIDPath(pidPath)
	}
	if view.LogPath == "" && view.WorktreePath != "" && state.RuntimeRoot != "" {
		view.LogPath = filepath.Join(view.WorktreePath, state.RuntimeRoot, "logs", "ralph-loop.log")
	}
	if relative, err := filepath.Rel(repoRoot, view.WorktreePath); err == nil && relative != "." {
		view.RelativeWorktreeDir = relative
	}
	if relative, err := filepath.Rel(repoRoot, view.LogPath); err == nil && relative != "." {
		view.RelativeLogPath = relative
	}
	return view, true
}

func inferWorktreePathFromPIDPath(pidPath string) string {
	normalized := filepath.ToSlash(pidPath)
	index := strings.Index(normalized, "/.worktree/")
	if index == -1 {
		return ""
	}
	return filepath.FromSlash(normalized[:index])
}

func matchesSessionSelector(session ralphSessionView, selector string) bool {
	target := strings.TrimSpace(selector)
	if target == "" {
		return true
	}
	fields := []string{
		session.WorktreeID,
		session.WorktreePath,
		session.WorkBranch,
		session.LogPath,
		session.RelativeWorktreeDir,
		session.RelativeLogPath,
	}
	for _, field := range fields {
		if strings.Contains(field, target) {
			return true
		}
	}
	return false
}
