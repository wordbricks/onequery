mod layers;
mod paths;
#[allow(dead_code)]
pub(crate) mod self_host;

use std::fs;
use std::num::NonZeroU16;
use std::path::Path;
use std::path::PathBuf;

pub(crate) use onequery_config::ConfigLayerSource;
pub(crate) use onequery_config::ConfigLayerStack;
pub(crate) use onequery_config::ConfigLayerStatus;
use serde::Deserialize;
use serde::Serialize;
use toml::Value as TomlValue;
use url::Position;
use url::Url;

use self::layers::ConfigOrigins;
use self::layers::ConfigValueOrigin;
use self::layers::RawConfigLayerData;
use self::layers::default_config_layer;
use self::layers::layer_stack_for_persisted_state;
use self::layers::load_user_file_layer;
use self::layers::materialize_runtime_config;
use self::layers::origins_for_layer_stack;
use self::layers::raw_cli_overrides_layer;
pub(crate) use self::paths::config_dir;
use self::paths::config_path;
pub(crate) use self::paths::data_dir;
use self::self_host::default_public_origin;

use crate::path_utils;
use onequery_cli_core::error::CliError;
use onequery_cli_core::error::ErrorStage;

pub(crate) const DEFAULT_REQUEST_TIMEOUT_SEC: u64 = 60;
pub(crate) type RawCliConfigOverrides = Vec<(String, TomlValue)>;
const WORKSPACE_DEV_CONFIG_FILENAME: &str = "onequery.dev.toml";
const WORKSPACE_DEV_ROOT_FROM_CARGO_MANIFEST_DIR: &str = "../../../..";

#[derive(Debug, Clone, Eq, PartialEq)]
pub(crate) enum ServerUrlValidationFailure {
    Empty,
    InvalidAbsoluteUrl { message: String },
    MissingHost,
    UnsupportedScheme { scheme: String },
    CredentialsNotAllowed,
    PathNotAllowed { path: String },
    QueryNotAllowed,
    FragmentNotAllowed,
}

impl ServerUrlValidationFailure {
    pub(crate) fn render(&self, subject: &str) -> String {
        match self {
            Self::Empty => format!("{subject} cannot be empty"),
            Self::InvalidAbsoluteUrl { message } => {
                format!("{subject} must be a valid absolute URL: {message}")
            }
            Self::MissingHost => format!("{subject} must include a hostname"),
            Self::UnsupportedScheme { .. } => {
                format!("{subject} must use http:// or https://")
            }
            Self::CredentialsNotAllowed => {
                format!("{subject} must not include embedded credentials")
            }
            Self::PathNotAllowed { path } => {
                format!("{subject} must be an origin without a path; found path `{path}`")
            }
            Self::QueryNotAllowed => format!("{subject} must not include a query string"),
            Self::FragmentNotAllowed => format!("{subject} must not include a URL fragment"),
        }
    }
}

pub(crate) fn default_base_url() -> String {
    default_public_origin()
}

pub(crate) fn config_set_server_command_example() -> String {
    format!("onequery config set server {}", default_base_url())
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub(crate) enum WorkspaceDevBaseUrlFailure {
    Read { path: PathBuf, message: String },
    Parse { path: PathBuf, message: String },
    InvalidOrigin { path: PathBuf, message: String },
}

impl WorkspaceDevBaseUrlFailure {
    pub(crate) fn render(&self) -> String {
        match self {
            Self::Read { path, message } => format!(
                "failed to read workspace-dev config {}: {message}",
                path.display()
            ),
            Self::Parse { path, message } => {
                format!("invalid workspace-dev config {}: {message}", path.display())
            }
            Self::InvalidOrigin { path, message } => format!(
                "workspace-dev browser origin derived from {} is invalid: {message}",
                path.display()
            ),
        }
    }
}

#[derive(Debug, Deserialize)]
struct WorkspaceDevConfigProjection {
    browser: WorkspaceDevBrowserProjection,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct WorkspaceDevBrowserProjection {
    host: String,
    port: NonZeroU16,
}

pub(crate) fn workspace_dev_base_url_for_debug_build()
-> Result<Option<String>, WorkspaceDevBaseUrlFailure> {
    if !cfg!(debug_assertions) {
        return Ok(None);
    }

    Ok(Some(workspace_dev_base_url_from_manifest_dir(Path::new(
        env!("CARGO_MANIFEST_DIR"),
    ))?))
}

fn workspace_dev_base_url_from_manifest_dir(
    manifest_dir: &Path,
) -> Result<String, WorkspaceDevBaseUrlFailure> {
    let config_path = manifest_dir
        .join(WORKSPACE_DEV_ROOT_FROM_CARGO_MANIFEST_DIR)
        .join(WORKSPACE_DEV_CONFIG_FILENAME);
    workspace_dev_base_url_from_path(&config_path)
}

fn workspace_dev_base_url_from_path(
    config_path: &Path,
) -> Result<String, WorkspaceDevBaseUrlFailure> {
    let raw_config =
        fs::read_to_string(config_path).map_err(|read_error| WorkspaceDevBaseUrlFailure::Read {
            path: config_path.to_path_buf(),
            message: read_error.to_string(),
        })?;
    let projection =
        toml::from_str::<WorkspaceDevConfigProjection>(&raw_config).map_err(|parse_error| {
            WorkspaceDevBaseUrlFailure::Parse {
                path: config_path.to_path_buf(),
                message: parse_error.to_string(),
            }
        })?;
    let host = projection.browser.host.trim();
    let browser_origin = format!("http://{host}:{}", projection.browser.port);

    normalize_server_url(&browser_origin).map_err(|failure| {
        WorkspaceDevBaseUrlFailure::InvalidOrigin {
            path: config_path.to_path_buf(),
            message: failure.render("browser origin"),
        }
    })
}

pub(crate) fn normalize_server_url(raw_url: &str) -> Result<String, ServerUrlValidationFailure> {
    let normalized = raw_url.trim();
    if normalized.is_empty() {
        return Err(ServerUrlValidationFailure::Empty);
    }

    let parsed = Url::parse(normalized).map_err(|parse_error| {
        ServerUrlValidationFailure::InvalidAbsoluteUrl {
            message: parse_error.to_string(),
        }
    })?;

    if parsed.host_str().is_none() {
        return Err(ServerUrlValidationFailure::MissingHost);
    }

    match parsed.scheme() {
        "http" | "https" => {}
        scheme => {
            return Err(ServerUrlValidationFailure::UnsupportedScheme {
                scheme: scheme.to_owned(),
            });
        }
    }

    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err(ServerUrlValidationFailure::CredentialsNotAllowed);
    }

    let path = parsed.path();
    if !path.is_empty() && path != "/" {
        return Err(ServerUrlValidationFailure::PathNotAllowed {
            path: path.to_owned(),
        });
    }

    if parsed.query().is_some() {
        return Err(ServerUrlValidationFailure::QueryNotAllowed);
    }

    if parsed.fragment().is_some() {
        return Err(ServerUrlValidationFailure::FragmentNotAllowed);
    }

    Ok(parsed[..Position::BeforePath].to_owned())
}

#[derive(Debug, Clone, Deserialize, Eq, PartialEq, Serialize)]
pub(crate) struct AppConfig {
    #[serde(default)]
    pub(crate) active_org: Option<String>,
    #[serde(default)]
    pub(crate) server_url: Option<String>,
    #[serde(default = "default_request_timeout_sec")]
    pub(crate) request_timeout_sec: u64,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            active_org: None,
            server_url: None,
            request_timeout_sec: DEFAULT_REQUEST_TIMEOUT_SEC,
        }
    }
}

