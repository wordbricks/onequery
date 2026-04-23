I’d replace the current **“always append a pre-filled GitHub issue URL”** behavior with a **report-on-demand diagnostic flow**.

In your repo, the root issue is in `apps/cli/crates/onequery-cli/src/output.rs`: `render_text_error()` always appends a huge pre-filled GitHub issue URL. `issue_report.rs` builds that URL by URL-encoding the full error trace and labeling it `bug,cli`, so it is both token-expensive and semantically wrong for normal user-actionable errors like auth, missing source, forbidden, invalid request, malformed JSON, and query rejection.

## Recommended flow

### 1. Default error output should be compact and actionable

For normal text mode, remove the GitHub URL entirely. Keep only the fields that help the user or agent recover:

```text
Error: Source Not Found
Why: no source named "warehouse" exists
Try:
  - onequery source list
Request ID: req_problem
```

For verbose/debug mode, show extra diagnostic fields:

```text
Error: Source Not Found
Command: onequery source show warehouse
Stage: resolve_source
Code: source_not_found
Why: no source named "warehouse" exists
Try:
  - onequery source list
Request ID: req_problem
```

This matches the CLI guideline principle that errors should act like documentation, but irrelevant output hurts signal-to-noise; debug-only information should not be printed by default. ([CLI Guidelines][1])

### 2. Treat JSON as the primary LLM-agent interface

Your CLI already does a good thing: it defaults to JSON when stdout is not a TTY. Keep that. The missing piece is that JSON errors currently **drop `try_next`**, even though `CliErrorData` already has it.

Add `tryNext` to `render_error(..., Json)`:

```json
{
  "ok": false,
  "command": "source show",
  "requestId": "req_problem",
  "error": {
    "code": "source_not_found",
    "title": "Source Not Found",
    "detail": "no source named \"warehouse\" exists",
    "stage": "resolve_source",
    "retryable": false,
    "tryNext": ["onequery source list"]
  }
}
```

That gives agents what they actually need: stable code, detail, retryability, and next action. No URL. No prose blob. No percent-encoded issue body. The CLI guidelines specifically recommend TTY-aware human output and JSON for structured machine-readable output. ([CLI Guidelines][1])

### 3. Only suggest reporting for reportable failures

Add a classifier. Do not decide reporting purely in the renderer. The renderer should ask: “is this error reportable?”

Recommended buckets:

| Bucket                   | Examples                                                                                                                                         | Default behavior                                  |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------- |
| User-actionable          | `not_logged_in`, `source_not_found`, `org_not_found`, `invalid_request`, `malformed_json`, `query_rejected`, `source_not_queryable`, `forbidden` | Show `Try`, no report hint                        |
| Transient/retryable      | timeout, unavailable, rate-limited, transport unavailable                                                                                        | Show retry guidance and `retryAfterMs`, no GitHub |
| Product/provider failure | `query_execution_failed`, `query_preparation_failed`, `source_api_execution_failed`, `source_api_describe_failed`, decode failures               | Show short report command                         |
| Internal CLI bug         | `Internal`, `Render`, invariant violations, unexpected decode details                                                                            | Show short report command                         |

For reportable text errors:

```text
Error: query failed
Why: failed to decode query response
Try:
  - retry onequery query exec --source warehouse --sql "select 1"
Request ID: req_decode

Report: onequery doctor report --last
```

For JSON:

```json
{
  "ok": false,
  "requestId": "req_decode",
  "command": "query exec",
  "error": {
    "code": "decode_error",
    "title": "query failed",
    "detail": "failed to decode query response",
    "stage": "execute_query",
    "retryable": false,
    "tryNext": [
      "retry onequery query exec --source warehouse --sql \"select 1\""
    ],
    "report": {
      "recommended": true,
      "command": "onequery doctor report --last --stdout",
      "reason": "unexpected_response_decode_failure"
    }
  }
}
```

For non-reportable errors, omit `report` entirely to save context.

### 4. Add an explicit diagnostics/report command

Instead of printing a giant issue URL, add a public command:

```bash
onequery doctor report --last
```

Suggested flags:

```bash
onequery doctor report --last
onequery doctor report --last --stdout
onequery doctor report --last --json
onequery doctor report --last --open
onequery doctor report --request-id req_123
```

