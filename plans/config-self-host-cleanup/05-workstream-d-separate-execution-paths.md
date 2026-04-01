# Workstream D — Separate workspace-dev and self-host execution paths cleanly

### Goal

Keep the profiles separate in behavior **and** in executable architecture.

### Current smell

`onequery serve` currently acts like two commands hidden behind auto-detection:

- packaged self-host runner
- repo-local Bun entry launcher

That is convenient, but it is not clean.

### Recommended decision

`onequery serve` should be **self-host only**.

Repo-local smoke/dev for self-host should use a dedicated dev staging path that builds the same runtime bundle shape and then runs the same self-host command against that staged bundle.

### TODO

- [ ] Remove repo-local path inference from `apps/cli/.../commands/serve.rs`.
- [ ] Stop using `env!("CARGO_MANIFEST_DIR")` inside `serve.rs` to discover repo assets.
- [ ] Introduce one explicit self-host runtime bundle root input.
- [ ] Keep packaged executable selection logic, but make asset/migration discovery come from the bundle manifest, not code branches.
- [ ] Create a dedicated local dev/self-host smoke script that stages a real runtime bundle and invokes `onequery serve` against it.
- [ ] Keep `scripts/run-bun-server.ts` as workspace-dev-only machinery.
- [ ] Remove any accidental “self-host but really using repo-local dev assumptions” behavior from the serve command.

### Acceptance

- [ ] `bun dev` remains the repo-local split browser/API flow.
- [ ] `onequery serve` becomes a pure self-host runtime launcher.
- [ ] Local self-host smoke uses the same runtime bundle layout as release, not special repo discovery.
