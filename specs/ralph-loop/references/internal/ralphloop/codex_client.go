package ralphloop

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

type codexClient interface {
	Initialize(ctx context.Context) error
	StartThread(ctx context.Context, options startThreadOptions) (string, error)
	RunTurn(ctx context.Context, options runTurnOptions) (turnResult, error)
	CompactThread(ctx context.Context, threadID string) error
	Close() error
	SetNotificationHandler(handler func(jsonRPCNotification))
}

type startThreadOptions struct {
	Model          string
	Cwd            string
	ApprovalPolicy string
	Sandbox        any
}

type runTurnOptions struct {
	ThreadID       string
	Prompt         string
	Timeout        time.Duration
	Model          string
	Cwd            string
	ApprovalPolicy string
	SandboxPolicy  any
}

type turnResult struct {
	Status         string
	TurnID         string
	AgentText      string
	CodexErrorInfo string
}

type jsonRPCNotification struct {
	Method string
	Params map[string]any
}

type jsonRPCEnvelope struct {
	ID     *int64          `json:"id,omitempty"`
	Method string          `json:"method,omitempty"`
	Params json.RawMessage `json:"params,omitempty"`
	Result json.RawMessage `json:"result,omitempty"`
	Error  *jsonRPCError   `json:"error,omitempty"`
}

type jsonRPCError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

type appServerClient struct {
	command       *exec.Cmd
	stdin         ioWriteCloser
	stdoutDone    chan struct{}
	stderrDone    chan struct{}
	waitResult    chan error
	readErr       chan error
	nextID        int64
	pendingMu     sync.Mutex
	pending       map[int64]chan jsonRPCEnvelope
	notifications chan jsonRPCNotification
	closeOnce     sync.Once
	notification  func(jsonRPCNotification)
	logMu         sync.Mutex
	logFile       *os.File
	telemetry     *ralphTelemetry
}

type ioWriteCloser interface {
	Write([]byte) (int, error)
	Close() error
}

