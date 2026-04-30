---
name: gh-pr-writing
description: Write and update GitHub PR titles and PR bodies with repository templates and local conventions. Use when creating PRs with `gh pr create`, revising PR text, choosing a conventional title prefix (for example `feat(web):`), or ensuring ticket suffix rules.
---

# GH PR Writing

## Workflow
1. Inspect changed files (`git show --name-only --oneline HEAD` or `git diff --name-only`).
2. Choose title type and scope from the mapping below.
3. Build title in Conventional Commit PR style.
4. Run `bun run format` manually before commit/push to avoid push-time formatter diffs.
5. Load PR template from `.github/pull_request_template.md` when present.
6. Fill the template with concrete user-facing behavior, implementation details, and executed validation commands.
7. Create or update the PR using `gh pr create` or `gh pr edit`.

## Title Rules
- Format: `<type>(<scope>): <summary>`.
- Keep summary imperative and specific.
- Do not omit scope unless scope is truly cross-cutting.
- If user requires a ticket marker at the end, append exactly as requested (for example `... WOR-2610`).

## Type And Scope Mapping
See the following example:

- `feat(web):` for user-visible frontend behavior in `apps/dashboard`, `packages/ui`, routing/UI/UX changes.
- `fix(web):` for frontend bug fixes.
- `feat(server):` for backend/API behavior changes in `packages/server`.
- `fix(server):` for backend/API bug fixes.
- `feat(db):` or `fix(db):` for schema/query/migration behavior in `packages/db`.
- `chore(repo):` for tooling/config/lockfile/CI/repo maintenance.
- `refactor(<scope>):` for structural code changes without behavior change.
- `test(<scope>):` for test-only changes.
- `docs(<scope>):` for documentation-only changes.
- ...

When multiple scopes are touched, choose the dominant user impact scope.

## PR Body Rules
- Use the repository PR template verbatim section structure when it exists.
- Prefer concrete, observable outcomes over abstract summaries.
- Include exact command lines used for validation.
- Explicitly note excluded items (for example: "README unchanged") when relevant.

## Commands
```bash
# Inspect latest commit

git show --name-only --oneline HEAD

# Format before push

bun run format

# Create PR from template body file

gh pr create --base main --head <branch> --title "<title>" --body-file <body.md>

# Update title/body later

gh pr edit <pr-number-or-url> --title "<title>" --body-file <body.md>
```
