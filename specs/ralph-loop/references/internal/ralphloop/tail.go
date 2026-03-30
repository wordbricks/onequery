package ralphloop

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
)

type ralphLogFile struct {
	Path         string
	RelativePath string
	MtimeMS      int64
}

func runTailCommand(ctx context.Context, repoRoot string, options TailOptions, stdout io.Writer, stderr io.Writer) error {
	logPath, err := findLatestRalphLog(repoRoot, options.Selector)
	if err != nil {
		return err
	}

	if options.Follow {
		suffix := ""
		if !options.Raw {
			suffix = " (pretty mode; use --raw for original lines)"
		}
		logInfo(stdout, fmt.Sprintf("Following Ralph Loop log: %s%s", logPath, suffix))
		return followLog(ctx, logPath, options.Lines, options.Raw, stdout, stderr)
	}

	output, err := formatTailOutput(logPath, options.Lines)
	if err != nil {
		return err
	}
	logInfo(stdout, output)
	return nil
}

func findLatestRalphLog(repoRoot string, selector string) (string, error) {
	logs, err := listRalphLogs(repoRoot, selector)
	if err != nil {
		return "", err
	}
	if len(logs) == 0 {
		suffix := ""
		if strings.TrimSpace(selector) != "" {
			suffix = fmt.Sprintf(" matching %q", selector)
		}
		return "", fmt.Errorf("No Ralph Loop logs found%s under %s", suffix, filepath.Join(repoRoot, ".worktrees"))
	}
	return logs[0].Path, nil
}

func listRalphLogs(repoRoot string, selector string) ([]ralphLogFile, error) {
	worktreesRoot := filepath.Join(repoRoot, ".worktrees")
	if _, err := os.Stat(worktreesRoot); err != nil {
		if os.IsNotExist(err) {
			return []ralphLogFile{}, nil
		}
		return nil, err
	}

	logs := make([]ralphLogFile, 0, 8)
	err := filepath.WalkDir(worktreesRoot, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.IsDir() {
			return nil
		}
		if !strings.HasSuffix(filepath.ToSlash(path), "/logs/ralph-loop.log") {
			return nil
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		relativePath, err := filepath.Rel(repoRoot, path)
		if err != nil {
			return err
		}
		log := ralphLogFile{
			Path:         path,
			RelativePath: relativePath,
			MtimeMS:      info.ModTime().UnixMilli(),
		}
		if strings.TrimSpace(selector) != "" && !strings.Contains(log.RelativePath, selector) && !strings.Contains(log.Path, selector) {
			return nil
		}
		logs = append(logs, log)
		return nil
	})
	if err != nil {
		return nil, err
	}

	sort.Slice(logs, func(i, j int) bool {
		return logs[i].MtimeMS > logs[j].MtimeMS
	})
	return logs, nil
}

func formatTailOutput(logPath string, lines int) (string, error) {
	body, err := readTailFile(logPath, lines)
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("Showing Ralph Loop log: %s\n%s", logPath, body), nil
}

func readTailFile(path string, lines int) (string, error) {
	content, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	trimmed := strings.TrimRight(string(content), "\n")
	if trimmed == "" {
		return "(log file is empty)", nil
	}
	parts := strings.Split(trimmed, "\n")
	if lines <= 0 || len(parts) <= lines {
		return strings.Join(parts, "\n"), nil
	}
	return strings.Join(parts[len(parts)-lines:], "\n"), nil
}

func followLog(ctx context.Context, path string, lines int, raw bool, stdout io.Writer, stderr io.Writer) error {
	command := exec.CommandContext(ctx, "tail", "-n", fmt.Sprintf("%d", lines), "-f", path)
	pipe, err := command.StdoutPipe()
	if err != nil {
		return err
	}
	command.Stderr = stderr
	if err := command.Start(); err != nil {
		return err
	}

	scanner := bufio.NewScanner(pipe)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	for scanner.Scan() {
		line := scanner.Text()
		output := line
		if !raw {
			output = formatLiveLine(line)
		}
		if strings.TrimSpace(output) == "" {
			continue
		}
		_, _ = fmt.Fprintln(stdout, output)
	}
	if err := scanner.Err(); err != nil {
		return err
	}

	err = command.Wait()
	if err == nil {
		return nil
	}
	if exitError, ok := err.(*exec.ExitError); ok {
		return fmt.Errorf("tail exited with code %d", exitError.ExitCode())
	}
	return err
}

