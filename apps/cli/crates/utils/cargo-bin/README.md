# onequery-utils-cargo-bin strategy

This crate follows the Codex `cargo-bin` helper shape for integration tests
that spawn OneQuery workspace binaries or need paths to test resources.

OneQuery currently uses Cargo-only resolution. The helper keeps binary and
resource path lookup behind one explicit boundary so Windows path handling stays
centralized, especially if future test runners produce long or indirect paths.

Function behavior:
- `cargo_bin`: reads `CARGO_BIN_EXE_*` environment variables and falls back to
  `assert_cmd::Command::cargo_bin` when Cargo has not exported one.
- `find_resource!`: resolves resources relative to the caller crate's
  `CARGO_MANIFEST_DIR`.
- `repo_root`: resolves the source checkout root from this crate's
  `repo_root.marker`.