func newAppServerClient(logPath string) (codexClient, error) {
	commandText := strings.TrimSpace(os.Getenv("RALPH_LOOP_CODEX_COMMAND"))
	parts := strings.Fields(commandText)
	if len(parts) == 0 {
		parts = []string{"codex", "app-server"}
	}

	command := exec.Command(parts[0], parts[1:]...)
	stdin, err := command.StdinPipe()
	if err != nil {
		return nil, err
	}
	stdout, err := command.StdoutPipe()
	if err != nil {
		return nil, err
	}
	stderr, err := command.StderrPipe()
	if err != nil {
		return nil, err
	}
	if err := command.Start(); err != nil {
		return nil, err
	}

	client := &appServerClient{
		command:       command,
		stdin:         stdin,
		stdoutDone:    make(chan struct{}),
		stderrDone:    make(chan struct{}),
		waitResult:    make(chan error, 1),
		readErr:       make(chan error, 1),
		pending:       map[int64]chan jsonRPCEnvelope{},
		notifications: make(chan jsonRPCNotification, 128),
		telemetry:     lookupTelemetryForLogPath(logPath),
	}
	if client.telemetry == nil {
		client.telemetry, _ = newRalphTelemetryFromLogPath(logPath)
	}
	if strings.TrimSpace(logPath) != "" {
		if err := os.MkdirAll(filepath.Dir(logPath), 0o755); err != nil {
			_ = client.Close()
			return nil, err
		}
		file, err := os.OpenFile(logPath, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
		if err != nil {
			_ = client.Close()
			return nil, err
		}
		client.logFile = file
	}

	go client.readLoop(stdout)
	go client.readStderr(stderr)
	go func() {
		client.waitResult <- command.Wait()
		close(client.waitResult)
	}()

	return client, nil
}

func (client *appServerClient) SetNotificationHandler(handler func(jsonRPCNotification)) {
	client.notification = handler
}

func (client *appServerClient) Initialize(ctx context.Context) error {
	span := client.startSpan("ralph_loop.codex.initialize", nil)
	client.logDiagnostic("initialize request sent")
	client.incrementMetric("ralph_loop_codex_initialize_total", 1)
	if _, err := client.request(ctx, "initialize", map[string]any{
		"clientInfo": map[string]any{
			"name":    "ralph_loop",
			"title":   "Ralph Loop",
			"version": "1.0.0",
		},
	}); err != nil {
		client.logDiagnostic("initialize failed: %v", err)
		endSpan(span, "error", err, nil)
		return err
	}
	if err := client.notify("initialized", map[string]any{}); err != nil {
		client.logDiagnostic("initialized notification failed: %v", err)
		endSpan(span, "error", err, nil)
		return err
	}
	client.logDiagnostic("initialize completed")
	endSpan(span, "ok", nil, nil)
	return nil
}

func (client *appServerClient) StartThread(ctx context.Context, options startThreadOptions) (string, error) {
	span := client.startSpan("ralph_loop.codex.thread_start", map[string]any{
		"cwd":             strings.TrimSpace(options.Cwd),
		"approval_policy": strings.TrimSpace(options.ApprovalPolicy),
		"model":           strings.TrimSpace(options.Model),
	})
	client.logDiagnostic("thread/start request cwd=%s approval=%s", strings.TrimSpace(options.Cwd), strings.TrimSpace(options.ApprovalPolicy))
	client.incrementMetric("ralph_loop_codex_thread_start_total", 1)
	result, err := client.request(ctx, "thread/start", map[string]any{
		"model":          options.Model,
		"cwd":            options.Cwd,
		"approvalPolicy": options.ApprovalPolicy,
		"sandbox":        options.Sandbox,
	})
	if err != nil {
		client.logDiagnostic("thread/start failed: %v", err)
		endSpan(span, "error", err, nil)
		return "", err
	}
	threadID := stringAtPath(result, "thread", "id")
	if strings.TrimSpace(threadID) == "" {
		client.logDiagnostic("thread/start returned empty thread id")
		err := fmt.Errorf("thread/start did not return a thread id")
		endSpan(span, "error", err, nil)
		return "", err
	}
	client.logDiagnostic("thread/start completed thread_id=%s", threadID)
	client.setMetric("ralph_loop_last_thread_id", threadID)
	endSpan(span, "ok", nil, map[string]any{"thread_id": threadID})
	return threadID, nil
}

func (client *appServerClient) RunTurn(ctx context.Context, options runTurnOptions) (turnResult, error) {
	timeout := options.Timeout
	if timeout <= 0 {
		timeout = 2 * time.Hour
	}
	requestCtx := ctx
	var cancel context.CancelFunc
	if _, ok := ctx.Deadline(); !ok {
		requestCtx, cancel = context.WithTimeout(ctx, timeout)
		defer cancel()
	}

	startPayload := map[string]any{
		"threadId": options.ThreadID,
		"input": []map[string]any{{
			"type": "text",
			"text": options.Prompt,
		}},
	}
	if strings.TrimSpace(options.Model) != "" {
		startPayload["model"] = options.Model
	}
	if strings.TrimSpace(options.Cwd) != "" {
		startPayload["cwd"] = options.Cwd
	}
	if strings.TrimSpace(options.ApprovalPolicy) != "" {
		startPayload["approvalPolicy"] = options.ApprovalPolicy
	}
	if options.SandboxPolicy != nil {
		startPayload["sandboxPolicy"] = options.SandboxPolicy
	}
	span := client.startSpan("ralph_loop.codex.turn", map[string]any{
		"thread_id":       strings.TrimSpace(options.ThreadID),
		"cwd":             strings.TrimSpace(options.Cwd),
		"approval_policy": strings.TrimSpace(options.ApprovalPolicy),
		"model":           strings.TrimSpace(options.Model),
		"timeout_ms":      int(timeout / time.Millisecond),
	})
	client.logDiagnostic("turn/start request thread_id=%s timeout=%s", options.ThreadID, timeout)
	client.incrementMetric("ralph_loop_codex_turn_start_total", 1)
	startResult, err := client.request(requestCtx, "turn/start", startPayload)
	if err != nil {
		client.logDiagnostic("turn/start request failed thread_id=%s error=%v", options.ThreadID, err)
		endSpan(span, "error", err, nil)
		return turnResult{}, err
	}

	activeTurnID := stringAtPath(startResult, "turn", "id")
	client.logDiagnostic("turn/start acknowledged thread_id=%s turn_id=%s", options.ThreadID, activeTurnID)
	client.setMetric("ralph_loop_last_turn_id", activeTurnID)
	agentChunks := make([]string, 0, 8)

	for {
		select {
		case <-requestCtx.Done():
			client.logDiagnostic("turn wait timed out thread_id=%s turn_id=%s timeout=%s", options.ThreadID, activeTurnID, timeout)
			client.incrementMetric("ralph_loop_codex_turn_timeout_total", 1)
			if strings.TrimSpace(activeTurnID) != "" {
				_, _ = client.request(context.Background(), "turn/interrupt", map[string]any{
					"threadId": options.ThreadID,
					"turnId":   activeTurnID,
				})
			}
			err := fmt.Errorf("turn/start timed out after %s", timeout)
			endSpan(span, "timeout", err, map[string]any{"turn_id": activeTurnID})
			return turnResult{}, err
		case waitErr := <-client.waitResult:
			client.logDiagnostic("app-server process exited while waiting thread_id=%s turn_id=%s err=%v", options.ThreadID, activeTurnID, waitErr)
			if waitErr == nil {
				err := fmt.Errorf("codex app-server exited unexpectedly")
				endSpan(span, "error", err, map[string]any{"turn_id": activeTurnID})
				return turnResult{}, err
			}
			endSpan(span, "error", waitErr, map[string]any{"turn_id": activeTurnID})
			return turnResult{}, waitErr
		case readErr := <-client.readErr:
			client.logDiagnostic("app-server stdout ended while waiting thread_id=%s turn_id=%s err=%v", options.ThreadID, activeTurnID, readErr)
			if readErr == nil || readErr == io.EOF {
				err := fmt.Errorf("codex app-server stream closed unexpectedly")
				endSpan(span, "error", err, map[string]any{"turn_id": activeTurnID})
				return turnResult{}, err
			}
			err := fmt.Errorf("codex app-server stream failed: %w", readErr)
			endSpan(span, "error", err, map[string]any{"turn_id": activeTurnID})
			return turnResult{}, err
		case notification := <-client.notifications:
			if client.notification != nil {
				client.notification(notification)
			}
			client.incrementMetric("ralph_loop_codex_notifications_total", 1)
			switch strings.TrimSpace(notification.Method) {
			case "turn/started":
				if turnID := stringAtPath(notification.Params, "turn", "id"); strings.TrimSpace(turnID) != "" {
					activeTurnID = turnID
					client.logDiagnostic("turn/started notification thread_id=%s turn_id=%s", options.ThreadID, activeTurnID)
					client.setMetric("ralph_loop_last_turn_id", activeTurnID)
				}
			case "item/completed":
				text := extractAgentText(notification.Params["item"])
				if strings.TrimSpace(text) != "" {
					agentChunks = append(agentChunks, text)
				}
			case "turn/completed":
				completedTurnID := stringAtPath(notification.Params, "turn", "id")
				if strings.TrimSpace(completedTurnID) == "" {
					completedTurnID = valueString(notification.Params["id"])
				}
				if strings.TrimSpace(activeTurnID) != "" && strings.TrimSpace(completedTurnID) != "" && completedTurnID != activeTurnID {
					continue
				}
				status := strings.TrimSpace(valueString(notification.Params["status"]))
				if status == "" {
					status = strings.TrimSpace(stringAtPath(notification.Params, "turn", "status"))
				}
				if status == "" {
					status = "completed"
				}
				codexErrorInfo := strings.TrimSpace(stringAtPath(notification.Params, "turn", "codexErrorInfo"))
				if codexErrorInfo == "" {
					codexErrorInfo = strings.TrimSpace(valueString(notification.Params["codexErrorInfo"]))
				}
				client.logDiagnostic("turn/completed notification thread_id=%s turn_id=%s status=%s codex_error=%s", options.ThreadID, firstNonEmpty(completedTurnID, activeTurnID), status, codexErrorInfo)
				client.setMetric("ralph_loop_last_turn_status", status)
				if strings.TrimSpace(codexErrorInfo) != "" {
					client.setMetric("last_error", codexErrorInfo)
				}
				endSpan(span, status, nil, map[string]any{
					"turn_id":          firstNonEmpty(completedTurnID, activeTurnID),
					"turn_status":      status,
					"codex_error_info": codexErrorInfo,
				})
				return turnResult{
					Status:         status,
					TurnID:         firstNonEmpty(completedTurnID, activeTurnID),
					AgentText:      collectAgentText(agentChunks),
					CodexErrorInfo: codexErrorInfo,
				}, nil
			}
		}
	}
}

func (client *appServerClient) CompactThread(ctx context.Context, threadID string) error {
	span := client.startSpan("ralph_loop.codex.thread_compact", map[string]any{"thread_id": strings.TrimSpace(threadID)})
	_, err := client.request(ctx, "thread/compact/start", map[string]any{"threadId": threadID})
	endSpan(span, statusFromError(err), err, map[string]any{"thread_id": strings.TrimSpace(threadID)})
	return err
}

func (client *appServerClient) Close() error {
	var closeErr error
	client.closeOnce.Do(func() {
		client.logDiagnostic("closing app-server client")
		_ = client.stdin.Close()
		if client.command.Process != nil {
			_ = client.command.Process.Kill()
		}
		if client.logFile != nil {
			closeErr = client.logFile.Close()
		}
	})
	return closeErr
}

func (client *appServerClient) request(ctx context.Context, method string, params map[string]any) (map[string]any, error) {
	id := client.nextRequestID()
	responseCh := make(chan jsonRPCEnvelope, 1)
	client.pendingMu.Lock()
	client.pending[id] = responseCh
	client.pendingMu.Unlock()

	if err := client.writeEnvelope(jsonRPCEnvelope{
		ID:     &id,
		Method: method,
		Params: mustMarshalRaw(params),
	}); err != nil {
		client.pendingMu.Lock()
		delete(client.pending, id)
		client.pendingMu.Unlock()
		return nil, err
	}

	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	case envelope := <-responseCh:
		if envelope.Error != nil {
			return nil, fmt.Errorf("%s: %s", method, envelope.Error.Message)
		}
		result := map[string]any{}
		if len(envelope.Result) == 0 {
			return result, nil
		}
		if err := json.Unmarshal(envelope.Result, &result); err != nil {
			return nil, err
		}
		return result, nil
	}
}

