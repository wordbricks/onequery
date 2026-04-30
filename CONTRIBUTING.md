# Contributing

Thank you for your interest in OneQuery.

## Pull Requests

**We only accept pull requests for new data source integrations.**

The core platform (server, dashboard UI, CLI, database schema) is not open to external contributions at this time. If you have a request for core functionality, please open an issue instead — see [Feature Requests](#feature-requests) below.

### What counts as a data source integration

A data source integration connects OneQuery to an external service — such as Google Analytics, Sentry, Mixpanel, Amplitude, PostHog, GitHub, or Linear — so users can query it alongside their other sources.

### Structure

Each integration requires four changes, all in `packages/`:

**1. Credential schema** — `packages/db/src/credentials.ts`

Add a Zod schema for the provider's credentials using the existing helpers (`trimmedString()`, `requiredOpaqueString()`, `optionalTrimmedUrl()`).

**2. Relay** — `packages/server/src/services/{provider}/relay.ts`

Implement the API call logic using `ProviderHttpClient`. The client handles auth headers, timeout, blocked query params, and credential sanitization in error messages. Your relay only needs to declare what's provider-specific: the base URL, auth config, and input validation.

```typescript
// Example skeleton
function createMyProviderClient(credentials: MyProviderCredentials) {
  return new ProviderHttpClient({
    baseUrl: "https://api.myprovider.com",
    auth: { type: "bearer", token: credentials.apiKey },
    sanitize: (text) => text.split(credentials.apiKey).join("***"),
  });
}

export async function fetchMyProviderApi(input: { credentials, endpoint, options }) {
  const client = createMyProviderClient(input.credentials);
  return client.get(input.endpoint, input.options?.params);
}
```

**3. Tester** — `packages/server/src/services/testers/{provider}-tester.ts`

Use `createHttpTester()`. Pass a `probe` function that calls your relay with a lightweight test request. HTTP status errors (401/403/404/timeout) are mapped to readable messages automatically via `parseHttpStatusError()`; override `parseError` only if you need provider-specific messages.

```typescript
export const testMyProviderConnection = createHttpTester({
  probe: (credentials, timeoutMs) =>
    fetchMyProviderApi({ credentials, endpoint: "/me", options: { timeoutMs } }),
});
```

**4. Route** — `packages/server/src/routes/data-sources/{provider}-query.ts`

Use `createProviderRoute()`. It handles organization access, active data source selection, credential decryption, and `lastUsedAt` updates. You only provide the request schema and the `execute` function.

```typescript
export const myProviderQueryRoute = createProviderRoute({
  provider: "myprovider",
  credentialsGuard: isMyProviderCredentials,
  requestSchema: MyProviderRequestSchema,
  execute: (credentials, req) =>
    fetchMyProviderApi({ credentials, endpoint: req.endpoint, options: req.options }),
});
```

Then register the tester in `data-source-tester.ts` and mount the route in `routes/data-sources/index.ts`.

See the Amplitude integration as the simplest reference (`amplitude/relay.ts`, `testers/amplitude-tester.ts`, `routes/data-sources/amplitude-query.ts`).

### Before you open a PR

1. Open an issue first describing the data source you want to add. Wait for a maintainer to confirm it's in scope before investing significant time.
2. Fork the repo and work on a branch.
3. Keep the relay stateless — no side effects beyond the outbound API call.
4. Never leak credentials in error messages — use the `sanitize` option in `ProviderHttpClient`.
5. Cover the relay with unit tests (see `relay.test.ts` files for examples).
6. Run checks before submitting:

```bash
bun run typecheck
bun run lint
bun run test
```

7. Keep the PR focused. One data source per PR.

## Feature Requests

For any feature request outside of data source integrations — new platform capabilities, CLI commands, dashboard UI features, API changes, etc. — please **open a GitHub issue** with a title starting with:

```
[Feature Request] <your title here>
```

Describe what you want to achieve, why it matters, and any relevant context. We review feature requests periodically and will respond in the issue thread.

## Bug Reports

Open a GitHub issue with a clear description of the problem, steps to reproduce, and the version of the CLI or server you're running.

## Monorepo structure

```text
apps/
  cli/              # Rust CLI workspace
  connector/        # Customer-side connector agent
  dashboard/        # React dashboard SPA
  landing/          # Marketing site

packages/
  base/             # Shared types and org permission helpers
  cli-server/       # CLI-facing endpoints and generated transport bindings
  codecs/           # Shared encoding and decoding utilities
  config/           # Workspace-dev resolver and config projections
  config-loader/    # TOML decoding helper
  contracts/        # Shared Zod-validated API types
  datetime/         # Shared date and time formatting utilities
  db/               # Drizzle schema, migrations, and DB helpers
  github-rulesets/  # GitHub ruleset planning and apply tooling
  self-host-runtime # Self-host runtime that serves API and SPA
  server/           # Shared Hono API routes, services, and middleware
  ui/               # React component library

proto/
  onequery/cli/v1/  # Buf protobuf and Connect contract for the CLI transport

docs/               # Design notes, self-host docs, and migration specs
scripts/            # Repo automation and local development helpers
```

## Local Development

Prerequisites:

- Bun `1.3.10`
- Docker, for local Postgres
- Rust, only if you are changing the CLI

```bash
bun install
bun run dev:setup
bun dev
```

Workspace dev reads the tracked [`onequery.dev.toml`](./onequery.dev.toml) file
plus a local `onequery.dev.secrets.toml` file that `bun run dev:setup` seeds if
missing.

Default local ports:

- browser (Vite): `http://localhost:4545`
- Bun API listener: `http://127.0.0.1:4555`
- self-host bundled runtime: `http://127.0.0.1:5656`

Use `bun dev` for workspace development only. Use `onequery gateway start` for
the bundled self-host runtime.

Validation commands:

```bash
bun lint --format json
bunx turbo check --json
bunx turbo typecheck --json
bunx turbo test --json
```

Database commands:

```bash
bun run db:migrate
bun run db:seed:dev
bun run db:studio
bun run db:reset
```

Proto contract commands:

```bash
bun run proto:lint
bun run proto:generate
bun run proto:check
```

CLI config is stored under `~/.onequery/` by default. Set `ONEQUERY_HOME` to
use a different root.

The self-host runtime writes operator-managed files under that root, including
`self-host/config.toml`, `self-host/secrets.toml`, and the resolved startup
contract at `run/launch.json`.
