package ralphloop

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"time"
)

type setupAgentOptions struct {
	Client         codexClient
	Model          string
	Cwd            string
	ApprovalPolicy string
	Sandbox        any
	Timeout        time.Duration
	UserPrompt     string
	PlanPath       string
	WorktreePath   string
	WorktreeID     string
	WorkBranch     string
	BaseBranch     string
}

type codingLoopOptions struct {
	Client        codexClient
	ThreadID      string
	WorktreePath  string
	UserPrompt    string
	PlanPath      string
	MaxIterations int
	Timeout       time.Duration
	Stdout        any
	Stderr        any
	Telemetry     *ralphTelemetry
}

type codingLoopResult struct {
	Iterations int
	Completed  bool
	FinalHead  string
}

type prAgentOptions struct {
	Client         codexClient
	Model          string
	Cwd            string
	ApprovalPolicy string
	ThreadSandbox  any
	SandboxPolicy  any
	Timeout        time.Duration
	PlanPath       string
	BaseBranch     string
}

func runSetupAgent(ctx context.Context, options setupAgentOptions) error {
	threadID, err := options.Client.StartThread(ctx, startThreadOptions{
		Model:          options.Model,
		Cwd:            options.Cwd,
		ApprovalPolicy: options.ApprovalPolicy,
		Sandbox:        options.Sandbox,
	})
	if err != nil {
		return err
	}

	result, err := options.Client.RunTurn(ctx, runTurnOptions{
		ThreadID: threadID,
		Prompt: buildSetupPrompt(setupPromptOptions{
			UserPrompt:   options.UserPrompt,
			PlanPath:     options.PlanPath,
			WorktreePath: options.WorktreePath,
			WorktreeID:   options.WorktreeID,
			WorkBranch:   options.WorkBranch,
			BaseBranch:   options.BaseBranch,
		}),
		Timeout: options.Timeout,
	})
	if err != nil {
		return err
	}
	if strings.EqualFold(result.Status, "failed") {
		if strings.TrimSpace(result.CodexErrorInfo) == "" {
			return fmt.Errorf("setup agent failed")
		}
		return fmt.Errorf("setup agent failed: %s", result.CodexErrorInfo)
	}
	if !containsCompletionSignal(result.AgentText) {
		return fmt.Errorf("setup agent completed without the required completion token")
	}
	if _, err := os.Stat(options.PlanPath); err != nil {
		return fmt.Errorf("setup agent did not create the plan file: %s", options.PlanPath)
	}
	return nil
}