func (client *appServerClient) notify(method string, params map[string]any) error {
	return client.writeEnvelope(jsonRPCEnvelope{
		Method: method,
		Params: mustMarshalRaw(params),
	})
}

func (client *appServerClient) writeEnvelope(envelope jsonRPCEnvelope) error {
	encoded, err := json.Marshal(envelope)
	if err != nil {
		return err
	}
	line := append(encoded, '\n')
	client.logLine("stdin", strings.TrimSpace(string(encoded)))
	_, err = client.stdin.Write(line)
	return err
}

func (client *appServerClient) readLoop(stdoutReader io.Reader) {
	defer close(client.stdoutDone)
	scanner := bufio.NewScanner(stdoutReader)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	for scanner.Scan() {
		line := scanner.Text()
		client.logLine("stdout", line)

		envelope := jsonRPCEnvelope{}
		if err := json.Unmarshal([]byte(line), &envelope); err != nil {
			continue
		}
		if strings.TrimSpace(envelope.Method) != "" {
			if envelope.ID != nil {
				client.handleServerRequest(envelope)
				continue
			}
			params := map[string]any{}
			_ = json.Unmarshal(envelope.Params, &params)
			client.notifications <- jsonRPCNotification{Method: envelope.Method, Params: params}
			continue
		}
		if envelope.ID == nil {
			continue
		}

		client.pendingMu.Lock()
		responseCh := client.pending[*envelope.ID]
		delete(client.pending, *envelope.ID)
		client.pendingMu.Unlock()
		if responseCh != nil {
			responseCh <- envelope
		}
	}
	if err := scanner.Err(); err != nil {
		client.logDiagnostic("stdout scanner failed: %v", err)
		client.reportReadError(err)
		return
	}
	client.logDiagnostic("stdout scanner reached EOF")
	client.reportReadError(io.EOF)
}

