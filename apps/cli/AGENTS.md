# Rust/onequery-rs

In the Rust workspace where the rust code lives:

- Crate names are prefixed with `onequery-`. For example, the `core` folder's crate is named `onequery-core`.
- When using `format!` and you can inline variables into `{}`, always do that.
- Install any commands the repo relies on (for example `just`, `rg`, or `cargo-insta`) if they are not already available before running instructions here.
- Always collapse if statements per https://rust-lang.github.io/rust-clippy/master/index.html#collapsible_if
- Always inline `format!` args when possible per https://rust-lang.github.io/rust-clippy/master/index.html#uninlined_format_args
- Use method references over closures when possible per https://rust-lang.github.io/rust-clippy/master/index.html#redundant_closure_for_method_calls
- Avoid bool or ambiguous `Option` parameters that force callers to write hard-to-read code such as `foo(false)` or `bar(None)`. Prefer enums, named methods, newtypes, or other idiomatic Rust API shapes when they keep the callsite self-documenting.
- When you cannot make that API change and still need a small positional-literal callsite in Rust, follow the `argument_comment_lint` convention:
  - Use an exact `/*param_name*/` comment before opaque literal arguments such as `None`, booleans, and numeric literals when passing them by position.
  - Do not add these comments for string or char literals unless the comment adds real clarity; those literals are intentionally exempt from the lint.
  - If you add one of these comments, the parameter name must exactly match the callee signature.
- When possible, make `match` statements exhaustive and avoid wildcard arms.
- When writing tests, prefer comparing the equality of entire objects over fields one by one.
- When making a change that adds or changes an API, ensure that the documentation in the `docs/` folder is up to date if applicable.
- If you change config types or other generated schemas or fixtures, regenerate the generated files if the repo maintains them.
- If you change Rust dependencies (`Cargo.toml` or `Cargo.lock`), update any repo-managed lockfiles or generated metadata that track dependency state, and include those updates in the same change.
- Do not create small helper methods that are referenced only once.
- Avoid large modules:
  - Prefer adding new modules instead of growing existing ones.
  - Target Rust modules under 500 LoC, excluding tests.
  - If a file exceeds roughly 800 LoC, add new functionality in a new module instead of extending
    the existing file unless there is a strong documented reason not to.
  - When extracting code from a large module, move the related tests and module/type docs toward
    the new implementation so the invariants stay close to the code that owns them.
- Edit API server code in this monorepo directly when changes needed.

Run `just fmt` automatically after you have finished making Rust code changes; do not ask for approval to run it. Additionally, run the tests:

1. Run the test for the specific project that was changed. For example, if changes were made in `crates/onequery-cli`, run `cargo test -p onequery-cli`.
2. Once those pass, if any changes were made in common, core, or protocol, run the complete test suite with `cargo test` (or `just test` if `cargo-nextest` is installed). Avoid `--all-features` for routine local runs because it expands the build matrix and can significantly increase `target/` disk usage; use it only when you specifically need full feature coverage. project-specific or individual tests can be run without asking the user, but do ask the user before running the complete test suite.

Before finalizing a large change, run `just fix -p <project>` to fix any linter issues in the code. Prefer scoping with `-p` to avoid slow workspace‑wide Clippy builds; only run `just fix` without `-p` if you changed shared crates. Do not re-run tests after running `fix` or `fmt`.

### CLI API workflow

1. Modify the canonical protobuf contract in `proto/onequery/cli/v1/*.proto` and the Buf config files if the generation surface changes.
2. Regenerate the generated transport artifacts from `apps/cli`: `just regen-proto`.
3. Verify generated artifacts are current: `just check-proto`.
4. If contract changes, update `crates/onequery-cli/src/transport/*` to match and run Rust fmt/tests.

## Tests

### Snapshot tests

This repo may use snapshot tests (via `insta`) to validate user-visible output.

**Requirement:** any change that affects user-visible output must include corresponding `insta` snapshot coverage. Add a new snapshot test if one does not exist yet, or update the existing snapshot. Review and accept snapshot updates as part of the change so output diffs stay easy to review.

When output changes intentionally, update the snapshots as follows:

- Run tests to generate any updated snapshots for the affected crate:
  - `cargo test -p <crate>`
- Check what is pending:
  - `cargo insta pending-snapshots`
- Review changes by reading the generated `*.snap.new` files directly in the repo, or preview a specific file:
  - `cargo insta show path/to/file.snap.new`
- Only if you intend to accept all new snapshots in this crate, run:
  - `cargo insta accept>`

If you do not have the tool:

- `cargo install cargo-insta`

### Test assertions

- Tests should use `pretty_assertions::assert_eq` for clearer diffs. Import this at the top of the test module if it isn't already.
- Prefer deep equals comparisons whenever possible. Perform `assert_eq!()` on entire objects, rather than individual fields.
- Avoid mutating process environment in tests; prefer passing environment-derived flags or dependencies from above.
