use std::process::Output;

use onequery_core_test_support::test_onequery::LOOPBACK_BLACKHOLE_URL;
use onequery_core_test_support::test_onequery::TEST_ACCESS_TOKEN;
use onequery_core_test_support::test_onequery::TestOnequery;
use onequery_core_test_support::test_onequery::stdout_json;
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
    let onequery = TestOnequery::new();
    let mut command = onequery.command();
    command.arg("--json");
    command.args(extra_args);
    command.args([
        "--timeout",
        "1",
        "--org",
        "acme",
        "api",
        "--source",
        "github://github",
    ]);
    command
        .env("ONEQUERY_ACCESS_TOKEN", TEST_ACCESS_TOKEN)
        .env("ONEQUERY_BASE_URL", LOOPBACK_BLACKHOLE_URL)
        .env("HTTPS_PROXY", LOOPBACK_BLACKHOLE_URL)
        .env("https_proxy", LOOPBACK_BLACKHOLE_URL)
        .output()
        .unwrap_or_else(|error| panic!("failed to run onequery binary: {error}"))
}