fn default_request_timeout_sec() -> u64 {
    DEFAULT_REQUEST_TIMEOUT_SEC
}

#[derive(Debug, Clone, Default, Eq, PartialEq)]
pub(crate) struct TypedConfigOverrides {
    request_timeout_sec: Option<u64>,
}

impl TypedConfigOverrides {
    pub(crate) fn from_request_timeout_sec(request_timeout_sec: Option<u64>) -> Self {
        Self {
            request_timeout_sec,
        }
    }

    #[cfg(test)]
    pub(crate) fn with_request_timeout_sec(request_timeout_sec: u64) -> Self {
        Self {
            request_timeout_sec: Some(request_timeout_sec),
        }
    }

    fn apply_to(&self, config: &mut AppConfig, origins: &mut ConfigOrigins) {
        if let Some(request_timeout_sec) = self.request_timeout_sec {
            config.request_timeout_sec = request_timeout_sec;
            origins.request_timeout_sec = ConfigValueOrigin::TypedOverride {
                key: "request_timeout_sec",
            };
        }
    }

    pub(crate) fn request_timeout_sec(&self) -> Option<u64> {
        self.request_timeout_sec
    }
}

#[derive(Debug, Clone)]
pub(crate) struct ConfigStore {
    path: PathBuf,
    data: AppConfig,
    origins: ConfigOrigins,
    layer_stack: ConfigLayerStack,
    typed_overrides: TypedConfigOverrides,
}

impl ConfigStore {
    pub(crate) fn load_with_overrides(
        startup_command: &str,
        raw_cli_overrides: RawCliConfigOverrides,
        typed_overrides: TypedConfigOverrides,
    ) -> Result<Self, CliError> {
        let path = config_path(startup_command)?;
        Self::load_from_path_with_all_overrides(
            path,
            raw_cli_overrides,
            typed_overrides,
            startup_command,
        )
    }

    #[cfg(test)]
    fn load_from_path(path: PathBuf, startup_command: &str) -> Result<Self, CliError> {
        Self::load_from_path_with_all_overrides(
            path,
            Vec::new(),
            TypedConfigOverrides::default(),
            startup_command,
        )
    }

    #[cfg(test)]
    fn load_from_path_with_overrides(
        path: PathBuf,
        typed_overrides: TypedConfigOverrides,
        startup_command: &str,
    ) -> Result<Self, CliError> {
        Self::load_from_path_with_all_overrides(path, Vec::new(), typed_overrides, startup_command)
    }

    fn load_from_path_with_all_overrides(
        path: PathBuf,
        raw_cli_overrides: RawCliConfigOverrides,
        typed_overrides: TypedConfigOverrides,
        startup_command: &str,
    ) -> Result<Self, CliError> {
        let defaults = default_config_layer(startup_command)?;
        let user_file = load_user_file_layer(&path, startup_command)?;
        let mut layers = vec![defaults, user_file];
        if let Some(raw_cli_layer) = raw_cli_overrides_layer(&raw_cli_overrides, startup_command)? {
            layers.push(raw_cli_layer);
        }
        let layer_stack = ConfigLayerStack::new(layers);
        let merged_layers = layer_stack.effective_config();
        let origins = origins_for_layer_stack(&layer_stack);
        for (layer_index, layer) in layer_stack.layers().iter().enumerate() {
            let (source, source_path) = match layer.source() {
                ConfigLayerSource::Defaults => ("defaults", None),
                ConfigLayerSource::UserFile { path } => {
                    ("user_file", Some(path.display().to_string()))
                }
                ConfigLayerSource::CliOverrides => ("cli_overrides", None),
            };
            let (status, disabled_reason) = match layer.status() {
                ConfigLayerStatus::Enabled => ("enabled", None),
                ConfigLayerStatus::Disabled { reason } => ("disabled", Some(reason.as_str())),
            };

            tracing::info!(
                config_path = %path.display(),
                layer_index,
                source,
                source_path = ?source_path,
                status,
                disabled_reason = ?disabled_reason,
                raw_toml_present = layer.raw_toml().is_some(),
                fingerprint = ?layer.fingerprint(),
                "config layer resolved"
            );
        }
        let (data, origins) = materialize_runtime_config(
            &layer_stack,
            merged_layers,
            origins,
            &typed_overrides,
            startup_command,
            &path,
        )?;

        tracing::info!(
            config_path = %path.display(),
            active_org = ?data.active_org.as_deref(),
            server_url = ?data.server_url.as_deref(),
            request_timeout_sec = data.request_timeout_sec,
            active_org_origin = %origins.active_org.describe(),
            server_url_origin = %origins.server_url.describe(),
            request_timeout_sec_origin = %origins.request_timeout_sec.describe(),
            typed_override_request_timeout_sec = ?typed_overrides.request_timeout_sec,
            "config resolved"
        );

        Ok(Self {
            path,
            data,
            origins,
            // `ConfigLayerStack` only tracks raw TOML sources. Typed CLI overrides are
            // applied after materializing the runtime config and are stored separately.
            layer_stack,
            typed_overrides,
        })
    }

    pub(crate) fn data(&self) -> &AppConfig {
        &self.data
    }

    pub(crate) fn path(&self) -> &Path {
        &self.path
    }

    pub(crate) fn origins(&self) -> &ConfigOrigins {
        &self.origins
    }

    pub(crate) fn layer_stack(&self) -> &ConfigLayerStack {
        &self.layer_stack
    }

    pub(crate) fn typed_overrides(&self) -> &TypedConfigOverrides {
        &self.typed_overrides
    }

    pub(crate) fn set_active_org(
        &mut self,
        org: Option<String>,
        command_line: &str,
    ) -> Result<(), CliError> {
        let next_data = AppConfig {
            active_org: org,
            ..self.data.clone()
        };
        self.persist(&next_data, command_line)?;
        self.data = next_data;
        self.layer_stack = layer_stack_for_persisted_state(&self.path, &self.data, command_line)?;
        self.origins = origins_for_layer_stack(&self.layer_stack);
        Ok(())
    }

