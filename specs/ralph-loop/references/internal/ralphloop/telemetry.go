package ralphloop

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

const ralphTelemetryServiceName = "ralph-loop"

var ralphTelemetryRegistry sync.Map

type ralphTelemetry struct {
	mu            sync.Mutex
	telemetryRoot string
	worktreeID    string
	traceID       string
	nextSpanID    uint64
	metrics       map[string]any
}

type ralphTelemetrySpan struct {
	telemetry    *ralphTelemetry
	name         string
	traceID      string
	spanID       string
	parentSpanID string
	startedAt    time.Time
	attrs        map[string]any
}

func newRalphTelemetryForWorktree(worktree worktreeInitMetadata) (*ralphTelemetry, error) {
	telemetryRoot := filepath.Join(worktree.WorktreePath, worktree.RuntimeRoot, "telemetry")
	return newRalphTelemetry(telemetryRoot, worktree.WorktreeID)
}

func newRalphTelemetryFromLogPath(logPath string) (*ralphTelemetry, error) {
	trimmed := strings.TrimSpace(logPath)
	if trimmed == "" {
		return nil, nil
	}
	logDir := filepath.Dir(trimmed)
	runtimeRoot := filepath.Dir(logDir)
	worktreeID := filepath.Base(runtimeRoot)
	if strings.TrimSpace(worktreeID) == "" {
		worktreeID = "unknown"
	}
	return newRalphTelemetry(filepath.Join(runtimeRoot, "telemetry"), worktreeID)
}

func newRalphTelemetry(telemetryRoot string, worktreeID string) (*ralphTelemetry, error) {
	root := strings.TrimSpace(telemetryRoot)
	if root == "" {
		return nil, nil
	}
	if err := os.MkdirAll(root, 0o755); err != nil {
		return nil, err
	}
	telemetry := &ralphTelemetry{
		telemetryRoot: root,
		worktreeID:    strings.TrimSpace(worktreeID),
		traceID:       newTelemetryID(32),
		metrics:       map[string]any{},
	}
	if telemetry.worktreeID == "" {
		telemetry.worktreeID = "unknown"
	}
	if err := telemetry.seed(); err != nil {
		return nil, err
	}
	return telemetry, nil
}

func registerTelemetryForLogPath(logPath string, telemetry *ralphTelemetry) func() {
	key := telemetryRegistryKey(logPath)
	if key == "" || telemetry == nil {
		return func() {}
	}
	ralphTelemetryRegistry.Store(key, telemetry)
	return func() {
		ralphTelemetryRegistry.Delete(key)
	}
}

func lookupTelemetryForLogPath(logPath string) *ralphTelemetry {
	key := telemetryRegistryKey(logPath)
	if key == "" {
		return nil
	}
	value, ok := ralphTelemetryRegistry.Load(key)
	if !ok {
		return nil
	}
	telemetry, _ := value.(*ralphTelemetry)
	return telemetry
}

func telemetryRegistryKey(logPath string) string {
	trimmed := strings.TrimSpace(logPath)
	if trimmed == "" {
		return ""
	}
	return filepath.Clean(trimmed)
}

func (telemetry *ralphTelemetry) Log(level string, message string, fields map[string]any) {
	if telemetry == nil {
		return
	}
	payload := telemetry.basePayload()
	payload["ts"] = time.Now().UTC().UnixMilli()
	payload["level"] = strings.TrimSpace(level)
	payload["msg"] = strings.TrimSpace(message)
	for key, value := range cloneFields(fields) {
		payload[key] = value
	}
	telemetry.mu.Lock()
	defer telemetry.mu.Unlock()
	_ = appendJSONLine(filepath.Join(telemetry.telemetryRoot, "logs.jsonl"), payload)
	telemetry.incrementMetricLocked("ralph_loop_log_entries_total", 1)
	telemetry.metrics["last_log_message"] = strings.TrimSpace(message)
	telemetry.metrics["last_log_level"] = strings.TrimSpace(level)
	telemetry.metrics["last_updated_ts"] = time.Now().UTC().UnixMilli()
	_ = telemetry.writeMetricsLocked()
}

func (telemetry *ralphTelemetry) SetMetric(name string, value any) {
	if telemetry == nil {
		return
	}
	telemetry.mu.Lock()
	defer telemetry.mu.Unlock()
	telemetry.metrics[strings.TrimSpace(name)] = value
	telemetry.metrics["last_updated_ts"] = time.Now().UTC().UnixMilli()
	_ = telemetry.writeMetricsLocked()
}

func (telemetry *ralphTelemetry) IncrementMetric(name string, delta int64) {
	if telemetry == nil {
		return
	}
	telemetry.mu.Lock()
	defer telemetry.mu.Unlock()
	telemetry.incrementMetricLocked(strings.TrimSpace(name), delta)
	telemetry.metrics["last_updated_ts"] = time.Now().UTC().UnixMilli()
	_ = telemetry.writeMetricsLocked()
}

func (telemetry *ralphTelemetry) StartSpan(name string, attrs map[string]any) *ralphTelemetrySpan {
	if telemetry == nil {
		return nil
	}
	return telemetry.startSpan(name, "", attrs)
}

func (telemetry *ralphTelemetry) startSpan(name string, parentSpanID string, attrs map[string]any) *ralphTelemetrySpan {
	if telemetry == nil {
		return nil
	}
	return &ralphTelemetrySpan{
		telemetry:    telemetry,
		name:         strings.TrimSpace(name),
		traceID:      telemetry.traceID,
		spanID:       newTelemetryID(16),
		parentSpanID: strings.TrimSpace(parentSpanID),
		startedAt:    time.Now().UTC(),
		attrs:        cloneFields(attrs),
	}
}

