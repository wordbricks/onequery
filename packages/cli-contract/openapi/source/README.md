# CLI OpenAPI Source Layout

Edit the split YAML source in this directory, then regenerate the bundled JSON
artifact at `../generated/cli.openapi.json` and Orval outputs with `bun run generate` from `packages/cli-contract`
or `just regen-openapi` from `apps/cli`.

Layout:

- `cli.openapi.yaml` keeps the canonical top-level OpenAPI document and wires the
  split files together with local `$ref`s.
- `paths/*.yaml` groups path items by route family.
- `components/schemas/*.yaml` groups schemas by domain plus a shared `common.yaml`.

Comment: `cli.openapi.yaml` intentionally keeps the bundled path and schema order
stable so regenerating the JSON artifact does not cause noisy downstream diffs in
Orval output or Rust embedding.