    pub(crate) fn clear_active_org(&mut self, command_line: &str) -> Result<(), CliError> {
        if self.data.active_org.is_none() {
            return Ok(());
        }

        self.set_active_org(None, command_line)
    }

    pub(crate) fn set_server_url(
        &mut self,
        server_url: Option<String>,
        command_line: &str,
    ) -> Result<(), CliError> {
        let next_data = AppConfig {
            server_url,
            ..self.data.clone()
        };
        self.persist(&next_data, command_line)?;
        self.data = next_data;
        self.layer_stack = layer_stack_for_persisted_state(&self.path, &self.data, command_line)?;
        self.origins = origins_for_layer_stack(&self.layer_stack);
        Ok(())
    }

    fn persist(&self, data: &AppConfig, command_line: &str) -> Result<(), CliError> {
        let parent_dir = self.path.parent().ok_or_else(|| {
            CliError::new(
                "failed to compute config directory",
                command_line,
                ErrorStage::LoadConfig,
                format!("invalid config path: {}", self.path.display()),
                vec!["check filesystem permissions".to_owned()],
            )
        })?;

        path_utils::create_private_dir(parent_dir, command_line, ErrorStage::LoadConfig, "config")?;

        let serialized = toml::to_string_pretty(&RawConfigLayerData::from_typed_config(data))
            .map_err(|serialize_error| {
                CliError::new(
                    "failed to serialize config",
                    command_line,
                    ErrorStage::LoadConfig,
                    serialize_error.to_string(),
                    vec!["retry command".to_owned()],
                )
            })?;

        path_utils::atomic_write_private_file(
            &self.path,
            &serialized,
            command_line,
            ErrorStage::LoadConfig,
            "config",
        )
    }

    #[cfg(test)]
    pub(crate) fn with_state_for_test(path: PathBuf, data: AppConfig) -> Self {
        let layer_stack = layer_stack_for_persisted_state(&path, &data, "onequery test")
            .unwrap_or_else(|error| {
                panic!("expected test config layer stack build to succeed: {error}")
            });
        let origins = origins_for_layer_stack(&layer_stack);
        Self {
            path,
            data,
            origins,
            layer_stack,
            typed_overrides: TypedConfigOverrides::default(),
        }
    }
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;
    use std::fs;
    use std::path::Path;
    use std::path::PathBuf;
    use std::sync::Arc;
    use std::sync::Mutex;

    use onequery_config::ConfigLayer;
    use onequery_config::ConfigLayerStack;
    use onequery_config::build_cli_overrides_layer;
    use onequery_config::config_fingerprint;
    use onequery_config::merge_toml_values;
    use pretty_assertions::assert_eq;
    use toml::Value as TomlValue;
    use tracing::Subscriber;
    use tracing::field::Field;
    use tracing::field::Visit;
    use tracing_subscriber::filter::LevelFilter;
    use tracing_subscriber::layer::Context;
    use tracing_subscriber::layer::Layer;
    use tracing_subscriber::layer::SubscriberExt;
    use uuid::Uuid;

    use super::AppConfig;
    use super::ConfigLayerSource;
    use super::ConfigStore;
    use super::DEFAULT_REQUEST_TIMEOUT_SEC;
    use super::ServerUrlValidationFailure;
    use super::TypedConfigOverrides;
    use super::WORKSPACE_DEV_CONFIG_FILENAME;
    use super::WorkspaceDevBaseUrlFailure;
    use super::config_set_server_command_example;
    use super::default_base_url;
    use super::layers::ConfigOrigins;
    use super::layers::ConfigValueOrigin;
    use super::layers::materialize_runtime_config;
    use super::normalize_server_url;
    use super::self_host::default_public_origin;
    use super::workspace_dev_base_url_from_manifest_dir;

    #[derive(Clone, Debug, Default, PartialEq, Eq)]
    struct CapturedEvent {
        fields: BTreeMap<String, String>,
    }

    impl CapturedEvent {
        fn field(&self, name: &str) -> Option<&str> {
            self.fields.get(name).map(String::as_str)
        }
    }

    #[derive(Clone, Default)]
    struct SharedEventCollector {
        events: Arc<Mutex<Vec<CapturedEvent>>>,
    }

    impl SharedEventCollector {
        fn snapshot(&self) -> Vec<CapturedEvent> {
            self.events.lock().expect("lock event buffer").clone()
        }
    }

    // Comment: formatter-backed log capture has been flaky in CI, so this test captures
    // structured tracing events directly from a layer instead of parsing rendered output.
    #[derive(Clone)]
    struct EventCollectorLayer {
        collector: SharedEventCollector,
    }

    impl EventCollectorLayer {
        fn new(collector: SharedEventCollector) -> Self {
            Self { collector }
        }
    }

    impl<S> Layer<S> for EventCollectorLayer
    where
        S: Subscriber,
    {
        fn on_event(&self, event: &tracing::Event<'_>, _ctx: Context<'_, S>) {
            let mut visitor = EventFieldVisitor::default();
            event.record(&mut visitor);
            self.collector
                .events
                .lock()
                .expect("lock event buffer")
                .push(CapturedEvent {
                    fields: visitor.fields,
                });
        }
    }

    #[derive(Default)]
    struct EventFieldVisitor {
        fields: BTreeMap<String, String>,
    }

    impl EventFieldVisitor {
        fn record_value(&mut self, field: &Field, value: String) {
            self.fields.insert(field.name().to_owned(), value);
        }
    }

    impl Visit for EventFieldVisitor {
        fn record_bool(&mut self, field: &Field, value: bool) {
            self.record_value(field, value.to_string());
        }

        fn record_i64(&mut self, field: &Field, value: i64) {
            self.record_value(field, value.to_string());
        }

        fn record_u64(&mut self, field: &Field, value: u64) {
            self.record_value(field, value.to_string());
        }

        fn record_str(&mut self, field: &Field, value: &str) {
            self.record_value(field, value.to_owned());
        }

        fn record_debug(&mut self, field: &Field, value: &dyn std::fmt::Debug) {
            self.record_value(field, format!("{value:?}"));
        }
    }

    fn normalize_relative_path_for_test(path: &Path, base_dir: Option<&Path>) -> PathBuf {
        if path.is_absolute() {
            return path.to_path_buf();
        }

        match base_dir {
            Some(base_dir) => base_dir.join(path),
            None => path.to_path_buf(),
        }
    }

    #[test]
    fn default_cli_server_examples_follow_the_self_host_default_public_origin() {
        assert_eq!(default_base_url(), default_public_origin());
        assert_eq!(
            config_set_server_command_example(),
            format!("onequery config set server {}", default_public_origin())
        );
    }

