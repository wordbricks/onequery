# Workstreams D/E — Separate execution paths and declare one runtime bundle layout

## Workstream D — Separate workspace-dev and self-host execution paths cleanly

### Goal

Keep the profiles separate in behavior **and** in executable architecture.

This workstream owns command behavior and profile separation. The fixed runtime bundle layout itself is owned by Workstream E.

### Current smell

`onequery serve` currently acts like two commands hidden behind auto-detection:

- packaged self-host runner
- repo-local Bun entry launcher

That is convenient, but it is not clean.

### Recommended decision

`onequery serve` should be **self-host only**.

There should not be a second self-host launch path.

If repo-local self-host smoke is needed, it should stage the same runtime bundle layout and still invoke the same `onequery serve` entrypoint, not a separate command or a repo-only fallback branch inside `serve.rs`.

### TODO

- [ ] Remove repo-local path inference from `apps/cli/.../commands/serve.rs`.
- [ ] Stop using `env!("CARGO_MANIFEST_DIR")` inside `serve.rs` to discover repo assets.
- [ ] Introduce one explicit self-host runtime bundle root input.
- [ ] Keep packaged executable selection logic, but make asset/migration discovery come from the fixed bundle layout, not code branches.
- [ ] If local self-host smoke support is kept, limit it to staging the same bundle layout and then invoking unchanged `onequery serve`.
- [ ] Keep `scripts/run-bun-server.ts` as workspace-dev-only machinery.
- [ ] Remove any accidental “self-host but really using repo-local dev assumptions” behavior from the serve command.
- [ ] Update `docs/self-host.md` to say `onequery serve` is the only self-host launch entrypoint.

### Acceptance

- [ ] `bun dev` remains the repo-local split browser/API flow.
- [ ] `onequery serve` becomes a pure self-host runtime launcher.
- [ ] Any local self-host smoke flow uses the same runtime bundle layout as release and still goes through `onequery serve`.

## Workstream E — Replace path folklore with one fixed self-host runtime bundle layout

### Goal

Make runtime assets and migrations discoverable from one bundle root and one fixed layout.

### Current duplication to remove

The following all know too much about runtime layout:

- `apps/cli/.../commands/serve.rs`
- `apps/cli/scripts/build-npm-package.js`
- `scripts/run-bun-server.ts`
- `packages/bun-server/src/assets.ts`

### Recommended bundle contract

Use one fixed runtime layout relative to a bundle root, for example:

```text
runtime/
  migrations/
  web/
server/
  onequery-server[platform-specific]
```

The important rule is not “manifest vs no manifest”. The important rule is:

- one bundle root
- one layout convention
- no per-callsite guessing

### TODO

- [ ] Make packaging produce one fixed runtime bundle layout relative to the bundle root.
- [ ] Make any local staging path produce the same layout.
- [ ] Make `serve.rs` resolve web assets and migrations from that single layout convention.
- [ ] Remove duplicated web/migrations path constants where they are no longer needed.
- [ ] Pick **one** web build output directory for runtime use.
- [ ] Delete the `dist/client` vs `dist` fallback behavior from self-host runtime code paths.
- [ ] Update `docs/self-host-runtime-foundation.md` to describe the fixed bundle layout and the stricter contract story.

### Strong recommendation on web build output

Choose one runtime output path and enforce it. The current fallback between:

- `apps/web/dist/client`
- `apps/web/dist`

is a smell. The runtime should not need to guess.

### Acceptance

- [ ] One fixed layout defines the runtime bundle structure.
- [ ] Packaging and any local self-host smoke path use the same layout convention.
- [ ] `onequery serve` no longer hardcodes repo-only runtime asset paths.
- [ ] Runtime no longer guesses between multiple web output directories.
- [ ] Docs describe exactly one runtime-discovery story for self-host.
