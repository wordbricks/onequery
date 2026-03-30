package ralphloop

func resolveSandbox(mode string, worktreePath string) any {
	_ = worktreePath
	switch mode {
	case "readOnly", "read-only":
		return "read-only"
	case "workspaceWrite", "workspace-write":
		return "workspace-write"
	case "dangerFullAccess", "danger-full-access":
		return "danger-full-access"
	default:
		return mode
	}
}

func resolvePrSandbox(mode string, worktreePath string) any {
	switch mode {
	case "workspaceWrite", "workspace-write":
		return map[string]any{
			"type":          "workspaceWrite",
			"writableRoots": []string{worktreePath},
			"networkAccess": true,
		}
	default:
		return resolveSandbox(mode, worktreePath)
	}
}
