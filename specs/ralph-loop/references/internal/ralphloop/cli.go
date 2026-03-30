package ralphloop

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
)

const (
	MainUsage = "Usage: ralph-loop \"<user prompt>\" [options]\n       ralph-loop tail [selector] [--lines N] [--follow]\n       ralph-loop ls [selector]"
	TailUsage = "Usage: ralph-loop tail [selector] [--lines N] [--follow] [--raw]"
	ListUsage = "Usage: ralph-loop ls [selector]"
)

type CommandKind string

const (
	CommandMain CommandKind = "main"
	CommandTail CommandKind = "tail"
	CommandList CommandKind = "ls"
)

type MainOptions struct {
	Prompt             string
	Model              string
	BaseBranch         string
	MaxIterations      int
	WorkBranch         string
	WorkBranchProvided bool
	TimeoutSeconds     int
	ApprovalPolicy     string
	Sandbox            string
	PreserveWorktree   bool
}

type TailOptions struct {
	Lines    int
	Follow   bool
	Raw      bool
	Selector string
}

type ListOptions struct {
	Selector string
}

type ParsedCommand struct {
	Kind        CommandKind
	MainOptions MainOptions
	TailOptions TailOptions
	ListOptions ListOptions
}

type usageError struct {
	message string
}

func (err *usageError) Error() string {
	return err.message
}

func IsUsageError(err error) bool {
	var target *usageError
	return errors.As(err, &target)
}

func Run(args []string, cwd string, stdout io.Writer, stderr io.Writer) int {
	repoRoot, err := ResolveRepoRoot(cwd)
	if err != nil {
		_, _ = fmt.Fprintln(stderr, err.Error())
		return 1
	}
	command, err := ParseCommand(args, repoRoot)
	if err != nil {
		_, _ = fmt.Fprintln(stderr, err.Error())
		return 1
	}
	if command.Kind == CommandTail {
		if err := runTailCommand(context.Background(), repoRoot, command.TailOptions, stdout, stderr); err != nil {
			_, _ = fmt.Fprintln(stderr, err.Error())
			return 1
		}
		return 0
	}
	if command.Kind == CommandList {
		if err := runListCommand(repoRoot, command.ListOptions, stdout); err != nil {
			_, _ = fmt.Fprintln(stderr, err.Error())
			return 1
		}
		return 0
	}
	if err := runMain(context.Background(), repoRoot, command.MainOptions, stdout, stderr); err != nil {
		_, _ = fmt.Fprintln(stderr, err.Error())
		return 1
	}
	return 0
}

func ResolveRepoRoot(cwd string) (string, error) {
	if _, err := os.Stat(filepath.Join(cwd, ".git")); err == nil {
		return cwd, nil
	}
	command := exec.Command("git", "rev-parse", "--show-toplevel")
	command.Dir = cwd
	output, err := command.Output()
	if err != nil {
		return "", fmt.Errorf("failed to resolve repository root from %s: %w", cwd, err)
	}
	root := strings.TrimSpace(string(output))
	if root == "" {
		return "", fmt.Errorf("failed to resolve repository root from %s: empty git output", cwd)
	}
	return root, nil
}

func ParseCommand(args []string, repoRoot string) (ParsedCommand, error) {
	if len(args) > 0 && args[0] == "tail" {
		options, err := ParseTailArgs(args[1:])
		if err != nil {
			return ParsedCommand{}, err
		}
		return ParsedCommand{
			Kind:        CommandTail,
			TailOptions: options,
		}, nil
	}
	if len(args) > 0 && args[0] == "ls" {
		options, err := ParseListArgs(args[1:])
		if err != nil {
			return ParsedCommand{}, err
		}
		return ParsedCommand{
			Kind:        CommandList,
			ListOptions: options,
		}, nil
	}

	options, err := ParseMainArgs(args, repoRoot)
	if err != nil {
		return ParsedCommand{}, err
	}
	return ParsedCommand{
		Kind:        CommandMain,
		MainOptions: options,
	}, nil
}