Behavior:

```text
Created diagnostic report:
  ~/.cache/onequery/reports/onequery-report-2026-04-23T03-12-11Z-req_123.md

Review it before sharing.
```

JSON mode:

```json
{
  "ok": true,
  "data": {
    "reportPath": "~/.cache/onequery/reports/onequery-report-2026-04-23T03-12-11Z-req_123.md",
    "diagnosticsPath": "~/.cache/onequery/last-error.json",
    "githubCommand": "gh issue create -R wordbricks/onequery --label bug,cli --title \"[cli] decode_error\" --body-file ~/.cache/onequery/reports/onequery-report-2026-04-23T03-12-11Z-req_123.md"
  }
}
```

This is closer to `git bugreport`, which creates a separate bug-report file with environment and diagnostic context instead of injecting the full report into every error. ([Git SCM][2]) It also composes well with GitHub CLI, which supports creating issues from a body file or explicitly opening the browser via `--web`. ([GitHub CLI][3])

### 5. Save the last failure locally, redacted

On every failure, write a compact, redacted snapshot:

```json
{
  "schemaVersion": 1,
  "createdAt": "2026-04-23T03:12:11Z",
  "cliVersion": "0.0.0",
  "commandPath": "query exec",
  "commandLineSanitized": "onequery query exec --source warehouse --sql <redacted>",
  "exitCode": 6,
  "requestId": "req_123",
  "error": {
    "code": "decode_error",
    "stage": "execute_query",
    "title": "query failed",
    "detail": "failed to decode query response",
    "retryable": false,
    "retryAfterMs": null,
    "hint": null,
    "tryNext": ["retry onequery query exec ..."]
  },
  "reportability": {
    "recommended": true,
    "reason": "unexpected_response_decode_failure"
  },
  "environment": {
    "os": "darwin",
    "arch": "arm64"
  }
}
```

Important privacy rule: do **not** persist raw SQL, API tokens, headers, source credentials, full config, or request bodies by default. The old issue URL already included the command; the new flow should be safer than that.

### 6. Put the support path in help, not every error

Add this to top-level `onequery help`:

```text
Support:
  onequery doctor report --last     Create a redacted diagnostic report
  onequery explain <code>           Explain an error code
```

A top-level support path is a common CLI help pattern, while printing it on every error is noisy. ([CLI Guidelines][1])

### 7. Add `onequery explain <code>`

You already have stable problem codes from `proto/onequery/cli/v1/common.proto` and the server catalog in `packages/cli-server/src/domain/problems.ts`. Use those codes for compact diagnostics:

```bash
onequery explain source_not_found
onequery explain query_rejected
onequery explain source_api_execution_failed
```

Then default errors can stay short:

```text
Error: Query Rejected
Why: write queries are not allowed
Try:
  - use a read-only SELECT
Explain: onequery explain query_rejected
```

Rust’s compiler diagnostics are a good model here: compact error codes plus long-form explanations separately, instead of dumping the explanation inline every time. ([Rust Compiler Development Guide][4])

## Proto/server changes

Today `CliErrorDetail` has:

```proto
message CliErrorDetail {
  ProblemCode code = 1;
  ProblemStage stage = 2;
  string title = 3;
  string hint = 4;
  bool retryable = 5;
  string request_id = 6;
}
```

I’d add support metadata:

```proto
enum SupportActionKind {
  SUPPORT_ACTION_KIND_UNSPECIFIED = 0;
  SUPPORT_ACTION_KIND_NONE = 1;
  SUPPORT_ACTION_KIND_RETRY = 2;
  SUPPORT_ACTION_KIND_EXPLAIN = 3;
  SUPPORT_ACTION_KIND_REPORT_IF_REPRODUCIBLE = 4;
  SUPPORT_ACTION_KIND_REPORT_RECOMMENDED = 5;
}

message CliSupportAction {
  SupportActionKind kind = 1;
  string reason = 2;
  string explain_slug = 3;
}

message CliErrorDetail {
  ProblemCode code = 1;
  ProblemStage stage = 2;
  string title = 3;
  string hint = 4;
  bool retryable = 5;
  string request_id = 6;
  CliSupportAction support = 7;
}
```

