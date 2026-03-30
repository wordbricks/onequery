---
name: checkout-main-pull-origin
description: Switch the current repository to the `main` branch and pull the latest changes from `origin/main`. Use when the user asks to go back to main, sync main, update the local main branch, or checkout main and pull.
---

# Checkout Main Pull Origin

## Overview

Use this skill to safely move the current repository onto `main` and update it from `origin`.

## Workflow

1. Preflight
- Run `git status --short`.
- If the working tree is not clean, stop and tell the user what is blocking the branch switch.
- Run `git rev-parse --abbrev-ref HEAD` and confirm the repo is not in detached HEAD state.

2. Switch branches
- If already on `main`, continue.
- Otherwise run `git checkout main`.

3. Update from origin
- Run `git pull origin main`.

4. Report
- Confirm the repository is now on `main`.
- Summarize whether `git pull` updated local commits or was already up to date.

## Notes

- Do not stash, reset, or discard local changes automatically.
- If `main` does not exist locally, stop and report the failure instead of guessing an alternative branch.
- If `git pull` reports conflicts or requires manual intervention, stop and show the reason.
