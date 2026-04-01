# Workstream G — Delete dead knobs and compatibility shims

### Goal

Remove config/options that create surface area without carrying real meaning.

### TODO

- [ ] Delete `server.log_level` from self-host config unless it is wired all the way through to actual runtime logging behavior.
- [ ] Remove any serve/status JSON that only reflects dead config.
- [ ] Remove the legacy unsupported-test cleanup shim in `packages/server/src/routes/data-sources/crud.ts` (`LEGACY_UNSUPPORTED_TEST_PREFIX`) since backward compatibility is explicitly not needed here.
- [ ] Delete any stale comments/docs that still describe the old compatibility assumptions.

### Acceptance

- [ ] Every remaining config field changes real behavior.
- [ ] Route code no longer includes one-off migration cleanup for legacy states that we no longer support.