func ParseMainArgs(args []string, repoRoot string) (MainOptions, error) {
	promptParts := make([]string, 0, len(args))
	options := MainOptions{
		Model:            "gpt-5.3-codex",
		BaseBranch:       "main",
		MaxIterations:    20,
		TimeoutSeconds:   43200,
		ApprovalPolicy:   "never",
		Sandbox:          "workspace-write",
		PreserveWorktree: false,
	}

	for index := 0; index < len(args); index++ {
		arg := args[index]
		switch arg {
		case "--help", "-h":
			return MainOptions{}, &usageError{message: MainUsage}
		case "--model":
			value, err := requireValue(args, &index, "--model")
			if err != nil {
				return MainOptions{}, err
			}
			options.Model = value
		case "--base-branch":
			value, err := requireValue(args, &index, "--base-branch")
			if err != nil {
				return MainOptions{}, err
			}
			options.BaseBranch = value
		case "--max-iterations":
			value, err := requireValue(args, &index, "--max-iterations")
			if err != nil {
				return MainOptions{}, err
			}
			parsed, err := strconv.Atoi(value)
			if err != nil {
				return MainOptions{}, fmt.Errorf("invalid value for --max-iterations: %s", value)
			}
			options.MaxIterations = parsed
		case "--work-branch":
			value, err := requireValue(args, &index, "--work-branch")
			if err != nil {
				return MainOptions{}, err
			}
			options.WorkBranch = value
			options.WorkBranchProvided = true
		case "--timeout":
			value, err := requireValue(args, &index, "--timeout")
			if err != nil {
				return MainOptions{}, err
			}
			parsed, err := strconv.Atoi(value)
			if err != nil {
				return MainOptions{}, fmt.Errorf("invalid value for --timeout: %s", value)
			}
			options.TimeoutSeconds = parsed
		case "--approval-policy":
			value, err := requireValue(args, &index, "--approval-policy")
			if err != nil {
				return MainOptions{}, err
			}
			options.ApprovalPolicy = value
		case "--sandbox":
			value, err := requireValue(args, &index, "--sandbox")
			if err != nil {
				return MainOptions{}, err
			}
			options.Sandbox = value
		case "--preserve-worktree":
			options.PreserveWorktree = true
		default:
			promptParts = append(promptParts, arg)
		}
	}

	prompt := strings.TrimSpace(strings.Join(promptParts, " "))

	if prompt == "" {
		return MainOptions{}, &usageError{message: MainUsage}
	}

	options.Prompt = prompt
	if options.WorkBranch == "" {
		slug := slugifyPrompt(prompt)
		if len(slug) > 58 {
			slug = slug[:58]
		}
		options.WorkBranch = "ralph-" + slug
	}

	return options, nil
}

func ParseTailArgs(args []string) (TailOptions, error) {
	options := TailOptions{
		Lines:  40,
		Follow: false,
		Raw:    false,
	}
	positionals := make([]string, 0, 1)

	for index := 0; index < len(args); index++ {
		arg := args[index]
		switch arg {
		case "--help", "-h":
			return TailOptions{}, &usageError{message: TailUsage}
		case "--follow", "-f":
			options.Follow = true
		case "--raw":
			options.Raw = true
		case "--lines", "-n":
			value, err := requireValue(args, &index, arg)
			if err != nil {
				return TailOptions{}, err
			}
			lines, err := strconv.Atoi(value)
			if err != nil || lines <= 0 {
				return TailOptions{}, fmt.Errorf("Invalid value for %s: %s", arg, value)
			}
			options.Lines = lines
		default:
			positionals = append(positionals, arg)
		}
	}

	if len(positionals) > 1 {
		return TailOptions{}, fmt.Errorf("Expected at most one log selector, received: %s", strings.Join(positionals, " "))
	}
	if len(positionals) == 1 {
		options.Selector = positionals[0]
	}

	return options, nil
}

func ParseListArgs(args []string) (ListOptions, error) {
	options := ListOptions{}
	positionals := make([]string, 0, 1)

	for _, arg := range args {
		switch arg {
		case "--help", "-h":
			return ListOptions{}, &usageError{message: ListUsage}
		default:
			positionals = append(positionals, arg)
		}
	}

	if len(positionals) > 1 {
		return ListOptions{}, fmt.Errorf("Expected at most one session selector, received: %s", strings.Join(positionals, " "))
	}
	if len(positionals) == 1 {
		options.Selector = positionals[0]
	}

	return options, nil
}

func requireValue(args []string, index *int, flag string) (string, error) {
	*index += 1
	if *index >= len(args) {
		return "", fmt.Errorf("Missing value for %s", flag)
	}
	return args[*index], nil
}

var (
	slugInvalidCharsPattern = regexp.MustCompile(`[^a-z0-9]+`)
	slugTrimDashesPattern   = regexp.MustCompile(`^-+|-+$`)
	slugMultiDashPattern    = regexp.MustCompile(`-+`)
)

func slugifyPrompt(prompt string) string {
	slug := strings.ToLower(prompt)
	slug = slugInvalidCharsPattern.ReplaceAllString(slug, "-")
	slug = slugTrimDashesPattern.ReplaceAllString(slug, "")
	slug = slugMultiDashPattern.ReplaceAllString(slug, "-")
	if slug == "" {
		return "task"
	}
	return slug
}
