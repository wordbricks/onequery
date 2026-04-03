# OneQuery config / self-host architecture cleanup plan

This plan is split into smaller files, with each requirement owned in one canonical place.

## Checklist

- [ ] [Context and findings](./config-self-host-cleanup/00-context-and-findings.md)
- [ ] [Target architecture](./config-self-host-cleanup/01-target-architecture.md)
- [x] [Workstream A — Fix the released `onequery serve` data-source bug first](./config-self-host-cleanup/02-workstream-a-fix-self-host-data-source-bug.md)
- [x] [Workstreams B/C — Standardize secret schema and make the launch contract a real boundary](./config-self-host-cleanup/03-workstream-b-unify-shared-secrets.md)
- [x] [Workstreams D/E — Separate execution paths and declare one runtime bundle layout](./config-self-host-cleanup/05-workstream-d-separate-execution-paths.md)
- [ ] [Workstream F — Make migration ownership explicit and remove storage/doc drift](./config-self-host-cleanup/07-workstream-f-migration-ownership-and-storage.md)
- [ ] [Workstreams G/H — Delete dead knobs and replace redundant tests](./config-self-host-cleanup/08-workstream-g-delete-dead-knobs-and-shims.md)

## Notes

- Plan SSoT:
  - `00-context-and-findings.md` owns investigation evidence and current-state analysis.
  - `01-target-architecture.md` owns the normative target architecture.
  - `02`, `03`, `05`, `07`, and `08` own implementation tasks and acceptance.
  - `plan.md` owns the top-level checklist and rollout order.
- Cross-file references are intentional so implementation can be staged one workstream at a time.
- The top-level checkboxes are for tracking file/workstream completion; the detailed files keep the finer-grained task checklists.

## Suggested implementation order

### Phase 1 — Stop the production bug first

Execute Workstream A first. It removes the released self-host failure mode and establishes semantic secret validation before broader cleanup lands.

### Phase 2 — Lock the contract

Execute Workstreams B/C next:

- standardize the shared secret schema across TS and Rust while keeping separate profile-owned secret files
- make the launch contract a real semantic boundary instead of a shape-only convention, without adding a generated schema artifact yet

### Phase 3 — Clean the self-host runtime boundary

Execute Workstreams D/E together:

- make `onequery serve` a pure self-host path
- give that path one explicit runtime bundle layout

### Phase 4 — Clarify DB ownership and supported storage

Execute Workstream F after the runtime boundary is settled so migration ownership and storage support reflect the real launch model.

### Phase 5 — Remove dead surface area and collapse redundant tests

Execute Workstreams G/H last, then finish the remaining doc sync tracked in the workstreams above.