Then extend `packages/cli-server/src/domain/problems.ts` entries:

```ts
SOURCE_NOT_FOUND: {
  ...
  support: {
    kind: "none",
    reason: "user_actionable",
    explainSlug: "source_not_found",
  },
}

QUERY_EXECUTION_TIMED_OUT: {
  ...
  support: {
    kind: "retry",
    reason: "transient",
    explainSlug: "query_execution_timed_out",
  },
}

SOURCE_API_EXECUTION_FAILED: {
  ...
  support: {
    kind: "report_if_reproducible",
    reason: "provider_execution_failure",
    explainSlug: "source_api_execution_failed",
  },
}
```

The CLI can also compute reportability locally for client-only errors such as `decode_error`, `transport_error`, `load_config`, `render`, and `internal`.

## Rust CLI changes

In `apps/cli/crates/onequery-cli/src/output.rs`:

1. Remove this unconditional block from `render_text_error()`:

```rust
lines.push(String::new());
lines.push("Think this is a bug? Report it with the error already filled in:".to_owned());
lines.push(format!("  {}", crate::issue_report::build_issue_url(error)));
```

2. Add `tryNext` to JSON error rendering:

```rust
if !error.try_next.is_empty() {
    error_body.insert(
        "tryNext".to_owned(),
        Value::Array(
            error
                .try_next
                .iter()
                .map(|step| Value::String(step.clone()))
                .collect(),
        ),
    );
}
```

3. Add a classifier:

```rust
fn should_suggest_report(error: &CliError) -> bool {
    if matches!(error.stage, ErrorStage::Internal | ErrorStage::Render) {
        return true;
    }

    if matches!(error.code.as_deref(), Some("decode_error")) {
        return true;
    }

    if error.status.is_some_and(|status| status >= 500) && !error.retryable {
        return true;
    }

    matches!(
        error.code.as_deref(),
        Some("query_execution_failed")
            | Some("query_preparation_failed")
            | Some("source_api_describe_failed")
            | Some("source_api_execution_failed")
            | Some("source_api_preparation_failed")
    )
}
```

4. For reportable text errors only, append a tiny command:

```rust
if should_suggest_report(error) {
    lines.push(String::new());
    lines.push("Report: onequery doctor report --last".to_owned());
}
```

5. For reportable JSON errors only, add:

```json
"report": {
  "recommended": true,
  "command": "onequery doctor report --last --stdout",
  "reason": "..."
}
```

## Migration plan

### Task status

- [x] Phase 1: quick UX fix
- [x] Phase 2: diagnostics command
- [x] Phase 3: proto-backed support metadata
- [x] Phase 4: explicit issue creation
- [x] Phase 5: explain command

**Phase 1: quick UX fix**

Remove the unconditional GitHub URL. Add `tryNext` to JSON. Add the report hint only for clearly reportable errors.

**Phase 2: diagnostics command**

Implement `onequery doctor report --last`, save redacted `last-error.json`, generate Markdown, and support `--stdout` / `--json`.

**Phase 3: proto-backed support metadata**

Add `CliSupportAction` to proto, classify server catalog entries, and let the CLI render based on server-provided support intent.

**Phase 4: explicit issue creation**

Keep GitHub issue creation explicit:

```bash
onequery doctor report --last --open
```

or print a `gh issue create --body-file ...` command. Never print the giant pre-filled URL in normal command results.

**Phase 5: explain command**

Add `onequery explain <code>` as a clap-native offline support surface, link known rendered
errors to it, and keep the shared problem-hint copy aligned with the current command tree.

The net effect: normal errors become smaller, agent-friendly JSON becomes more useful, bug reporting remains easy, and GitHub issue links only appear after an explicit diagnostic/report action.

[1]: https://clig.dev/ "Command Line Interface Guidelines"
[2]: https://git-scm.com/docs/git-bugreport "Git - git-bugreport Documentation"
[3]: https://cli.github.com/manual/gh_issue_create "GitHub CLI | Take GitHub to the command line"
[4]: https://rustc-dev-guide.rust-lang.org/diagnostics/error-codes.html "Error codes - Rust Compiler Development Guide"
