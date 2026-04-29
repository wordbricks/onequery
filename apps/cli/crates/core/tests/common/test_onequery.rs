use std::path::Path;
use std::path::PathBuf;
use std::process::Command;
use std::process::Output;

use tempfile::TempDir;

pub const LOOPBACK_BLACKHOLE_URL: &str = "http://127.0.0.1:9";
pub const TEST_ACCESS_TOKEN: &str = "test-access-token";

const PROXY_ENV_VARS: &[&str] = &[
    "ALL_PROXY",
    "all_proxy",
    "HTTP_PROXY",
    "http_proxy",
    "HTTPS_PROXY",
    "https_proxy",
    "NO_PROXY",
    "no_proxy",
];

pub struct TestOnequery {
    onequery_home: TempDir,
    onequery_bin: PathBuf,
}

impl TestOnequery {
    #[track_caller]
    pub fn new() -> Self {
        let onequery_home = tempfile::Builder::new()
            .prefix("onequery-test-home-")
            .tempdir()
            .unwrap_or_else(|error| {
                panic!("failed to create temporary ONEQUERY_HOME: {error}");
            });
        let onequery_bin = onequery_utils_cargo_bin::cargo_bin("onequery")
            .unwrap_or_else(|error| panic!("failed to resolve onequery binary: {error}"));

        Self {
            onequery_home,
            onequery_bin,
        }
    }

    pub fn home_path(&self) -> &Path {
        self.onequery_home.path()
    }

    pub fn command(&self) -> Command {
        let mut command = Command::new(&self.onequery_bin);
        command.env("ONEQUERY_HOME", self.home_path());
        remove_proxy_env(&mut command);
        command
    }
}

impl Default for TestOnequery {
    fn default() -> Self {
        Self::new()
    }
}

pub fn remove_proxy_env(command: &mut Command) {
    for key in PROXY_ENV_VARS {
        command.env_remove(*key);
    }
}

#[track_caller]
pub fn stdout_json(output: &Output) -> serde_json::Value {
    let stdout = String::from_utf8(output.stdout.clone())
        .unwrap_or_else(|error| panic!("stdout should be valid UTF-8: {error}"));
    serde_json::from_str::<serde_json::Value>(&stdout)
        .unwrap_or_else(|error| panic!("stdout should remain valid JSON: {error}\n{stdout}"))
}