func (client *appServerClient) readStderr(stderrReader io.Reader) {
	defer close(client.stderrDone)
	scanner := bufio.NewScanner(stderrReader)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	for scanner.Scan() {
		client.logLine("stderr", scanner.Text())
	}
}

func (client *appServerClient) logLine(channel string, payload string) {
	if client.logFile == nil {
		if client.telemetry != nil {
			client.telemetry.Log(logLevelForChannel(channel), fmt.Sprintf("app-server %s", strings.TrimSpace(channel)), map[string]any{
				"channel":   strings.TrimSpace(channel),
				"payload":   payload,
				"component": "codex-app-server",
			})
			client.telemetry.IncrementMetric("ralph_loop_app_server_"+metricKey(channel)+"_lines_total", 1)
		}
		return
	}
	client.logMu.Lock()
	if client.logFile != nil {
		_, _ = fmt.Fprintf(client.logFile, "%s %s: %s\n", time.Now().UTC().Format(time.RFC3339Nano), channel, payload)
	}
	client.logMu.Unlock()
	if client.telemetry != nil {
		client.telemetry.Log(logLevelForChannel(channel), fmt.Sprintf("app-server %s", strings.TrimSpace(channel)), map[string]any{
			"channel":   strings.TrimSpace(channel),
			"payload":   payload,
			"component": "codex-app-server",
		})
		client.telemetry.IncrementMetric("ralph_loop_app_server_"+metricKey(channel)+"_lines_total", 1)
	}
}