func formatLiveLine(line string) string {
	envelope, ok := parseLogEnvelope(line)
	if !ok {
		return line
	}
	if envelope.Channel == "stdin" {
		return ""
	}

	prefix := formatTimestamp(envelope.Timestamp)
	if envelope.Channel == "stderr" {
		prefix += " [stderr]"
	}

	payload := map[string]any{}
	if err := json.Unmarshal([]byte(envelope.Payload), &payload); err != nil {
		text := strings.TrimSpace(prefix + " " + envelope.Payload)
		return strings.TrimSpace(text)
	}

	summary := summarizeRPC(payload)
	if strings.TrimSpace(summary) == "" {
		return ""
	}
	return strings.TrimSpace(prefix + " " + summary)
}

type logEnvelope struct {
	Timestamp string
	Channel   string
	Payload   string
}

func parseLogEnvelope(line string) (logEnvelope, bool) {
	parts := strings.SplitN(line, " ", 3)
	if len(parts) != 3 {
		return logEnvelope{}, false
	}
	if parts[1] != "stdout:" && parts[1] != "stderr:" && parts[1] != "stdin:" {
		return logEnvelope{}, false
	}
	channel := strings.TrimSuffix(parts[1], ":")
	return logEnvelope{Timestamp: parts[0], Channel: channel, Payload: parts[2]}, true
}

func formatTimestamp(timestamp string) string {
	if len(timestamp) >= 19 {
		return timestamp[11:19]
	}
	return timestamp
}

func summarizeRPC(message map[string]any) string {
	method := valueString(message["method"])
	params, _ := asRecord(message["params"])

	switch method {
	case "turn/started":
		return strings.TrimSpace("[turn] started " + extractID(params["turn"]))
	case "turn/completed":
		turn, _ := asRecord(params["turn"])
		status := valueString(turn["status"])
		if strings.TrimSpace(status) == "" {
			status = "completed"
		}
		return strings.TrimSpace(fmt.Sprintf("[turn] %s %s", status, extractID(turn)))
	case "item/started":
		return summarizeItemStarted(params["item"])
	case "item/completed":
		return summarizeItemCompleted(params["item"])
	case "thread/tokenUsage/updated":
		return summarizeTokenUsage(params["tokenUsage"])
	default:
		return ""
	}
}

func summarizeItemStarted(item any) string {
	record, ok := asRecord(item)
	if !ok {
		return ""
	}
	switch valueString(record["type"]) {
	case "commandExecution":
		return strings.TrimSpace("[cmd] start " + valueString(record["command"]))
	case "contextCompaction":
		return "[context] compacting"
	default:
		return ""
	}
}

func summarizeItemCompleted(item any) string {
	record, ok := asRecord(item)
	if !ok {
		return ""
	}
	switch valueString(record["type"]) {
	case "agentMessage":
		phase := valueString(record["phase"])
		text := valueString(record["text"])
		if strings.TrimSpace(text) == "" {
			return ""
		}
		if phase == "commentary" {
			return "[agent] " + text
		}
		return text
	case "commandExecution":
		command := valueString(record["command"])
		exitCode, hasExitCode := numberValue(record["exitCode"])
		if hasExitCode {
			return strings.TrimSpace(fmt.Sprintf("[cmd] done (%d) %s", exitCode, command))
		}
		return strings.TrimSpace("[cmd] done " + command)
	case "contextCompaction":
		return "[context] compacted"
	default:
		return ""
	}
}

func summarizeTokenUsage(tokenUsage any) string {
	tokenUsageRecord, ok := asRecord(tokenUsage)
	if !ok {
		return ""
	}
	total, ok := asRecord(tokenUsageRecord["total"])
	if !ok {
		return ""
	}
	totalTokens, ok := numberValue(total["totalTokens"])
	if !ok {
		return ""
	}
	return fmt.Sprintf("[tokens] total=%d", totalTokens)
}

func numberValue(value any) (int64, bool) {
	switch converted := value.(type) {
	case float64:
		return int64(converted), true
	case float32:
		return int64(converted), true
	case int:
		return int64(converted), true
	case int64:
		return converted, true
	case int32:
		return int64(converted), true
	default:
		return 0, false
	}
}

func extractID(value any) string {
	record, ok := asRecord(value)
	if !ok {
		return ""
	}
	return valueString(record["id"])
}
