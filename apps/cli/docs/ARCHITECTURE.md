# OneQuery CLI Architecture Note

This note describes the current workflow contract inside `apps/cli/crates/onequery-cli`.

## Workflow Contract

The CLI treats workflows as explicit reducer-driven state machines.

1. A reducer receives the current `state`, an incoming `event`, and immutable workflow context.
2. The reducer returns a `Transition`.
3. If the transition contains an `effect`, `workflows/runner.rs` executes that effect asynchronously.
4. The effect emits the next `event`.
5. The reducer consumes that event and advances the workflow again.
6. The loop ends only when the reducer returns a terminal state.

This keeps reducers pure and pushes I/O into deferred effect execution.

## Current Execution Boundary

- `workflows/runner.rs` owns the reducer -> effect -> event loop.
- `workflows/app.rs` is the top-level CLI workflow.
- Command-specific workflows such as auth and login polling define their own states, events, and effects, but they still rely on the shared runner contract.

## Design Rule

When a CLI feature needs retries, polling, or multi-step orchestration, model it as a workflow state machine and execute it through the shared runner. Avoid introducing ad hoc async control flow directly in command handlers.

## Ownership Boundaries

- Config loading: the `config/` module group owns on-disk config paths, file I/O, parsing, validation, and persistence for user configuration.
- Self-host runtime bootstrap: the `config/` module group also owns `self-host/config.toml`, `self-host/secrets.toml`, platform-standard config/data directory resolution, and the derived runtime paths for PGlite, logs, backups, pid, and lock files.
- Gateway lifecycle command surface: `commands/gateway/mod.rs` owns the public local `onequery gateway*` surface, including the foreground `onequery gateway` launcher, the background `onequery gateway start` launcher, the packaged runtime asset resolution path, and the shared local runtime-state inspection used by `gateway status`, `gateway logs`, and the remaining lifecycle subcommands.
- Credential storage: the `credentials/` module group owns the `auth.json` path, credential metadata persistence, and credential removal semantics.
- Auth session management: `commands/auth/workflow.rs` owns login, logout, and whoami state transitions, while `commands/auth_session.rs` owns the reducer-driven preflight session lifecycle (`load -> refresh -> persist`) that authenticated commands run before building an authenticated API client.
- Transport construction: `commands/mod.rs` resolves command context and builds authenticated or unauthenticated API clients from config plus credentials. `transport/` owns HTTP client construction and endpoint-specific request logic.
- Config targeting: the public `config get <key>` and `config set <key> <value>` commands inspect and persist CLI-owned defaults through the same `config/` ownership boundary that stores active org selection and other local defaults. `org.active` remains writable through `org use` so org selection keeps its validation workflow.
- Developer inspection: the hidden `debug` command surface reads explicit inspection accessors from `config/` and `credentials/` rather than re-reading files directly. That keeps operator and maintainer inspection behind the same state boundaries while still leaving deeper local state inspection off the public command surface.
- OS and platform execution: `Runtime` owns adapter-style integrations such as browser launch and terminal output. Platform-specific branching should stay behind those adapters, and the current platform module intentionally stops there rather than growing shell, subprocess, PTY, or sandbox abstractions before the CLI has a real command-execution feature.

Comment: the auth session boundary is now explicit, but login bootstrap and auth transport construction still meet in `commands/auth/effects.rs`. That is workable today because the reducer/effect split is preserved, but it remains the main place to watch if auth behavior grows again.

## Glossary

- State: the current workflow snapshot consumed by the reducer.
- Event: the input that tells the reducer what happened and lets it decide the next transition.
- Effect: a deferred side-effect token returned by the reducer and executed outside reducer code.
- Terminal state: the finished workflow result returned when no more events need to be processed.
- Runtime: mutable adapters and stores passed into effect execution, such as config, credentials, browser launch, and terminal output.
