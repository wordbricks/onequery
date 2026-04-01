# CLI Release

Release flow for the `onequery` CLI:

- Keep `apps/cli/package.json` at `0.0.0-dev`.
- Keep `apps/cli/Cargo.toml` and `apps/cli/Cargo.lock` at `0.0.0` on normal development commits.
- Only temporary `release/...` branches should change `apps/cli/Cargo.toml` and `apps/cli/Cargo.lock` to the real release version before tagging.
- Install `git-cliff` locally and generate the release changelog before tagging, for example `git cliff --config cliff.toml --tag "v0.1.0" > /tmp/cli-v0.1.0-notes.md`.
- Use the generated changelog as the tagged release commit message so the GitHub release notes match the changelog content published for that version.
- After the release is tagged, close or delete that temporary release branch/PR so `origin/main` stays at `0.0.0`.
- Configure npm trusted publishing for `@onequery/cli` with GitHub Actions using the workflow filename `cli-release.yml`.
- Push a tag like `cli-v0.1.0` or `cli-v0.1.0-alpha.1`.
- The `cli-release` workflow validates `cli-v<version>` against `apps/cli/Cargo.toml`, builds the CLI binaries plus per-target self-host server executables, stages versioned npm tarballs plus stable installer asset names, creates a GitHub release from the tagged commit message, and publishes the versioned tarballs to npm with `npm publish --provenance`.
- Linux npm platform tarballs are staged from musl artifacts for the broadest runtime compatibility.
- Additional GNU Linux tarballs are attached to GitHub releases for direct download, but they are not published to npm.
- Windows npm tarballs are built on GitHub-hosted Windows runners and now include the bundled self-host runtime.
