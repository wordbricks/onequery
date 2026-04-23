use std::process::Command;
use std::process::Output;

use pretty_assertions::assert_eq;

#[test]
fn api_json_stdout_stays_parseable_when_startup_refresh_fails() {
    let output = run_api_json_with_startup_refresh_failure(&[]);
    let stderr = String::from_utf8(output.stderr.clone())
        .unwrap_or_else(|error| panic!("stderr should be valid UTF-8: {error}"));

    assert_eq!(output.status.success(), false);
    assert_eq!(stderr, "");

    assert_eq!(stdout_json(&output).is_object(), true);
}

#[test]
fn api_json_stdout_stays_parseable_when_verbose_startup_failure_is_logged() {
    let output = run_api_json_with_startup_refresh_failure(&["--verbose"]);
    let stderr = String::from_utf8(output.stderr.clone())
        .unwrap_or_else(|error| panic!("stderr should be valid UTF-8: {error}"));

    assert_eq!(output.status.success(), false);
    assert_eq!(stderr.contains("startup advisory effect failed"), true);
    assert_eq!(stdout_json(&output).is_object(), true);
    assert_eq!(
        String::from_utf8(output.stdout)
            .unwrap_or_else(|error| panic!("stdout should be valid UTF-8: {error}"))
            .contains("startup advisory effect failed"),
        false
    );
}

fn run_api_json_with_startup_refresh_failure(extra_args: &[&str]) -> Output {
    let temp_dir =
        tempfile::tempdir().unwrap_or_else(|error| panic!("failed to create tempdir: {error}"));
    let mut command = Command::new(env!("CARGO_BIN_EXE_onequery"));
    command.arg("--json");
    command.args(extra_args);
    command.args([
        "--timeout",
        "1",
        "--org",
        "acme",
        "api",
        "--source",
        "github",
    ]);
    command
        .env("ONEQUERY_HOME", temp_dir.path())
        .env("ONEQUERY_ACCESS_TOKEN", "test-access-token")
        .env("ONEQUERY_BASE_URL", "http://127.0.0.1:9")
        .env_remove("ALL_PROXY")
        .env_remove("all_proxy")
        .env_remove("HTTP_PROXY")
        .env_remove("http_proxy")
        .env_remove("NO_PROXY")
        .env_remove("no_proxy")
        .env("HTTPS_PROXY", "http://127.0.0.1:9")
        .env("https_proxy", "http://127.0.0.1:9")
        .output()
        .unwrap_or_else(|error| panic!("failed to run onequery binary: {error}"))
}

fn stdout_json(output: &Output) -> serde_json::Value {
    let stdout = String::from_utf8(output.stdout.clone())
        .unwrap_or_else(|error| panic!("stdout should be valid UTF-8: {error}"));
    serde_json::from_str::<serde_json::Value>(&stdout)
        .unwrap_or_else(|error| panic!("stdout should remain valid JSON: {error}\n{stdout}"))
}