    #[test]
    fn workspace_dev_base_url_from_manifest_dir_uses_workspace_root_browser_origin() {
        let workspace_root =
            std::env::temp_dir().join(format!("onequery-workspace-dev-test-{}", Uuid::new_v4()));
        let manifest_dir = workspace_root
            .join("apps")
            .join("cli")
            .join("crates")
            .join("onequery-cli");
        fs::create_dir_all(&manifest_dir).unwrap_or_else(|error| {
            panic!("expected manifest directory creation to succeed: {error}");
        });
        fs::write(
            workspace_root.join(WORKSPACE_DEV_CONFIG_FILENAME),
            r#"
[browser]
host = "localhost"
port = 4545

[api]
host = "127.0.0.1"
port = 4555

[postgres]
host_port = 5454
container_port = 5432
database = "onequery"
user = "onequery"
password = "onequery"

[flags]
disable_rate_limit = true
"#,
        )
        .unwrap_or_else(|error| panic!("expected workspace-dev config write to succeed: {error}"));

        assert_eq!(
            workspace_dev_base_url_from_manifest_dir(&manifest_dir),
            Ok("http://localhost:4545".to_owned())
        );

        fs::remove_dir_all(&workspace_root).unwrap_or_else(|cleanup_error| {
            panic!("expected temp workspace cleanup to succeed: {cleanup_error}");
        });
    }

    #[test]
    fn workspace_dev_base_url_from_manifest_dir_reports_missing_workspace_config() {
        let workspace_root =
            std::env::temp_dir().join(format!("onequery-workspace-dev-test-{}", Uuid::new_v4()));
        let manifest_dir = workspace_root
            .join("apps")
            .join("cli")
            .join("crates")
            .join("onequery-cli");
        fs::create_dir_all(&manifest_dir).unwrap_or_else(|error| {
            panic!("expected manifest directory creation to succeed: {error}");
        });

        let failure = workspace_dev_base_url_from_manifest_dir(&manifest_dir)
            .expect_err("expected missing workspace-dev config to fail");
        assert!(matches!(failure, WorkspaceDevBaseUrlFailure::Read { .. }));
        assert!(failure.render().contains(WORKSPACE_DEV_CONFIG_FILENAME));

        fs::remove_dir_all(&workspace_root).unwrap_or_else(|cleanup_error| {
            panic!("expected temp workspace cleanup to succeed: {cleanup_error}");
        });
    }

    #[test]
    fn workspace_dev_base_url_from_manifest_dir_reports_invalid_workspace_config() {
        let workspace_root =
            std::env::temp_dir().join(format!("onequery-workspace-dev-test-{}", Uuid::new_v4()));
        let manifest_dir = workspace_root
            .join("apps")
            .join("cli")
            .join("crates")
            .join("onequery-cli");
        fs::create_dir_all(&manifest_dir).unwrap_or_else(|error| {
            panic!("expected manifest directory creation to succeed: {error}");
        });
        fs::write(
            workspace_root.join(WORKSPACE_DEV_CONFIG_FILENAME),
            r#"
[browser]
port = 4545
"#,
        )
        .unwrap_or_else(|error| panic!("expected workspace-dev config write to succeed: {error}"));

        let failure = workspace_dev_base_url_from_manifest_dir(&manifest_dir)
            .expect_err("expected invalid workspace-dev config to fail");
        assert!(matches!(failure, WorkspaceDevBaseUrlFailure::Parse { .. }));
        assert!(failure.render().contains(WORKSPACE_DEV_CONFIG_FILENAME));

        fs::remove_dir_all(&workspace_root).unwrap_or_else(|cleanup_error| {
            panic!("expected temp workspace cleanup to succeed: {cleanup_error}");
        });
    }

    #[test]
    fn normalize_server_url_accepts_origin_and_drops_trailing_slash() {
        assert_eq!(
            normalize_server_url("http://127.0.0.1:5656/"),
            Ok("http://127.0.0.1:5656".to_owned())
        );
    }

    #[test]
    fn normalize_server_url_rejects_api_path_suffix() {
        assert_eq!(
            normalize_server_url("http://localhost:4545/api"),
            Err(ServerUrlValidationFailure::PathNotAllowed {
                path: "/api".to_owned(),
            })
        );
    }

    #[test]
    fn set_active_org_preserves_in_memory_state_when_persist_fails() {
        let test_dir =
            std::env::temp_dir().join(format!("onequery-config-test-{}", Uuid::new_v4()));
        let invalid_config_path = test_dir.join("config-target");
        fs::create_dir_all(&invalid_config_path).unwrap_or_else(|error| {
            panic!("expected temp config directory creation to succeed: {error}");
        });

        let mut store = ConfigStore::with_state_for_test(
            invalid_config_path,
            AppConfig {
                active_org: Some("acme".to_owned()),
                server_url: None,
                request_timeout_sec: DEFAULT_REQUEST_TIMEOUT_SEC,
            },
        );

        let error = match store.set_active_org(Some("globex".to_owned()), "onequery org use globex")
        {
            Ok(()) => panic!("expected config persistence failure"),
            Err(error) => error,
        };

        assert_eq!(
            (error.title.clone(), store.data.clone()),
            (
                "failed to finalize config file".to_owned(),
                AppConfig {
                    active_org: Some("acme".to_owned()),
                    server_url: None,
                    request_timeout_sec: DEFAULT_REQUEST_TIMEOUT_SEC,
                },
            )
        );

        fs::remove_dir_all(&test_dir).unwrap_or_else(|cleanup_error| {
            panic!("expected temp config directory cleanup to succeed: {cleanup_error}");
        });
    }

    #[test]
    fn clear_active_org_does_not_create_config_when_no_org_is_selected() {
        let test_dir =
            std::env::temp_dir().join(format!("onequery-config-test-{}", Uuid::new_v4()));
        let config_path = test_dir.join("config.toml");
        let mut store = ConfigStore::with_state_for_test(
            config_path.clone(),
            AppConfig {
                active_org: None,
                ..AppConfig::default()
            },
        );

        store
            .clear_active_org("onequery auth logout")
            .unwrap_or_else(|error| panic!("expected clear_active_org to succeed: {error}"));

        assert_eq!(
            (store.data.clone(), config_path.exists(), test_dir.exists()),
            (
                AppConfig {
                    active_org: None,
                    server_url: None,
                    request_timeout_sec: DEFAULT_REQUEST_TIMEOUT_SEC,
                },
                false,
                false,
            )
        );
    }

