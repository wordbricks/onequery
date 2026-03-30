package ralphloop

import (
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"
)

var (
	spawnCodexClient  = newAppServerClient
	initWorktreeFn    = initWorktree
	cleanupWorktreeFn = cleanupWorktree
	resolveNamingFn   = resolveNaming
)

func runMain(ctx context.Context, repoRoot string, options MainOptions, stdout io.Writer, stderr io.Writer) (err error) {
	_, _ = fmt.Fprintln(stdout, "Resolving worktree and branch naming")
	naming := resolveNamingFn(ctx, options, repoRoot, spawnCodexClient)
	_, _ = fmt.Fprintf(stdout, "Initializing worktree %s on branch %s (%s)\n", naming.WorktreeName, naming.WorkBranch, naming.Source)
	if strings.TrimSpace(naming.Reason) != "" {
		_, _ = fmt.Fprintf(stderr, "Naming fallback: %s\n", naming.Reason)
	}

	worktree, err := initWorktreeFn(ctx, initWorktreeOptions{
		RepoRoot:     repoRoot,
		BaseBranch:   options.BaseBranch,
		WorkBranch:   naming.WorkBranch,
		WorktreeName: naming.WorktreeName,
	})
	if err != nil {
		return err
	}

	logFile, err := ensureRalphLogPath(worktree)
	if err != nil {
		return err
	}
	startedAt := time.Now().UTC()
	cleanupSession, err := registerRalphSession(worktree, logFile, startedAt)
	if err != nil {
		return err
	}
	defer cleanupSession()
	telemetry, telemetryErr := newRalphTelemetryForWorktree(worktree)
	if telemetryErr != nil {
		logWarn(stderr, fmt.Sprintf("Ralph Loop telemetry disabled: %s", telemetryErr.Error()))
	}
	unregisterTelemetry := registerTelemetryForLogPath(logFile, telemetry)
	defer unregisterTelemetry()
	planPath := filepath.Join(worktree.WorktreePath, "docs", "exec-plans", "active", defaultPlanFilename(options.Prompt))
	if err := ensurePlanParent(planPath); err != nil {
		return err
	}
	sandbox := resolveSandbox(options.Sandbox, worktree.WorktreePath)
	prSandbox := resolvePrSandbox(options.Sandbox, worktree.WorktreePath)
	turnTimeout := time.Duration(options.TimeoutSeconds) * time.Second
	if turnTimeout <= 0 || turnTimeout > 2*time.Hour {
		turnTimeout = 2 * time.Hour
	}
	var runSpan *ralphTelemetrySpan
	if telemetry != nil {
		telemetry.IncrementMetric("ralph_loop_runs_started_total", 1)
		telemetry.SetMetric("ralph_loop_active_phase", "setup")
		telemetry.SetMetric("ralph_loop_last_run_status", "running")
		telemetry.Log("info", "ralph loop started", map[string]any{
			"work_branch":   worktree.WorkBranch,
			"base_branch":   worktree.BaseBranch,
			"worktree_path": worktree.WorktreePath,
			"prompt":        strings.TrimSpace(options.Prompt),
		})
		runSpan = telemetry.StartSpan("ralph_loop.run", map[string]any{
			"work_branch":   worktree.WorkBranch,
			"base_branch":   worktree.BaseBranch,
			"worktree_path": worktree.WorktreePath,
			"prompt":        strings.TrimSpace(options.Prompt),
		})
		defer func() {
			status := "completed"
			if telemetry != nil {
				telemetry.SetMetric("ralph_loop_active_phase", "")
			}
			if r := recover(); r != nil {
				panic(r)
			}
			if telemetry == nil || runSpan == nil {
				return
			}
			if err != nil {
				status = "failed"
				telemetry.IncrementMetric("ralph_loop_runs_failed_total", 1)
				telemetry.SetMetric("last_error", err.Error())
				telemetry.Log("error", "ralph loop failed", map[string]any{
					"error": err.Error(),
				})
			} else {
				telemetry.IncrementMetric("ralph_loop_runs_completed_total", 1)
				telemetry.SetMetric("last_error", "")
				telemetry.Log("info", "ralph loop completed", map[string]any{
					"work_branch": worktree.WorkBranch,
				})
			}
			telemetry.SetMetric("ralph_loop_last_run_status", status)
			runSpan.End(status, err, map[string]any{
				"work_branch": worktree.WorkBranch,
			})
		}()
	}

	var setupClient codexClient
	var codingClient codexClient
	var prClient codexClient
	defer func() {
		if setupClient != nil {
			_ = setupClient.Close()
		}
		if codingClient != nil {
			_ = codingClient.Close()
		}
		if prClient != nil {
			_ = prClient.Close()
		}
		if !options.PreserveWorktree {
			if cleanupErr := cleanupWorktreeFn(context.Background(), repoRoot, worktree.WorktreePath); cleanupErr != nil {
				_, _ = fmt.Fprintf(stderr, "Failed to clean up worktree %s: %s\n", worktree.WorktreePath, cleanupErr.Error())
			}
		}
	}()

	_, _ = fmt.Fprintf(stdout, "Phase 1/3: setup agent in %s\n", worktree.WorktreePath)
	var setupSpan *ralphTelemetrySpan
	if telemetry != nil {
		telemetry.SetMetric("ralph_loop_active_phase", "setup")
		telemetry.IncrementMetric("ralph_loop_setup_phase_total", 1)
		telemetry.Log("info", "setup phase started", map[string]any{
			"phase":         "setup",
			"worktree_path": worktree.WorktreePath,
		})
		setupSpan = telemetry.StartSpan("ralph_loop.setup", map[string]any{
			"phase":         "setup",
			"worktree_path": worktree.WorktreePath,
		})
	}
	setupClient, err = spawnCodexClient(logFile)
	if err != nil {
		endSpan(setupSpan, "error", err, map[string]any{"phase": "setup"})
		return withLogTail(err, logFile)
	}
	setupClient.SetNotificationHandler(func(notification jsonRPCNotification) {
		if event, ok := notificationToRalphEvent("setup", notification); ok {
			emitEvent(stdout, event)
			if telemetry != nil {
				telemetry.Log("info", "setup agent message", map[string]any{
					"phase":   "setup",
					"message": event.Message,
				})
			}
		}
	})
	if err := setupClient.Initialize(ctx); err != nil {
		endSpan(setupSpan, "error", err, map[string]any{"phase": "setup"})
		return withLogTail(err, logFile)
	}
	if err := runSetupAgent(ctx, setupAgentOptions{
		Client:         setupClient,
		Model:          options.Model,
		Cwd:            worktree.WorktreePath,
		ApprovalPolicy: options.ApprovalPolicy,
		Sandbox:        sandbox,
		Timeout:        turnTimeout,
		UserPrompt:     options.Prompt,
		PlanPath:       planPath,
		WorktreePath:   worktree.WorktreePath,
		WorktreeID:     worktree.WorktreeID,
		WorkBranch:     worktree.WorkBranch,
		BaseBranch:     worktree.BaseBranch,
	}); err != nil {
		endSpan(setupSpan, "error", err, map[string]any{"phase": "setup"})
		return withLogTail(err, logFile)
	}
	endSpan(setupSpan, "ok", nil, map[string]any{"phase": "setup"})
	if telemetry != nil {
		telemetry.Log("info", "setup phase completed", map[string]any{"phase": "setup"})
	}
	_ = setupClient.Close()
	setupClient = nil

	_, _ = fmt.Fprintf(stdout, "Phase 2/3: coding loop on %s\n", worktree.WorkBranch)
	var codingSpan *ralphTelemetrySpan
	if telemetry != nil {
		telemetry.SetMetric("ralph_loop_active_phase", "coding")
		telemetry.IncrementMetric("ralph_loop_coding_phase_total", 1)
		telemetry.Log("info", "coding phase started", map[string]any{
			"phase":       "coding",
			"work_branch": worktree.WorkBranch,
		})
		codingSpan = telemetry.StartSpan("ralph_loop.coding", map[string]any{
			"phase":       "coding",
			"work_branch": worktree.WorkBranch,
		})
	}
	codingClient, err = spawnCodexClient(logFile)
	if err != nil {
		endSpan(codingSpan, "error", err, map[string]any{"phase": "coding"})
		return withLogTail(err, logFile)
	}
	codingClient.SetNotificationHandler(func(notification jsonRPCNotification) {
		if event, ok := notificationToRalphEvent("coding", notification); ok {
			emitEvent(stdout, event)
			if telemetry != nil {
				telemetry.Log("info", "coding agent message", map[string]any{
					"phase":   "coding",
					"message": event.Message,
				})
			}
		}
	})
	if err := codingClient.Initialize(ctx); err != nil {
		endSpan(codingSpan, "error", err, map[string]any{"phase": "coding"})
		return withLogTail(err, logFile)
	}
	codingThreadID, err := codingClient.StartThread(ctx, startThreadOptions{
		Model:          options.Model,
		Cwd:            worktree.WorktreePath,
		ApprovalPolicy: options.ApprovalPolicy,
		Sandbox:        sandbox,
	})
	if err != nil {
		endSpan(codingSpan, "error", err, map[string]any{"phase": "coding"})
		return withLogTail(err, logFile)
	}
	codingResult, err := runCodingLoop(ctx, codingLoopOptions{
		Client:        codingClient,
		ThreadID:      codingThreadID,
		WorktreePath:  worktree.WorktreePath,
		UserPrompt:    options.Prompt,
		PlanPath:      planPath,
		MaxIterations: options.MaxIterations,
		Timeout:       turnTimeout,
		Stdout:        stdout,
		Stderr:        stderr,
		Telemetry:     telemetry,
	})
	if err != nil {
		endSpan(codingSpan, "error", err, map[string]any{"phase": "coding"})
		return withLogTail(err, logFile)
	}
	if !codingResult.Completed {
		err = fmt.Errorf("Ralph Loop reached %d iterations without completion", options.MaxIterations)
		endSpan(codingSpan, "failed", err, map[string]any{"phase": "coding"})
		return withLogTail(err, logFile)
	}
	endSpan(codingSpan, "ok", nil, map[string]any{
		"phase":      "coding",
		"iterations": codingResult.Iterations,
		"final_head": codingResult.FinalHead,
	})
	if telemetry != nil {
		telemetry.SetMetric("ralph_loop_last_commit", codingResult.FinalHead)
		telemetry.Log("info", "coding phase completed", map[string]any{
			"phase":      "coding",
			"iterations": codingResult.Iterations,
			"final_head": codingResult.FinalHead,
		})
	}
	_ = codingClient.Close()
	codingClient = nil

	_, _ = fmt.Fprintln(stdout, "Phase 3/3: PR agent")
	var prSpan *ralphTelemetrySpan
	if telemetry != nil {
		telemetry.SetMetric("ralph_loop_active_phase", "pr")
		telemetry.IncrementMetric("ralph_loop_pr_phase_total", 1)
		telemetry.Log("info", "pr phase started", map[string]any{"phase": "pr"})
		prSpan = telemetry.StartSpan("ralph_loop.pr", map[string]any{"phase": "pr"})
	}
	prClient, err = spawnCodexClient(logFile)
	if err != nil {
		endSpan(prSpan, "error", err, map[string]any{"phase": "pr"})
		return withLogTail(err, logFile)
	}
	prClient.SetNotificationHandler(func(notification jsonRPCNotification) {
		if event, ok := notificationToRalphEvent("pr", notification); ok {
			emitEvent(stdout, event)
			if telemetry != nil {
				telemetry.Log("info", "pr agent message", map[string]any{
					"phase":   "pr",
					"message": event.Message,
				})
			}
		}
	})
	if err := prClient.Initialize(ctx); err != nil {
		endSpan(prSpan, "error", err, map[string]any{"phase": "pr"})
		return withLogTail(err, logFile)
	}
	prOutput, err := runPrAgent(ctx, prAgentOptions{
		Client:         prClient,
		Model:          options.Model,
		Cwd:            worktree.WorktreePath,
		ApprovalPolicy: options.ApprovalPolicy,
		ThreadSandbox:  sandbox,
		SandboxPolicy:  prSandbox,
		Timeout:        turnTimeout,
		PlanPath:       planPath,
		BaseBranch:     options.BaseBranch,
	})
	if err != nil {
		endSpan(prSpan, "error", err, map[string]any{"phase": "pr"})
		return withLogTail(err, logFile)
	}
	endSpan(prSpan, "ok", nil, map[string]any{
		"phase":  "pr",
		"pr_url": buildPrCreatedEvent(prOutput).PRURL,
	})
	if telemetry != nil {
		telemetry.Log("info", "pr phase completed", map[string]any{
			"phase":  "pr",
			"pr_url": buildPrCreatedEvent(prOutput).PRURL,
		})
	}
	_ = prClient.Close()
	prClient = nil

	emitEvent(stdout, buildPrCreatedEvent(prOutput))
	_, _ = fmt.Fprintln(stdout, "Ralph Loop completed.")
	_, _ = fmt.Fprintln(stdout, prOutput)
	return nil
}

func ensurePlanParent(planPath string) error {
	return os.MkdirAll(filepath.Dir(planPath), 0o755)
}

func withLogTail(err error, logPath string) error {
	tail := readTail(logPath, 40)
	return fmt.Errorf("%s\n\nLast Ralph loop log lines:\n%s", err.Error(), tail)
}

func readTail(path string, lines int) string {
	content, err := os.ReadFile(path)
	if err != nil {
		return "(no Ralph loop log written)"
	}
	trimmed := strings.TrimRight(string(content), "\n")
	if trimmed == "" {
		return ""
	}
	parts := strings.Split(trimmed, "\n")
	if lines <= 0 || len(parts) <= lines {
		return strings.Join(parts, "\n")
	}
	return strings.Join(parts[len(parts)-lines:], "\n")
}
