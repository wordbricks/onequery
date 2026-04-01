# OneQuery config / self-host architecture cleanup plan

This plan has been split into smaller files with minimal wording changes so each part can be implemented more easily.

## Checklist

- [ ] [Context and findings](./config-self-host-cleanup/00-context-and-findings.md)
- [ ] [Target architecture](./config-self-host-cleanup/01-target-architecture.md)
- [ ] [Workstream A — Fix the released `onequery serve` data-source bug first](./config-self-host-cleanup/02-workstream-a-fix-self-host-data-source-bug.md)
- [ ] [Workstream B — Unify shared secrets across workspace-dev and self-host](./config-self-host-cleanup/03-workstream-b-unify-shared-secrets.md)
- [ ] [Workstream C — Make the launch contract a real SSoT boundary](./config-self-host-cleanup/04-workstream-c-launch-contract-ssot.md)
- [ ] [Workstream D — Separate workspace-dev and self-host execution paths cleanly](./config-self-host-cleanup/05-workstream-d-separate-execution-paths.md)
- [ ] [Workstream E — Introduce a self-host runtime bundle manifest](./config-self-host-cleanup/06-workstream-e-runtime-bundle-manifest.md)
- [ ] [Workstream F — Make migration ownership explicit and remove storage/doc drift](./config-self-host-cleanup/07-workstream-f-migration-ownership-and-storage.md)
- [ ] [Workstream G — Delete dead knobs and compatibility shims](./config-self-host-cleanup/08-workstream-g-delete-dead-knobs-and-shims.md)
- [ ] [Workstream H — Reduce redundant tests and replace them with higher-value checks](./config-self-host-cleanup/09-workstream-h-reduce-redundant-tests.md)
- [ ] [Workstream I — Update docs so they stop lying](./config-self-host-cleanup/10-workstream-i-update-docs.md)
- [ ] [Implementation order and acceptance](./config-self-host-cleanup/11-implementation-order-and-acceptance.md)

## Notes

- The original investigation, findings, workstreams, and acceptance criteria are preserved in the files above.
- Cross-file references are intentional so implementation can be staged one workstream at a time.
- The top-level checkboxes are for tracking file/workstream completion; the detailed files keep the finer-grained task checklists.