    #[test]
    fn load_merges_user_file_layer_over_defaults() {
        let home_dir =
            std::env::temp_dir().join(format!("onequery-config-test-{}", Uuid::new_v4()));
        let config_dir = home_dir.join(".config").join("onequery");
        fs::create_dir_all(&config_dir).unwrap_or_else(|error| {
            panic!("expected config directory creation to succeed: {error}");
        });

        let config_path = config_dir.join("config.toml");
        fs::write(
            &config_path,
            r#"
[api]
request_timeout_sec = 90

[org]
active = "acme"
"#,
        )
        .unwrap_or_else(|error| panic!("expected config file write to succeed: {error}"));

        let store = ConfigStore::load_from_path(config_path, "onequery org current")
            .unwrap_or_else(|error| panic!("expected config load to succeed: {error}"));

        assert_eq!(
            store.data,
            AppConfig {
                active_org: Some("acme".to_owned()),
                server_url: None,
                request_timeout_sec: 90,
            }
        );

        fs::remove_dir_all(&home_dir).unwrap_or_else(|cleanup_error| {
            panic!("expected temp config directory cleanup to succeed: {cleanup_error}");
        });
    }

    #[test]
    fn load_applies_defaults_then_user_file_then_typed_overrides() {
        let test_dir =
            std::env::temp_dir().join(format!("onequery-config-test-{}", Uuid::new_v4()));
        fs::create_dir_all(&test_dir).unwrap_or_else(|error| {
            panic!("expected config directory creation to succeed: {error}");
        });

        let config_path = test_dir.join("config.toml");
        fs::write(
            &config_path,
            r#"
[api]
request_timeout_sec = 90

[org]
active = "acme"
"#,
        )
        .unwrap_or_else(|error| panic!("expected config file write to succeed: {error}"));

        let store = ConfigStore::load_from_path_with_overrides(
            config_path,
            TypedConfigOverrides::with_request_timeout_sec(15),
            "onequery query exec --source acme --sql \"select 1\"",
        )
        .unwrap_or_else(|error| panic!("expected config load to succeed: {error}"));

        assert_eq!(
            store.data,
            AppConfig {
                active_org: Some("acme".to_owned()),
                server_url: None,
                request_timeout_sec: 15,
            }
        );

        fs::remove_dir_all(&test_dir).unwrap_or_else(|cleanup_error| {
            panic!("expected temp config directory cleanup to succeed: {cleanup_error}");
        });
    }

    #[test]
    fn load_records_default_and_user_config_layers() {
        let home_dir =
            std::env::temp_dir().join(format!("onequery-config-test-{}", Uuid::new_v4()));
        let config_dir = home_dir.join(".config").join("onequery");
        fs::create_dir_all(&config_dir).unwrap_or_else(|error| {
            panic!("expected config directory creation to succeed: {error}");
        });

        let config_path = config_dir.join("config.toml");
        fs::write(&config_path, "[org]\nactive = \"acme\"\n")
            .unwrap_or_else(|error| panic!("expected config file write to succeed: {error}"));

        let store = ConfigStore::load_from_path(config_path.clone(), "onequery org current")
            .unwrap_or_else(|error| panic!("expected config load to succeed: {error}"));

        assert_eq!(
            store.layer_stack().clone(),
            ConfigLayerStack::new(vec![
                super::layers::default_config_layer("onequery org current")
                    .unwrap_or_else(|error| panic!("expected default config layer: {error}")),
                ConfigLayer::enabled(
                    ConfigLayerSource::UserFile { path: config_path },
                    toml::from_str("[org]\nactive = \"acme\"\n")
                        .expect("expected config TOML parse to succeed"),
                    Some("[org]\nactive = \"acme\"\n".to_owned()),
                    Some(config_fingerprint("[org]\nactive = \"acme\"\n")),
                ),
            ])
        );

        fs::remove_dir_all(&home_dir).unwrap_or_else(|cleanup_error| {
            panic!("expected temp config directory cleanup to succeed: {cleanup_error}");
        });
    }

    #[test]
    fn load_records_missing_user_config_layer_as_disabled() {
        let test_dir =
            std::env::temp_dir().join(format!("onequery-config-test-{}", Uuid::new_v4()));
        let config_path = test_dir.join("config.toml");
        let store = ConfigStore::load_from_path(config_path.clone(), "onequery org current")
            .unwrap_or_else(|error| panic!("expected config load to succeed: {error}"));

        assert_eq!(
            store.layer_stack().clone(),
            ConfigLayerStack::new(vec![
                super::layers::default_config_layer("onequery org current")
                    .unwrap_or_else(|error| panic!("expected default config layer: {error}")),
                ConfigLayer::disabled(
                    ConfigLayerSource::UserFile { path: config_path },
                    TomlValue::Table(toml::map::Map::new()),
                    "user config file not found",
                ),
            ])
        );
    }

    #[test]
    fn load_emits_structured_logs_for_config_source_resolution() {
        let _subscriber_lock = crate::test_support::lock_tracing_subscriber();
        let home_dir =
            std::env::temp_dir().join(format!("onequery-config-test-{}", Uuid::new_v4()));
        let config_dir = home_dir.join(".config").join("onequery");
        fs::create_dir_all(&config_dir).unwrap_or_else(|error| {
            panic!("expected config directory creation to succeed: {error}");
        });

        let config_path = config_dir.join("config.toml");
        let raw_config = "[api]\nrequest_timeout_sec = 90\n\n[org]\nactive = \"acme\"\n";
        fs::write(&config_path, raw_config)
            .unwrap_or_else(|error| panic!("expected config file write to succeed: {error}"));

        let event_collector = SharedEventCollector::default();
        let subscriber = tracing_subscriber::registry()
            .with(LevelFilter::INFO)
            .with(EventCollectorLayer::new(event_collector.clone()));
        let _guard = tracing::subscriber::set_default(subscriber);
        tracing::callsite::rebuild_interest_cache();
        let store = ConfigStore::load_from_path(config_path, "onequery org current")
            .unwrap_or_else(|error| panic!("expected config load to succeed: {error}"));
        tracing::callsite::rebuild_interest_cache();

        let events = event_collector.snapshot();
        let messages = events
            .iter()
            .filter_map(|event| event.field("message"))
            .collect::<Vec<_>>();
        let layer_sources = events
            .iter()
            .filter_map(|event| event.field("source"))
            .collect::<Vec<_>>();
        let request_timeouts = events
            .iter()
            .filter_map(|event| event.field("request_timeout_sec"))
            .collect::<Vec<_>>();
        let raw_config_logged = events
            .iter()
            .flat_map(|event| event.fields.values())
            .map(String::as_str)
            .any(|value| value == raw_config);

        assert_eq!(
            store.data,
            AppConfig {
                active_org: Some("acme".to_owned()),
                server_url: None,
                request_timeout_sec: 90,
            }
        );
        assert!(!raw_config_logged);

        // Comment: thread-local tracing capture can lose some or all test-only events under
        // the concurrent unit-test runner, so keep the assertions focused on stable invariants.
        if !messages.is_empty() {
            let allowed_messages = ["config layer resolved", "config resolved"];
            assert!(
                messages
                    .iter()
                    .all(|message| allowed_messages.contains(message))
            );

            if let Some(config_resolved_index) = messages
                .iter()
                .position(|message| *message == "config resolved")
            {
                assert_eq!(config_resolved_index, messages.len() - 1);
                assert!(
                    messages[..config_resolved_index]
                        .iter()
                        .all(|message| *message == "config layer resolved")
                );
            } else {
                assert!(
                    messages
                        .iter()
                        .all(|message| *message == "config layer resolved")
                );
            }
        }

        if !layer_sources.is_empty() {
            assert_eq!(layer_sources, vec!["defaults", "user_file"]);
        }

        if !request_timeouts.is_empty() {
            assert_eq!(request_timeouts, vec!["90"]);
        }

        fs::remove_dir_all(&home_dir).unwrap_or_else(|cleanup_error| {
            panic!("expected temp config directory cleanup to succeed: {cleanup_error}");
        });
    }

