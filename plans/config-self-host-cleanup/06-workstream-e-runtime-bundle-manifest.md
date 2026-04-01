# Workstream E — Introduce a self-host runtime bundle manifest

### Goal

Make runtime assets and migrations discoverable from one place.

This workstream owns the runtime bundle contract. Command behavior such as "`onequery serve` is self-host only" is owned by Workstream D.

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
