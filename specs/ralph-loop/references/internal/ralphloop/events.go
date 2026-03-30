package ralphloop

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"regexp"
	"strings"
)

type ralphLoopEvent struct {
	Type    string `json:"type"`
	Message string `json:"message,omitempty"`
	Phase   string `json:"phase,omitempty"`
	PRURL   string `json:"prUrl,omitempty"`
}

var prURLPattern = regexp.MustCompile(`https://github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+/pull/\d+`)

func notificationToRalphEvent(phase string, notification jsonRPCNotification) (ralphLoopEvent, bool) {
	if strings.TrimSpace(notification.Method) != "item/completed" {
		return ralphLoopEvent{}, false
	}
	item, ok := asRecord(notification.Params["item"])
	if !ok {
		return ralphLoopEvent{}, false
	}
	if valueString(item["type"]) != "agentMessage" {
		return ralphLoopEvent{}, false
	}
	text := normalizeAgentMessage(item)
	if text == "" {
		return ralphLoopEvent{}, false
	}
	return ralphLoopEvent{
		Type:    "agent_message",
		Message: text,
		Phase:   phase,
	}, true
}

func buildPrCreatedEvent(agentOutput string) ralphLoopEvent {
	match := prURLPattern.FindString(agentOutput)
	if strings.TrimSpace(match) == "" {
		return ralphLoopEvent{Type: "pr_created"}
	}
	return ralphLoopEvent{Type: "pr_created", PRURL: match}
}

func emitEvent(stdout io.Writer, event ralphLoopEvent) {
	if os.Getenv("RALPH_LOOP_EMIT_JSON_EVENTS") != "1" {
		return
	}
	if stdout == nil {
		return
	}
	payload, err := json.Marshal(event)
	if err != nil {
		return
	}
	_, _ = fmt.Fprintf(stdout, "__RALPH_LOOP_EVENT__ %s\n", string(payload))
}

func normalizeAgentMessage(item map[string]any) string {
	direct := valueString(item["text"])
	content := ""
	if rawList, ok := item["content"].([]any); ok {
		parts := make([]string, 0, len(rawList))
		for _, rawPart := range rawList {
			part, ok := asRecord(rawPart)
			if !ok {
				continue
			}
			if text := valueString(part["text"]); text != "" {
				parts = append(parts, text)
			}
		}
		content = strings.Join(parts, "\n")
	}
	combined := strings.TrimSpace(direct)
	if combined == "" {
		combined = strings.TrimSpace(content)
	}
	return stripCompletionSignal(combined)
}

func asRecord(value any) (map[string]any, bool) {
	record, ok := value.(map[string]any)
	return record, ok
}

func valueString(value any) string {
	text, ok := value.(string)
	if !ok {
		return ""
	}
	return text
}
