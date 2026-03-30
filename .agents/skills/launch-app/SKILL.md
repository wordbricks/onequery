---
name: launch-app
description: Launch the OneQuery app for runtime validation and testing.
---

# Launch App

Use this skill when a ticket changes app behavior and you need runtime proof.

Comment: root `bun dev` is not the default worker launch path. It runs human-oriented setup side effects (`dev:setup`) and an extra cron helper loop. Prefer the narrower web flow below unless the ticket explicitly needs the full root dev stack.

## Prep

1. Ensure dependencies are installed:

```bash
bun install --frozen-lockfile
```

2. Ensure local env symlinks exist when the shared secrets are available:

```bash
test -f "$HOME/.onequery-secrets/web.env.local" && ln -snf "$HOME/.onequery-secrets/web.env.local" apps/web/.env.local || true
```

## Launch

For the common app-validation path, launch the web app directly:

```bash
cd apps/web
bun run dev -- --host 127.0.0.1
```

Expected runtime:

- App URL: `http://127.0.0.1:4545`
- If you need the local seed dataset, run `bun run db:seed:dev` separately.
- This is the preferred narrow web-only path for browser validation.

## Verify

Wait for the app to respond before testing:

```bash
curl -I http://127.0.0.1:4545
```

Then validate the changed flow in the browser. If the ticket already provides a manual QA path or Playwright scenario, follow that exactly. Otherwise, use the narrowest runtime path that proves the changed behavior.

## Cleanup

Before finishing the ticket or leaving runtime validation:

1. Stop the dev server and any helper processes you started.
2. Remove temporary screenshots, debug outputs, scratch files, and one-off scripts that are not meant to ship.
3. Revert any temporary debug-only edits or extra logging added for proof.
4. Confirm `git status --short` only shows intentional repository changes.