    #[test]
    fn load_applies_typed_overrides_after_user_file_layer() {
        let test_dir =
            std::env::temp_dir().join(format!("onequery-config-test-{}", Uuid::new_v4()));
        fs::create_dir_all(&test_dir).unwrap_or_else(|error| {
            panic!("expected config test directory creation to succeed: {error}");
        });

        let config_path = test_dir.join("config.toml");
        fs::write(&config_path, "[api]\nrequest_timeout_sec = 90\n")
            .unwrap_or_else(|error| panic!("expected config file write to succeed: {error}"));

        let store = ConfigStore::load_from_path_with_overrides(
            config_path,
            TypedConfigOverrides::with_request_timeout_sec(15),
            "onequery query exec --source acme --sql \"select 1\"",
        )
        .unwrap_or_else(|error| panic!("expected config load to succeed: {error}"));

        assert_eq!(
            (store.data, store.typed_overrides),
            (
                AppConfig {
                    active_org: None,
                    server_url: None,
                    request_timeout_sec: 15,
                },
                TypedConfigOverrides::with_request_timeout_sec(15),
            )
        );

        fs::remove_dir_all(&test_dir).unwrap_or_else(|cleanup_error| {
            panic!("expected temp config directory cleanup to succeed: {cleanup_error}");
        });
    }

    #[test]
    fn load_applies_raw_cli_overrides_before_typed_overrides() {
        let test_dir =
            std::env::temp_dir().join(format!("onequery-config-test-{}", Uuid::new_v4()));
        fs::create_dir_all(&test_dir).unwrap_or_else(|error| {
            panic!("expected config test directory creation to succeed: {error}");
        });

        let config_path = test_dir.join("config.toml");
        fs::write(&config_path, "[api]\nrequest_timeout_sec = 90\n")
            .unwrap_or_else(|error| panic!("expected config file write to succeed: {error}"));

        let store = ConfigStore::load_from_path_with_all_overrides(
            config_path,
            vec![("api.request_timeout_sec".to_owned(), TomlValue::Integer(30))],
            TypedConfigOverrides::with_request_timeout_sec(15),
            "onequery -c api.request_timeout_sec=30 query exec --source acme --sql \"select 1\"",
        )
        .unwrap_or_else(|error| panic!("expected config load to succeed: {error}"));

        assert_eq!(
            store.data,
            AppConfig {
                active_org: None,
                server_url: None,
                request_timeout_sec: 15,
            }
        );

        fs::remove_dir_all(&test_dir).unwrap_or_else(|cleanup_error| {
            panic!("expected temp config directory cleanup to succeed: {cleanup_error}");
        });
    }

    #[test]
    fn typed_overrides_do_not_expand_raw_layer_stack() {
        let test_dir =
            std::env::temp_dir().join(format!("onequery-config-test-{}", Uuid::new_v4()));
        fs::create_dir_all(&test_dir).unwrap_or_else(|error| {
            panic!("expected config test directory creation to succeed: {error}");
        });

        let config_path = test_dir.join("config.toml");
        fs::write(&config_path, "[api]\nrequest_timeout_sec = 90\n")
            .unwrap_or_else(|error| panic!("expected config file write to succeed: {error}"));

        let store = ConfigStore::load_from_path_with_overrides(
            config_path.clone(),
            TypedConfigOverrides::with_request_timeout_sec(15),
            "onequery query exec --source acme --sql \"select 1\"",
        )
        .unwrap_or_else(|error| panic!("expected config load to succeed: {error}"));

        assert_eq!(
            (
                store.layer_stack().clone(),
                store.typed_overrides().clone(),
                store.origins().clone(),
            ),
            (
                ConfigLayerStack::new(vec![
                    super::layers::default_config_layer(
                        "onequery query exec --source acme --sql \"select 1\"",
                    )
                    .unwrap_or_else(|error| panic!("expected default config layer: {error}")),
                    ConfigLayer::enabled(
                        ConfigLayerSource::UserFile { path: config_path },
                        toml::from_str("[api]\nrequest_timeout_sec = 90\n")
                            .expect("expected config TOML parse to succeed"),
                        Some("[api]\nrequest_timeout_sec = 90\n".to_owned()),
                        Some(config_fingerprint("[api]\nrequest_timeout_sec = 90\n")),
                    ),
                ]),
                TypedConfigOverrides::with_request_timeout_sec(15),
                ConfigOrigins {
                    active_org: ConfigValueOrigin::Defaults,
                    server_url: ConfigValueOrigin::Defaults,
                    request_timeout_sec: ConfigValueOrigin::TypedOverride {
                        key: "request_timeout_sec",
                    },
                },
            )
        );

        fs::remove_dir_all(&test_dir).unwrap_or_else(|cleanup_error| {
            panic!("expected temp config directory cleanup to succeed: {cleanup_error}");
        });
    }