func runCodingLoop(ctx context.Context, options codingLoopOptions) (codingLoopResult, error) {
	stdout, _ := options.Stdout.(interface{ Write([]byte) (int, error) })
	stderr, _ := options.Stderr.(interface{ Write([]byte) (int, error) })

	iterations := 0
	completed := false
	nextPrompt := buildCodingPrompt(codingPromptOptions{UserPrompt: options.UserPrompt, PlanPath: options.PlanPath})
	for ; iterations < options.MaxIterations; iterations++ {
		iterationNumber := iterations + 1
		startingMessage := fmt.Sprintf("Ralph Loop iteration %d/%d: starting turn.", iterationNumber, options.MaxIterations)
		logInfo(stdout, startingMessage)
		if options.Telemetry != nil {
			options.Telemetry.IncrementMetric("ralph_loop_coding_iterations_total", 1)
			options.Telemetry.SetMetric("ralph_loop_last_iteration", iterationNumber)
			options.Telemetry.Log("info", startingMessage, map[string]any{
				"phase":     "coding",
				"iteration": iterationNumber,
			})
		}
		iterationSpan := (*ralphTelemetrySpan)(nil)
		if options.Telemetry != nil {
			iterationSpan = options.Telemetry.StartSpan("ralph_loop.coding_iteration", map[string]any{
				"phase":     "coding",
				"iteration": iterationNumber,
			})
		}

		previousHead := currentHead(options.WorktreePath)
		result, err := options.Client.RunTurn(ctx, runTurnOptions{
			ThreadID: options.ThreadID,
			Prompt:   nextPrompt,
			Timeout:  options.Timeout,
		})
		if err != nil {
			endSpan(iterationSpan, "error", err, map[string]any{"phase": "coding"})
			return codingLoopResult{}, err
		}
		if strings.EqualFold(result.Status, "failed") {
			message := fmt.Sprintf("Ralph Loop iteration %d/%d failed", iterationNumber, options.MaxIterations)
			if strings.TrimSpace(result.CodexErrorInfo) != "" {
				message += ": " + result.CodexErrorInfo
			}
			message += "."
			logWarn(stderr, message)
			if options.Telemetry != nil {
				options.Telemetry.Log("warn", message, map[string]any{
					"phase":            "coding",
					"iteration":        iterationNumber,
					"codex_error_info": result.CodexErrorInfo,
				})
			}
			if result.CodexErrorInfo == "ContextWindowExceeded" {
				compactingMessage := fmt.Sprintf("Ralph Loop iteration %d/%d: compacting thread before recovery.", iterationNumber, options.MaxIterations)
				logInfo(stdout, compactingMessage)
				if options.Telemetry != nil {
					options.Telemetry.Log("info", compactingMessage, map[string]any{
						"phase":     "coding",
						"iteration": iterationNumber,
					})
				}
				if err := options.Client.CompactThread(ctx, options.ThreadID); err != nil {
					endSpan(iterationSpan, "error", err, map[string]any{"phase": "coding"})
					return codingLoopResult{}, err
				}
			}
			recoveryMessage := fmt.Sprintf("Ralph Loop iteration %d/%d: queueing recovery turn.", iterationNumber, options.MaxIterations)
			logInfo(stdout, recoveryMessage)
			if options.Telemetry != nil {
				options.Telemetry.Log("info", recoveryMessage, map[string]any{
					"phase":     "coding",
					"iteration": iterationNumber,
				})
			}
			endSpan(iterationSpan, "failed", nil, map[string]any{
				"phase":            "coding",
				"iteration":        iterationNumber,
				"turn_status":      result.Status,
				"codex_error_info": result.CodexErrorInfo,
			})
			nextPrompt = buildRecoveryPrompt(options.PlanPath)
			continue
		}

		updatedHead := currentHead(options.WorktreePath)
		if previousHead == updatedHead {
			warningMessage := fmt.Sprintf("Ralph Loop warning: iteration %d did not create a new commit.", iterationNumber)
			logWarn(stderr, warningMessage)
			if options.Telemetry != nil {
				options.Telemetry.Log("warn", warningMessage, map[string]any{
					"phase":     "coding",
					"iteration": iterationNumber,
				})
			}
		} else if strings.TrimSpace(updatedHead) != "" {
			short := updatedHead
			if len(short) > 7 {
				short = short[:7]
			}
			commitMessage := fmt.Sprintf("Ralph Loop iteration %d/%d: created commit %s.", iterationNumber, options.MaxIterations, short)
			logInfo(stdout, commitMessage)
			if options.Telemetry != nil {
				options.Telemetry.Log("info", commitMessage, map[string]any{
					"phase":       "coding",
					"iteration":   iterationNumber,
					"commit_head": updatedHead,
				})
				options.Telemetry.SetMetric("ralph_loop_last_commit", updatedHead)
			}
		}

		if containsCompletionSignal(result.AgentText) {
			completionMessage := fmt.Sprintf("Ralph Loop iteration %d/%d: completion signaled.", iterationNumber, options.MaxIterations)
			logInfo(stdout, completionMessage)
			if options.Telemetry != nil {
				options.Telemetry.Log("info", completionMessage, map[string]any{
					"phase":     "coding",
					"iteration": iterationNumber,
				})
			}
			endSpan(iterationSpan, "ok", nil, map[string]any{
				"phase":       "coding",
				"iteration":   iterationNumber,
				"turn_status": result.Status,
				"completed":   true,
			})
			completed = true
			break
		}

		continueMessage := fmt.Sprintf("Ralph Loop iteration %d/%d: continuing to next milestone.", iterationNumber, options.MaxIterations)
		logInfo(stdout, continueMessage)
		if options.Telemetry != nil {
			options.Telemetry.Log("info", continueMessage, map[string]any{
				"phase":     "coding",
				"iteration": iterationNumber,
			})
		}
		endSpan(iterationSpan, "ok", nil, map[string]any{
			"phase":       "coding",
			"iteration":   iterationNumber,
			"turn_status": result.Status,
			"completed":   false,
		})
		nextPrompt = buildCodingPrompt(codingPromptOptions{UserPrompt: options.UserPrompt, PlanPath: options.PlanPath})
	}

	count := iterations
	if completed {
		count++
	}
	return codingLoopResult{Iterations: count, Completed: completed, FinalHead: currentHead(options.WorktreePath)}, nil
}

func runPrAgent(ctx context.Context, options prAgentOptions) (string, error) {
	threadID, err := options.Client.StartThread(ctx, startThreadOptions{
		Model:          options.Model,
		Cwd:            options.Cwd,
		ApprovalPolicy: options.ApprovalPolicy,
		Sandbox:        options.ThreadSandbox,
	})
	if err != nil {
		return "", err
	}
	result, err := options.Client.RunTurn(ctx, runTurnOptions{
		ThreadID:       threadID,
		Prompt:         buildPrPrompt(prPromptOptions{PlanPath: options.PlanPath, BaseBranch: options.BaseBranch}),
		Timeout:        options.Timeout,
		Cwd:            options.Cwd,
		ApprovalPolicy: options.ApprovalPolicy,
		SandboxPolicy:  options.SandboxPolicy,
	})
	if err != nil {
		return "", err
	}
	if strings.EqualFold(result.Status, "failed") {
		if strings.TrimSpace(result.CodexErrorInfo) == "" {
			return "", fmt.Errorf("PR agent failed")
		}
		return "", fmt.Errorf("PR agent failed: %s", result.CodexErrorInfo)
	}
	if !containsCompletionSignal(result.AgentText) {
		return "", fmt.Errorf("PR agent completed without the required completion token")
	}
	return result.AgentText, nil
}

func currentHead(cwd string) string {
	command := exec.Command("git", "rev-parse", "HEAD")
	command.Dir = cwd
	output, err := command.Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(output))
}
