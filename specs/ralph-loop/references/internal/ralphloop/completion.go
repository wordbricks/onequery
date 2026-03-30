package ralphloop

import "strings"

const completeToken = "<promise>COMPLETE</promise>"

func containsCompletionSignal(text string) bool {
	return strings.Contains(text, completeToken)
}

func stripCompletionSignal(text string) string {
	return strings.TrimSpace(strings.ReplaceAll(text, completeToken, ""))
}

func collectAgentText(chunks []string) string {
	filtered := make([]string, 0, len(chunks))
	for _, chunk := range chunks {
		trimmed := strings.TrimSpace(chunk)
		if trimmed == "" {
			continue
		}
		filtered = append(filtered, trimmed)
	}
	return strings.TrimSpace(strings.Join(filtered, "\n"))
}
