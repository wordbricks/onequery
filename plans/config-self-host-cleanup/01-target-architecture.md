# Recommended target architecture

The target architecture should follow these rules.

### Rule 1: same concept, same schema, in both profiles

The single source of truth should be the shared secret schema and encoding rules, not one profile reusing another profile's values.

`onequery.dev.secrets.toml` and self-host `secrets.toml` remain separate files with independently generated values, but shared secret keys must be identical across workspace-dev and self-host:

```toml
[auth]
secret = "..."

[crypto]
master_encryption_key = "..."

[connectors]
enrollment_token = "..."
```

Profile-specific extensions can still exist, for example:

```toml
[smtp]
password = "..."
```

But shared concepts must not fork by profile.

### Rule 2: same concept, same encoding, everywhere

Define a real secret taxonomy instead of “non-empty string”.

Recommended primitives:

- `auth.secret`
  - opaque auth secret
  - generated as 32 random bytes encoded as base64url
- `connectors.enrollment_token`
  - opaque enrollment token
  - generated as 32 random bytes encoded as base64url
- `crypto.master_encryption_key`
  - **must** be 32 random bytes encoded as standard base64
  - validated semantically everywhere it can enter the system

### Rule 3: profile config is authored separately, shared runtime contract is explicit

Keep the good separation that already exists conceptually:

- `workspace-dev` for repo-local `bun dev`
- `self-host` for `onequery serve`

Each profile keeps its own config/secrets files and lifecycle.

But make the shared schema for overlapping secrets explicit and mechanically enforced, not just “similar”.

### Rule 4: self-host runtime assets are a bundle, not path folklore

Self-host should run from one explicit runtime bundle layout, not from several bits of repeated path knowledge.

Recommended direction:

```text
runtime/
  manifest.json
  migrations/
  web/
server/
  onequery-server[platform-specific]
```

The CLI should resolve a **bundle root**, read `runtime/manifest.json`, and launch from that.

No repo-specific path inference inside the `serve` command.

### Rule 5: one owner for schema convergence

Recommended decision:

- the runtime startup path owns application schema convergence
- bootstrap/setup commands own infra/bootstrap only
- tests may still call explicit DB prep helpers as test harnesses

This means:

- self-host runtime startup migrates its DB
- workspace-dev Bun startup migrates its DB
- `dev:setup` should stop applying application migrations

### Rule 6: docs must only describe real supported behavior

If self-host Postgres is not actually implemented through the self-host config model, docs must not describe it as supported.

Ambient `DATABASE_URL` should not be part of the self-host story.

If Postgres self-host is desired later, add it explicitly through self-host config and the launch contract.