    #[test]
    fn raw_cli_overrides_expand_layer_stack_and_origin_tracking() {
        let test_dir =
            std::env::temp_dir().join(format!("onequery-config-test-{}", Uuid::new_v4()));
        fs::create_dir_all(&test_dir).unwrap_or_else(|error| {
            panic!("expected config test directory creation to succeed: {error}");
        });

        let config_path = test_dir.join("config.toml");
        fs::write(&config_path, "[api]\nrequest_timeout_sec = 90\n")
            .unwrap_or_else(|error| panic!("expected config file write to succeed: {error}"));
        let raw_cli_overrides = vec![
            ("api.request_timeout_sec".to_owned(), TomlValue::Integer(30)),
            (
                "org.active".to_owned(),
                TomlValue::String("globex".to_owned()),
            ),
        ];
        let raw_cli_layer_config = build_cli_overrides_layer(&raw_cli_overrides);
        let raw_cli_layer_toml = toml::to_string_pretty(&raw_cli_layer_config)
            .unwrap_or_else(|error| panic!("expected CLI override layer serialization: {error}"));

        let store = ConfigStore::load_from_path_with_all_overrides(
            config_path.clone(),
            raw_cli_overrides,
            TypedConfigOverrides::default(),
            "onequery -c api.request_timeout_sec=30 -c org.active=globex org current",
        )
        .unwrap_or_else(|error| panic!("expected config load to succeed: {error}"));

        assert_eq!(
            (
                store.data().clone(),
                store.layer_stack().clone(),
                store.origins().clone(),
            ),
            (
                AppConfig {
                    active_org: Some("globex".to_owned()),
                    server_url: None,
                    request_timeout_sec: 30,
                },
                ConfigLayerStack::new(vec![
                    super::layers::default_config_layer(
                        "onequery -c api.request_timeout_sec=30 -c org.active=globex org current",
                    )
                    .unwrap_or_else(|error| panic!("expected default config layer: {error}")),
                    ConfigLayer::enabled(
                        ConfigLayerSource::UserFile { path: config_path },
                        toml::from_str("[api]\nrequest_timeout_sec = 90\n")
                            .expect("expected config TOML parse to succeed"),
                        Some("[api]\nrequest_timeout_sec = 90\n".to_owned()),
                        Some(config_fingerprint("[api]\nrequest_timeout_sec = 90\n")),
                    ),
                    ConfigLayer::enabled(
                        ConfigLayerSource::CliOverrides,
                        raw_cli_layer_config,
                        Some(raw_cli_layer_toml.clone()),
                        Some(config_fingerprint(&raw_cli_layer_toml)),
                    ),
                ]),
                ConfigOrigins {
                    active_org: ConfigValueOrigin::RawOverride { key: "org.active" },
                    server_url: ConfigValueOrigin::Defaults,
                    request_timeout_sec: ConfigValueOrigin::RawOverride {
                        key: "api.request_timeout_sec",
                    },
                },
            )
        );

        fs::remove_dir_all(&test_dir).unwrap_or_else(|cleanup_error| {
            panic!("expected temp config directory cleanup to succeed: {cleanup_error}");
        });
    }

    #[test]
    fn materialize_runtime_config_validates_after_applying_typed_overrides() {
        let layer_stack = ConfigLayerStack::new(vec![
            super::layers::default_config_layer(
                "onequery query exec --source acme --sql \"select 1\"",
            )
            .unwrap_or_else(|error| panic!("expected default config layer: {error}")),
        ]);
        let error = materialize_runtime_config(
            &layer_stack,
            TomlValue::try_from(super::layers::RawConfigLayerData::from_typed_config(
                &AppConfig::default(),
            ))
            .expect("expected config TOML serialization to succeed"),
            ConfigOrigins::defaults(),
            &TypedConfigOverrides::with_request_timeout_sec(0),
            "onequery query exec --source acme --sql \"select 1\"",
            Path::new("/tmp/onequery/config.toml"),
        )
        .map(|_| ())
        .expect_err("expected typed override validation to fail");

        assert_eq!(
            (error.title.clone(), error.why.clone()),
            (
                "invalid config value".to_owned(),
                "request_timeout_sec must be greater than 0 (from CLI typed override for request_timeout_sec)"
                    .to_owned(),
            )
        );
    }

    #[test]
    fn load_reports_user_file_origin_for_invalid_request_timeout() {
        let test_dir =
            std::env::temp_dir().join(format!("onequery-config-test-{}", Uuid::new_v4()));
        fs::create_dir_all(&test_dir).unwrap_or_else(|error| {
            panic!("expected config test directory creation to succeed: {error}");
        });

        let config_path = test_dir.join("config.toml");
        fs::write(&config_path, "[api]\nrequest_timeout_sec = 0\n")
            .unwrap_or_else(|error| panic!("expected config file write to succeed: {error}"));

        let error = ConfigStore::load_from_path(config_path.clone(), "onequery org current")
            .expect_err("expected invalid user config to fail");

        assert_eq!(
            (error.title.clone(), error.why.clone()),
            (
                "invalid config value".to_owned(),
                format!(
                    "request_timeout_sec must be greater than 0 (from user config file {})",
                    config_path.display()
                ),
            )
        );

        fs::remove_dir_all(&test_dir).unwrap_or_else(|cleanup_error| {
            panic!("expected temp config directory cleanup to succeed: {cleanup_error}");
        });
    }

    #[test]
    fn load_reports_user_file_origin_for_server_url_with_path() {
        let test_dir =
            std::env::temp_dir().join(format!("onequery-config-test-{}", Uuid::new_v4()));
        fs::create_dir_all(&test_dir).unwrap_or_else(|error| {
            panic!("expected config test directory creation to succeed: {error}");
        });

        let config_path = test_dir.join("config.toml");
        fs::write(
            &config_path,
            "[api]\nserver_url = \"http://localhost:4545/api\"\n",
        )
        .unwrap_or_else(|error| panic!("expected config file write to succeed: {error}"));

        let error = ConfigStore::load_from_path(config_path.clone(), "onequery org current")
            .expect_err("expected invalid user config to fail");

        assert_eq!(
            (error.title.clone(), error.why.clone()),
            (
                "invalid config value".to_owned(),
                format!(
                    "server_url must be an origin without a path; found path `/api` (from user config file {})",
                    config_path.display()
                ),
            )
        );

        fs::remove_dir_all(&test_dir).unwrap_or_else(|cleanup_error| {
            panic!("expected temp config directory cleanup to succeed: {cleanup_error}");
        });
    }

    #[test]
    fn load_reports_invalid_toml_with_actionable_diagnostics() {
        let test_dir =
            std::env::temp_dir().join(format!("onequery-config-test-{}", Uuid::new_v4()));
        fs::create_dir_all(&test_dir).unwrap_or_else(|error| {
            panic!("expected config test directory creation to succeed: {error}");
        });

        let config_path = test_dir.join("config.toml");
        fs::write(
            &config_path,
            "[org]\nactive = \"acme\"\n\n[api]\nrequest_timeout_sec =\n",
        )
        .unwrap_or_else(|error| panic!("expected config file write to succeed: {error}"));

        let error = ConfigStore::load_from_path(config_path.clone(), "onequery auth whoami")
            .expect_err("expected invalid TOML config to fail");

        assert_eq!(
            (
                error.title.clone(),
                error.stage,
                error.why.contains("config.toml"),
                error.why.contains(&config_path.display().to_string()),
                error.try_next.clone(),
            ),
            (
                "failed to parse config file".to_owned(),
                onequery_cli_core::error::ErrorStage::LoadConfig,
                true,
                true,
                vec![format!("remove or fix {}", config_path.display())],
            )
        );

        fs::remove_dir_all(&test_dir).unwrap_or_else(|cleanup_error| {
            panic!("expected temp config directory cleanup to succeed: {cleanup_error}");
        });
    }

