---
name: hono
description: Use for Hono (web framework) development when Codex needs to consult Hono documentation or test Hono apps via the `hono` CLI. Trigger on requests about Hono CLI usage, searching/browsing Hono docs, or testing Hono routes without running a server.
---

# Hono

## Overview

Use the `hono` CLI to find documentation quickly and test handlers without starting a server.

## Workflow

1. Search documentation: `hono search <query>`
2. Read relevant docs: `hono docs [path]`
3. Test implementation: `hono request [file]`

## Core Commands

- `hono --help` - List available commands
- `hono docs [path]` - Browse Hono documentation
- `hono search <query>` - Search documentation
- `hono request [file]` - Test app requests without starting a server

## Examples

```bash
# Search for topics
hono search middleware
hono search "getting started"

# View documentation
hono docs /docs/api/context
hono docs /docs/guides/middleware

# Test your app
hono request -P /api/users src/index.ts
hono request -P /api/users -X POST -d '{"name":"Alice"}' src/index.ts
```

## Usage Notes

- Prefer `hono search` before guessing doc paths.
- Use `hono docs` to confirm API details before coding.
- Use `hono request` to validate routes and handlers during development.
