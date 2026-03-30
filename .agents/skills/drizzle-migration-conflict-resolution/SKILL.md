---
name: drizzle-migration-conflict-resolution
description: Resolve Drizzle migration merge/rebase conflicts in OneQuery by rewinding local-only migration history and regenerating migration metadata. Use when conflicts involve packages/db/src/migrations/meta/_journal.json, migration SQL files in packages/db/src/migrations/*.sql, or migration snapshots in packages/db/src/migrations/meta/*_snapshot.json.
---

# DB Migration Conflict Resolution

## Goal
Resolve Drizzle migration conflicts without manually editing migration SQL or `meta/_journal.json`.

## Workflow
1. Inspect conflict scope.
- Run `git status --short`.
- Confirm the migration conflict includes `packages/db/src/migrations/meta/_journal.json`.
- If non-migration conflicts need product decisions, stop and ask the user.

2. Fetch the base branch.
- Run `git fetch origin`.
- Default to `origin/main` unless the user requests another base branch.

3. Keep incoming journal history as baseline.
- Run `git checkout --theirs packages/db/src/migrations/meta/_journal.json`.
- Do not hand-edit `packages/db/src/migrations/meta/_journal.json`.

4. Find local-only migration artifacts.
- Run:
```bash
comm -23 <(git ls-tree -r --name-only HEAD packages/db/src/migrations | sort) \
  <(git ls-tree -r --name-only origin/main packages/db/src/migrations | sort)
```
- Treat returned SQL and snapshot files as local-only migration history.

5. Remove local-only migration artifacts.
- Run `git rm <each-local-only-file>` for returned migration SQL and snapshot files.
- Keep incoming branch migration files intact.

6. Regenerate migration chain from schema.
- Run `cd packages/db && bun run db:generate`.
- Let Drizzle regenerate the next migration and update `meta/_journal.json`.

7. Stage and verify.
- Run `git add packages/db/src/migrations packages/db/src/migrations/meta/_journal.json`.
- Confirm no conflict markers remain:
```bash
rg -n "^(<<<<<<<|=======|>>>>>>>)" packages/db/src/migrations/meta/_journal.json
```
- Inspect generated SQL and verify it reflects expected schema deltas only.

8. Finalize merge/rebase.
- Continue merge/rebase flow with `git commit` or `git rebase --continue`.
- If pre-commit/pre-push hooks rewrite migration metadata formatting, commit the formatted files so the branch is clean.

## Guardrails
- Never manually create or edit files inside `packages/db/src/migrations/`.
- Never manually edit `packages/db/src/migrations/meta/_journal.json`.
- Regenerate via `bun run db:generate` after history rewind.
- If generated migration includes unexpected schema changes, stop and ask the user before committing.
