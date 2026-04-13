use std::process::Command;

use pretty_assertions::assert_eq;

#[test]
fn api_json_stdout_stays_parseable_when_startup_refresh_fails() {
    let temp_dir = tempfile::tempdir().expect("failed to create tempdir");
    let output = Command::new(env!("CARGO_BIN_EXE_onequery"))
        .args([
            "--output",
            "json",
            "--timeout",
            "1",
            "--org",
            "acme",
            "api",
            "--source",
            "github",
        ])
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
        .expect("failed to run onequery binary");

    assert_eq!(output.status.success(), false);
    assert_eq!(
        String::from_utf8(output.stderr).expect("stderr should be valid UTF-8"),
        ""
    );

    let stdout = String::from_utf8(output.stdout).expect("stdout should be valid UTF-8");
    let stdout_json = serde_json::from_str::<serde_json::Value>(&stdout)
        .unwrap_or_else(|error| panic!("stdout should remain valid JSON: {error}\n{stdout}"));

    assert_eq!(stdout_json.is_object(), true);
}
