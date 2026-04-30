---
name: code-review-testing
description: Test authoring guidance
---

For behavior changes prefer integration tests over unit tests. Integration tests are colocated as `*.integration.test.ts` and use existing helpers near the touched code.

Features that change workflows, Connect services, routes, storage, or CLI behavior MUST add or update a test:
- Provide a list of major logic changes and user-facing behaviors that need to be tested.

If unit tests are needed, put them in a dedicated test file (`*.test.ts`; Rust CLI code uses `*_tests.rs`).
Avoid test-only functions in the main implementation.

Check whether there are existing helpers to make tests more streamlined and readable.
