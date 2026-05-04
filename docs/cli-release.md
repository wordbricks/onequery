# CLI Release

Release flow for the `onequery` CLI:

- Keep `apps/cli/package.json` at `0.0.0-dev`.
- Keep `apps/cli/Cargo.toml` and `apps/cli/Cargo.lock` at `0.0.0` on normal development commits.
- Only temporary `release/...` branches should change `apps/cli/Cargo.toml` and `apps/cli/Cargo.lock` to the real release version before tagging.
- Install `git-cliff` locally (or use `mise exec`) and generate the release changelog before tagging, for example `git cliff --config cliff.toml --tag "v0.1.0" > /tmp/cli-v0.1.0-notes.md`.
- Use the generated changelog as the tagged release commit message so the GitHub release notes match the changelog content published for that version.
- After the release is tagged, close or delete that temporary release branch/PR so `origin/main` stays at `0.0.0`.
- Configure npm trusted publishing for `@onequery/cli` with GitHub Actions using the workflow filename `cli-release.yml`.
- Push a tag like `cli-v0.1.0` or `cli-v0.1.0-alpha.1`.
- After pushing the release tag, stop and ask the user to report back when GitHub Actions finishes; do not babysit the run.
- The `cli-release` workflow validates `cli-v<version>` against `apps/cli/Cargo.toml`, builds the CLI binaries plus per-target self-host server executables, stages versioned npm tarballs plus stable per-platform installer bundles, creates a GitHub release from the tagged commit message, and publishes the versioned tarballs to npm with `npm publish --provenance`.
- Linux npm platform tarballs are staged from musl artifacts for the broadest runtime compatibility.
- Additional GNU Linux tarballs are attached to GitHub releases for direct download, but they are not published to npm.
- Windows npm tarballs are built on GitHub-hosted Windows runners and now include the bundled self-host runtime.
- Lint workflow changes locally with the repo-pinned tool version: `mise exec -- actionlint`.
main
## Version selection

- Stable releases increment the normal semver version, for example from `0.1.49` to `0.1.50`.
- Check npm dist-tags before choosing the next version: `npm view @onequery/cli dist-tags --json`.
- Prereleases keep the same base semver version and increment only the prerelease number while continuing that release line.
- If the latest CLI release is `0.1.50-alpha.1`, the next alpha release is `0.1.50-alpha.2`, not `0.1.51-alpha.1`.
- Start `0.1.51-alpha.1` only when beginning prereleases for the next base version after `0.1.50`.

## OpenClaw Plugin Release

Release flow for `@onequery/openclaw-plugin`:

- Keep `packages/openclaw-plugin/package.json` and `packages/openclaw-plugin/openclaw.plugin.json` on the same version.
- Push a tag like `openclaw-plugin-v0.1.0` or `openclaw-plugin-v0.1.0-alpha.1`.
- The `openclaw-plugin-release` workflow validates `openclaw-plugin-v<version>` against both metadata files, packs the plugin tarball with `npm pack`, creates a GitHub release from the tagged commit message, and publishes the tarball to npm.
- Prerelease tags publish to npm with the same channel mapping as the CLI flow: `alpha`, `beta`, or `next`.
- The published package is intended to satisfy OpenClaw's standard community plugin install path: `openclaw plugins install @onequery/openclaw-plugin`.

## Homebrew Tap Automation

The Homebrew release flow reuses the existing stable GitHub release tarballs instead
of building a second packaging format.

### Automated updates

- `.github/workflows/cli-homebrew-release.yml` runs after the CLI release workflow completes successfully.
- It resolves the matching `cli-v<version>` tag, downloads the stable macOS/Linux tarballs from the GitHub release, computes SHA-256 checksums, regenerates `Formula/onequery.rb`, validates the Ruby syntax, and pushes the formula update to the tap repo.
- The formula generator lives at `apps/cli/scripts/generate-homebrew-formula.js`.
- You can also backfill or retry a formula update manually with the workflow dispatch input `tag=cli-v<version>`.

### User install path

Once the tap repo is live, users can install directly with:

```bash
brew install wordbricks/tap/onequery
```
