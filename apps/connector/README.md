# OneQuery Connector (MVP)

Connector runtime for querying customer Athena datasets from EC2 and returning results to OneQuery over outbound HTTPS.

## What It Does

- Registers with OneQuery using `ONEQUERY_ENROLLMENT_TOKEN` scoped to `ORGANIZATION_ID`
- Sends periodic heartbeat signals
- Polls for `athena_query` jobs
- Validates query safety (read-only, single statement)
- Executes Athena queries using EC2 IAM Role credentials
- Returns either normalized success or normalized error payloads

## Runtime

- Bun
- TypeScript
- AWS SDK v3 (`Athena`, `Glue`)

## Development

```bash
cd apps/connector
cp config/local.toml.example config/local.toml
bun run dev
```

`config/local.toml` is the connector's local source of truth. Keep durable local
settings there. Use process env only for one-off overrides or env-only flags.

Example override:

```bash
cd apps/connector
AWS_REGION=us-east-1 bun run dev
```

Required variables for local development:

```toml
ONEQUERY_BASE_URL = "http://127.0.0.1:4555/api"
ONEQUERY_ENROLLMENT_TOKEN = "replace-with-enrollment-token"
ORGANIZATION_ID = "org_123"
CONNECTOR_NAME = "customer-prod-apne2"
AWS_REGION = "ap-northeast-2"
ATHENA_DATABASE = "silver"
ATHENA_WORKGROUP = "onequery"
ATHENA_OUTPUT_LOCATION = "s3://customer-athena-results/onequery/"
POLL_INTERVAL_MS = 3000
HEARTBEAT_INTERVAL_MS = 15000
QUERY_TIMEOUT_MS = 60000
MAX_ROWS = 1000
MAX_PAYLOAD_BYTES = 5242880
```

Optional variables:

```toml
LOG_LEVEL = "info"
# CONNECTOR_ABORT_ON_PREREQ_FAILURE and CONNECTOR_ABORT_ON_AUTH_FAILURE remain env-only flags.
# HTTPS_PROXY = "http://proxy.company.local:8080"
# NODE_EXTRA_CA_CERTS = "/etc/ssl/certs/custom-ca.pem"
```

Use the Bun API listener, not the Vite browser origin, for `ONEQUERY_BASE_URL`.

## Checks

```bash
cd apps/connector
bun run typecheck
bun run test
bun run check
```

## Production Run

```bash
cd apps/connector
bun run start
```

## AWS Test Environment (Terraform)

For a client-like AWS test setup (Athena/Glue/S3/IAM + optional EC2 + ECR), use:

[`apps/connector/infra/README.md`](./infra/README.md)

## Notes

- No inbound connectivity is required.
- The connector does not log query result row contents.
- Query results are bounded by `MAX_ROWS`, `MAX_PAYLOAD_BYTES`, and `QUERY_TIMEOUT_MS`.
