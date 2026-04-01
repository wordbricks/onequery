# Implementation order and acceptance

This file owns rollout order only.

Detailed requirements, deletions, and acceptance criteria are owned by the individual workstream files. Do not add a second copy of those checklists here.

## Suggested implementation order

### Phase 1 — Stop the production bug first

Execute Workstream A first. It removes the released self-host failure mode and establishes semantic secret validation before broader cleanup lands.

### Phase 2 — Lock the contract

Execute Workstreams B and C next:

- Workstream B standardizes the shared secret schema across TS and Rust while keeping separate profile-owned secret files.
- Workstream C makes the launch contract a real semantic boundary instead of a shape-only convention.

### Phase 3 — Clean the self-host runtime boundary

Execute Workstreams D and E together:

- Workstream D makes `onequery serve` a pure self-host path.
- Workstream E gives that path one explicit runtime bundle manifest.

### Phase 4 — Clarify DB ownership and storage truth

Execute Workstream F after the runtime boundary is settled so migration ownership and storage support reflect the real launch model.

### Phase 5 — Delete dead config/tests/shims

Execute Workstreams G, H, and I last:

- Workstream G removes behaviorless knobs and compatibility shims that no longer fit the cleaned-up architecture.
- Workstream H trims duplicated tests after the real invariants are defended elsewhere.
- Workstream I updates docs after the implementation is settled.

## Acceptance ownership

- Workstream-local acceptance is authoritative for each implementation area.
- `02` through `10` own the checklists that gate completion of their respective workstreams.
- This file should only describe sequencing and dependency order, not restate detailed acceptance bullets.

## Bottom line

The cleanup only pays off if the plan files themselves keep one source of truth:

- findings in `00`
- target rules in `01`
- workstream requirements and acceptance in `02` through `10`
- sequencing in `11`
