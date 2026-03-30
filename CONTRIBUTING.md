# Contributing

Thank you for your interest in OneQuery.

## Pull Requests

**We only accept pull requests for new data source integrations.**

The core platform (server, web UI, CLI, database schema) is not open to external contributions at this time. If you have a request for core functionality, please open an issue instead — see [Feature Requests](#feature-requests) below.

### What counts as a data source integration

A data source integration connects OneQuery to an external service — such as Google Analytics, Sentry, Mixpanel, Amplitude, PostHog, GitHub, or Linear — so users can query it alongside their other sources.

Each integration lives in `packages/server/src/services/` and consists of:

- **`{provider}/relay.ts`** — authenticates and proxies requests to the provider's API, with input sanitization and error normalization
- **`testers/{provider}-tester.ts`** — tests the connection using stored credentials and returns a `ConnectionTestResult`

See the existing Sentry integration (`packages/server/src/services/sentry/`) as a reference implementation.

### Before you open a PR

1. Open an issue first describing the data source you want to add. Wait for a maintainer to confirm it's in scope before investing significant time.
2. Fork the repo and work on a branch.
3. Follow the patterns established in existing integrations:
   - Sanitize all inputs; never leak credentials in error messages
   - Normalize errors to human-readable messages with appropriate HTTP status handling
   - Keep the relay stateless — no side effects beyond the outbound API call
   - Cover the relay and tester with unit tests (see `relay.test.ts` files for examples)
4. Run checks before submitting:

```bash
bun run typecheck
bun run lint
bun run test
```

5. Keep the PR focused. One data source per PR.

## Feature Requests

For any feature request outside of data source integrations — new platform capabilities, CLI commands, web UI features, API changes, etc. — please **open a GitHub issue** with a title starting with:

```
[Feature Request] <your title here>
```

Describe what you want to achieve, why it matters, and any relevant context. We review feature requests periodically and will respond in the issue thread.

## Bug Reports

Open a GitHub issue with a clear description of the problem, steps to reproduce, and the version of the CLI or server you're running.

## Setup

```bash
bun install --frozen-lockfile
bun run dev:setup
bun dev
```

See the root `README.md` for full local development instructions.
