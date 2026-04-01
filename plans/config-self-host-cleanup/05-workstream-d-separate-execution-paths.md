# Workstreams D/E — Separate execution paths and declare the runtime bundle

## Workstream D — Separate workspace-dev and self-host execution paths cleanly

### Goal

Keep the profiles separate in behavior **and** in executable architecture.

This workstream owns command behavior and profile separation. The runtime bundle manifest itself is owned by Workstream E.

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
- [ ] Update `docs/self-host.md` to say `onequery serve` is self-host only and that repo-local self-host smoke uses a separate staging path.

### Acceptance

- [ ] `bun dev` remains the repo-local split browser/API flow.
- [ ] `onequery serve` becomes a pure self-host runtime launcher.
- [ ] Local self-host smoke uses the same runtime bundle layout as release, not special repo discovery.

## Workstream E — Introduce a self-host runtime bundle manifest

### Goal

Make runtime assets and migrations discoverable from one place.

### Current duplication to remove

The following all know too much about runtime layout:

- `apps/cli/.../commands/serve.rs`
- `apps/cli/scripts/build-npm-package.js`
- `scripts/run-bun-server.ts`
- `packages/bun-server/src/assets.ts`

### Recommended bundle contract

Example:

```json
{
  "bundleVersion": 1,
  "webDir": "runtime/web",
  "migrationsDir": "runtime/migrations"
}
```

Or equivalent relative-path form. Exact fields are less important than having **one** explicit manifest.

### TODO

- [ ] Add `runtime/manifest.json` to the packaged self-host runtime.
- [ ] Make `build-npm-package.js` generate it.
- [ ] Make the local self-host staging path generate the same manifest.
- [ ] Make `serve.rs` read the manifest to find web assets and migrations.
- [ ] Remove duplicated web/migrations path constants where they are no longer needed.
- [ ] Pick **one** web build output directory for runtime use.
- [ ] Delete the `dist/client` vs `dist` fallback behavior from self-host runtime code paths.
- [ ] Update `docs/self-host-runtime-foundation.md` to describe the runtime bundle manifest and the stricter contract story.

### Strong recommendation on web build output

Choose one runtime output path and enforce it. The current fallback between:

- `apps/web/dist/client`
- `apps/web/dist`

is a smell. The runtime should not need to guess.

### Acceptance

- [ ] One manifest defines the runtime bundle layout.
- [ ] Packaging and local self-host smoke consume the same manifest.
- [ ] `onequery serve` no longer hardcodes repo-only runtime asset paths.
- [ ] Runtime no longer guesses between multiple web output directories.
- [ ] Docs describe exactly one runtime-discovery story for self-host.