func (span *ralphTelemetrySpan) StartChild(name string, attrs map[string]any) *ralphTelemetrySpan {
	if span == nil || span.telemetry == nil {
		return nil
	}
	merged := cloneFields(span.attrs)
	for key, value := range cloneFields(attrs) {
		merged[key] = value
	}
	return span.telemetry.startSpan(name, span.spanID, merged)
}

func (span *ralphTelemetrySpan) End(status string, err error, fields map[string]any) {
	if span == nil || span.telemetry == nil {
		return
	}
	endedAt := time.Now().UTC()
	payload := span.telemetry.basePayload()
	payload["trace_id"] = span.traceID
	payload["span_id"] = span.spanID
	if span.parentSpanID != "" {
		payload["parent_span_id"] = span.parentSpanID
	}
	payload["name"] = span.name
	payload["start_unix_ms"] = span.startedAt.UnixMilli()
	payload["end_unix_ms"] = endedAt.UnixMilli()
	payload["duration_ms"] = endedAt.Sub(span.startedAt).Milliseconds()
	payload["status"] = strings.TrimSpace(status)
	for key, value := range cloneFields(span.attrs) {
		payload[key] = value
	}
	for key, value := range cloneFields(fields) {
		payload[key] = value
	}
	if err != nil {
		payload["error"] = err.Error()
	}

	span.telemetry.mu.Lock()
	defer span.telemetry.mu.Unlock()
	_ = appendJSONLine(filepath.Join(span.telemetry.telemetryRoot, "traces.jsonl"), payload)
	span.telemetry.incrementMetricLocked("ralph_loop_trace_spans_total", 1)
	span.telemetry.metrics["last_span_name"] = span.name
	span.telemetry.metrics["last_span_status"] = strings.TrimSpace(status)
	span.telemetry.metrics["last_updated_ts"] = endedAt.UnixMilli()
	if err != nil {
		span.telemetry.metrics["last_error"] = err.Error()
	}
	_ = span.telemetry.writeMetricsLocked()
}

func (telemetry *ralphTelemetry) basePayload() map[string]any {
	return map[string]any{
		"app":                   ralphTelemetryServiceName,
		"resource.service.name": ralphTelemetryServiceName,
		"worktree_id":           telemetry.worktreeID,
	}
}

func (telemetry *ralphTelemetry) seed() error {
	telemetry.mu.Lock()
	defer telemetry.mu.Unlock()

	metricsPath := filepath.Join(telemetry.telemetryRoot, "metrics.json")
	if content, err := os.ReadFile(metricsPath); err == nil {
		_ = json.Unmarshal(content, &telemetry.metrics)
	}
	if telemetry.metrics == nil {
		telemetry.metrics = map[string]any{}
	}
	telemetry.metrics["app"] = ralphTelemetryServiceName
	telemetry.metrics["resource.service.name"] = ralphTelemetryServiceName
	telemetry.metrics["worktree_id"] = telemetry.worktreeID
	if _, ok := telemetry.metrics["ralph_loop_log_entries_total"]; !ok {
		telemetry.metrics["ralph_loop_log_entries_total"] = int64(0)
	}
	if _, ok := telemetry.metrics["ralph_loop_trace_spans_total"]; !ok {
		telemetry.metrics["ralph_loop_trace_spans_total"] = int64(0)
	}
	if _, ok := telemetry.metrics["last_error"]; !ok {
		telemetry.metrics["last_error"] = ""
	}
	if _, ok := telemetry.metrics["last_updated_ts"]; !ok {
		telemetry.metrics["last_updated_ts"] = time.Now().UTC().UnixMilli()
	}
	if err := telemetry.writeMetricsLocked(); err != nil {
		return err
	}
	for _, name := range []string{"logs.jsonl", "traces.jsonl"} {
		path := filepath.Join(telemetry.telemetryRoot, name)
		if _, err := os.Stat(path); err == nil {
			continue
		}
		if err := os.WriteFile(path, []byte(""), 0o644); err != nil {
			return err
		}
	}
	return nil
}

func (telemetry *ralphTelemetry) writeMetricsLocked() error {
	content, err := json.MarshalIndent(telemetry.metrics, "", "  ")
	if err != nil {
		return err
	}
	content = append(content, '\n')
	return os.WriteFile(filepath.Join(telemetry.telemetryRoot, "metrics.json"), content, 0o644)
}

func (telemetry *ralphTelemetry) incrementMetricLocked(name string, delta int64) {
	if telemetry == nil || strings.TrimSpace(name) == "" {
		return
	}
	current := int64(0)
	switch value := telemetry.metrics[name].(type) {
	case int64:
		current = value
	case int:
		current = int64(value)
	case float64:
		current = int64(value)
	}
	telemetry.metrics[name] = current + delta
}

func cloneFields(fields map[string]any) map[string]any {
	if len(fields) == 0 {
		return map[string]any{}
	}
	cloned := make(map[string]any, len(fields))
	for key, value := range fields {
		cloned[key] = value
	}
	return cloned
}

func appendJSONLine(path string, payload map[string]any) error {
	file, err := os.OpenFile(path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}
	defer file.Close()

	encoded, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	_, err = fmt.Fprintf(file, "%s\n", encoded)
	return err
}

func newTelemetryID(width int) string {
	value := atomic.AddUint64(&telemetrySequence, 1)
	if width <= 0 {
		width = 16
	}
	return fmt.Sprintf("%0*x", width, value)
}

var telemetrySequence uint64