func (client *appServerClient) handleServerRequest(envelope jsonRPCEnvelope) {
	if envelope.ID == nil {
		return
	}
	client.logDiagnostic("server request received id=%d method=%s", *envelope.ID, envelope.Method)
	switch envelope.Method {
	case "item/commandExecution/requestApproval", "item/fileChange/requestApproval":
		client.logDiagnostic("server request accepted id=%d method=%s", *envelope.ID, envelope.Method)
		_ = client.writeEnvelope(jsonRPCEnvelope{
			ID:     envelope.ID,
			Result: mustMarshalRaw("accept"),
		})
	default:
		client.logDiagnostic("server request unsupported id=%d method=%s", *envelope.ID, envelope.Method)
		_ = client.writeEnvelope(jsonRPCEnvelope{
			ID: envelope.ID,
			Error: &jsonRPCError{
				Code:    -32601,
				Message: fmt.Sprintf("unsupported server request: %s", envelope.Method),
			},
		})
	}
}

func (client *appServerClient) reportReadError(err error) {
	select {
	case client.readErr <- err:
	default:
	}
}

func (client *appServerClient) logDiagnostic(format string, args ...any) {
	client.logLine("stderr", "[client] "+fmt.Sprintf(format, args...))
}

func (client *appServerClient) startSpan(name string, attrs map[string]any) *ralphTelemetrySpan {
	if client.telemetry == nil {
		return nil
	}
	fields := cloneFields(attrs)
	fields["component"] = "codex-client"
	return client.telemetry.StartSpan(name, fields)
}

func (client *appServerClient) incrementMetric(name string, delta int64) {
	if client.telemetry == nil {
		return
	}
	client.telemetry.IncrementMetric(name, delta)
}

func (client *appServerClient) setMetric(name string, value any) {
	if client.telemetry == nil {
		return
	}
	client.telemetry.SetMetric(name, value)
}

func endSpan(span *ralphTelemetrySpan, status string, err error, fields map[string]any) {
	if span == nil {
		return
	}
	span.End(status, err, fields)
}

func statusFromError(err error) string {
	if err != nil {
		return "error"
	}
	return "ok"
}

func metricKey(value string) string {
	replacer := strings.NewReplacer("-", "_", " ", "_", "/", "_", ".", "_")
	return replacer.Replace(strings.ToLower(strings.TrimSpace(value)))
}

func logLevelForChannel(channel string) string {
	switch strings.TrimSpace(strings.ToLower(channel)) {
	case "stderr":
		return "warn"
	default:
		return "debug"
	}
}

func (client *appServerClient) nextRequestID() int64 {
	client.pendingMu.Lock()
	defer client.pendingMu.Unlock()
	client.nextID++
	return client.nextID
}

func mustMarshalRaw(value any) json.RawMessage {
	encoded, err := json.Marshal(value)
	if err != nil {
		return json.RawMessage("{}")
	}
	return encoded
}

func extractAgentText(item any) string {
	record, ok := item.(map[string]any)
	if !ok {
		return ""
	}
	if valueString(record["type"]) != "agentMessage" {
		return ""
	}
	if direct := strings.TrimSpace(valueString(record["text"])); direct != "" {
		return direct
	}
	parts, ok := record["content"].([]any)
	if !ok {
		return ""
	}
	texts := make([]string, 0, len(parts))
	for _, raw := range parts {
		part, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		if text := strings.TrimSpace(valueString(part["text"])); text != "" {
			texts = append(texts, text)
		}
	}
	return strings.Join(texts, "\n")
}

func stringAtPath(payload map[string]any, path ...string) string {
	if payload == nil {
		return ""
	}
	current := any(payload)
	for _, key := range path {
		record, ok := current.(map[string]any)
		if !ok {
			return ""
		}
		current = record[key]
	}
	return valueString(current)
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}