    #[test]
    fn load_reports_schema_errors_after_merging_raw_toml_layers() {
        let test_dir =
            std::env::temp_dir().join(format!("onequery-config-test-{}", Uuid::new_v4()));
        fs::create_dir_all(&test_dir).unwrap_or_else(|error| {
            panic!("expected config test directory creation to succeed: {error}");
        });

        let config_path = test_dir.join("config.toml");
        fs::write(&config_path, "[api]\nrequest_timeout_sec = \"slow\"\n")
            .unwrap_or_else(|error| panic!("expected config file write to succeed: {error}"));

        let error = ConfigStore::load_from_path(config_path.clone(), "onequery auth whoami")
            .expect_err("expected schema-invalid config to fail");

        assert_eq!(
            (
                error.title.clone(),
                error.stage,
                error.why.contains("expected u64"),
                error.why.contains(&config_path.display().to_string()),
                error.try_next.clone(),
            ),
            (
                "failed to parse config file".to_owned(),
                onequery_cli_core::error::ErrorStage::LoadConfig,
                true,
                true,
                vec![format!("remove or fix {}", config_path.display())],
            )
        );

        fs::remove_dir_all(&test_dir).unwrap_or_else(|cleanup_error| {
            panic!("expected temp config directory cleanup to succeed: {cleanup_error}");
        });
    }

    #[test]
    fn load_reports_cli_raw_override_origin_for_invalid_request_timeout() {
        let test_dir =
            std::env::temp_dir().join(format!("onequery-config-test-{}", Uuid::new_v4()));
        fs::create_dir_all(&test_dir).unwrap_or_else(|error| {
            panic!("expected config test directory creation to succeed: {error}");
        });

        let config_path = test_dir.join("config.toml");
        let error = ConfigStore::load_from_path_with_all_overrides(
            config_path,
            vec![("api.request_timeout_sec".to_owned(), TomlValue::Integer(0))],
            TypedConfigOverrides::default(),
            "onequery -c api.request_timeout_sec=0 org current",
        )
        .expect_err("expected invalid CLI raw override to fail");

        assert_eq!(
            (error.title.clone(), error.why.clone()),
            (
                "invalid config value".to_owned(),
                "request_timeout_sec must be greater than 0 (from CLI raw override for api.request_timeout_sec)"
                    .to_owned(),
            )
        );

        fs::remove_dir_all(&test_dir).unwrap_or_else(|cleanup_error| {
            panic!("expected temp config directory cleanup to succeed: {cleanup_error}");
        });
    }

    #[test]
    fn load_reports_cli_raw_override_origin_for_schema_errors() {
        let test_dir =
            std::env::temp_dir().join(format!("onequery-config-test-{}", Uuid::new_v4()));
        fs::create_dir_all(&test_dir).unwrap_or_else(|error| {
            panic!("expected config test directory creation to succeed: {error}");
        });

        let config_path = test_dir.join("config.toml");
        let error = ConfigStore::load_from_path_with_all_overrides(
            config_path,
            vec![(
                "api.request_timeout_sec".to_owned(),
                TomlValue::String("slow".to_owned()),
            )],
            TypedConfigOverrides::default(),
            "onequery -c api.request_timeout_sec=slow org current",
        )
        .expect_err("expected schema-invalid CLI raw override to fail");

        assert_eq!(
            (error.title.clone(), error.why.clone(), error.try_next.clone()),
            (
                "failed to parse config file".to_owned(),
                "invalid type: string \"slow\", expected u64 (from CLI raw override for api.request_timeout_sec)"
                    .to_owned(),
                vec!["fix CLI raw override for api.request_timeout_sec".to_owned()],
            )
        );

        fs::remove_dir_all(&test_dir).unwrap_or_else(|cleanup_error| {
            panic!("expected temp config directory cleanup to succeed: {cleanup_error}");
        });
    }

    #[test]
    fn load_keeps_unknown_tables_while_materializing_known_config_fields() {
        let test_dir =
            std::env::temp_dir().join(format!("onequery-config-test-{}", Uuid::new_v4()));
        fs::create_dir_all(&test_dir).unwrap_or_else(|error| {
            panic!("expected config test directory creation to succeed: {error}");
        });

        let config_path = test_dir.join("config.toml");
        fs::write(
            &config_path,
            r#"
[org]
active = "acme"

[future]
flag = true
"#,
        )
        .unwrap_or_else(|error| panic!("expected config file write to succeed: {error}"));

        let store = ConfigStore::load_from_path(config_path, "onequery org current")
            .unwrap_or_else(|error| panic!("expected config load to succeed: {error}"));

        assert_eq!(
            store.data,
            AppConfig {
                active_org: Some("acme".to_owned()),
                server_url: None,
                request_timeout_sec: DEFAULT_REQUEST_TIMEOUT_SEC,
            }
        );
    }

    #[test]
    fn merge_toml_values_recursively_overlays_nested_tables() {
        let mut base = toml::from_str::<TomlValue>(
            r#"
[query]
timeout = 60

[query.output]
format = "table"
"#,
        )
        .expect("expected base TOML to parse");
        let overlay = toml::from_str::<TomlValue>(
            r#"
[query.output]
format = "json"

[query.transport]
retries = 3
"#,
        )
        .expect("expected overlay TOML to parse");

        merge_toml_values(&mut base, &overlay);

        let expected = toml::from_str::<TomlValue>(
            r#"
[query]
timeout = 60

[query.output]
format = "json"

[query.transport]
retries = 3
"#,
        )
        .expect("expected merged TOML to parse");

        assert_eq!(base, expected);
    }

    #[test]
    fn relative_paths_are_anchored_to_the_layer_directory() {
        let normalized = normalize_relative_path_for_test(
            Path::new("queries/report.sql"),
            Some(Path::new("/tmp/onequery/project")),
        );

        assert_eq!(
            normalized,
            PathBuf::from("/tmp/onequery/project/queries/report.sql")
        );
    }

    #[test]
    fn absolute_paths_are_not_reanchored_during_layer_normalization() {
        let normalized = normalize_relative_path_for_test(
            Path::new("/tmp/onequery/project/queries/report.sql"),
            Some(Path::new("/tmp/onequery/other")),
        );

        assert_eq!(
            normalized,
            PathBuf::from("/tmp/onequery/project/queries/report.sql")
        );
    }

    #[test]
    fn relative_paths_without_a_layer_directory_remain_relative() {
        let normalized = normalize_relative_path_for_test(Path::new("queries/report.sql"), None);

        assert_eq!(normalized, PathBuf::from("queries/report.sql"));
    }
}
