use std::fs;
use std::path::Path;
use std::path::PathBuf;

use onequery_config::ConfigLayer;
use onequery_config::ConfigLayerSource;
use onequery_config::ConfigLayerStack;
use onequery_config::TypedTomlDeserializationError;
use onequery_config::build_cli_overrides_layer;
use onequery_config::config_error_from_toml;
use onequery_config::config_fingerprint;
use onequery_config::deserialize_typed_toml;
use onequery_config::format_config_error;
use onequery_core::error::CliError;
use onequery_core::error::ErrorStage;
use serde::Deserialize;
use serde::Serialize;
use toml::Value as TomlValue;

use super::AppConfig;
use super::DEFAULT_REQUEST_TIMEOUT_SEC;
use super::RawCliConfigOverrides;
use super::TypedConfigOverrides;

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(default)]
pub(super) struct RawConfigLayerData {
    #[serde(default, skip_serializing_if = "ApiConfigSection::is_empty")]
    api: ApiConfigSection,
    #[serde(default, skip_serializing_if = "OrgConfigSection::is_empty")]
    org: OrgConfigSection,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(default)]
struct ApiConfigSection {
    server_url: Option<String>,
    request_timeout_sec: Option<u64>,
}

impl ApiConfigSection {
    fn is_empty(&self) -> bool {
        self.server_url.is_none() && self.request_timeout_sec.is_none()
    }
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(default)]
struct OrgConfigSection {
    active: Option<String>,
}

impl OrgConfigSection {
    fn is_empty(&self) -> bool {
        self.active.is_none()
    }
}

impl RawConfigLayerData {
    pub(super) fn from_typed_config(config: &AppConfig) -> Self {
        Self {
            api: ApiConfigSection {
                server_url: config.server_url.clone(),
                request_timeout_sec: Some(config.request_timeout_sec),
            },
            org: OrgConfigSection {
                active: config.active_org.clone(),
            },
        }
    }

    fn into_app_config(self) -> AppConfig {
        AppConfig {
            active_org: self.org.active,
            server_url: self.api.server_url,
            request_timeout_sec: self
                .api
                .request_timeout_sec
                .unwrap_or(DEFAULT_REQUEST_TIMEOUT_SEC),
        }
    }
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub(crate) enum ConfigValueOrigin {
    Defaults,
    UserFile { path: PathBuf },
    RawOverride { key: &'static str },
    TypedOverride { key: &'static str },
}

impl ConfigValueOrigin {
    fn from_layer_source(source: &ConfigLayerSource, key: &'static str) -> Self {
        match source {
            ConfigLayerSource::Defaults => Self::Defaults,
            ConfigLayerSource::UserFile { path } => Self::UserFile { path: path.clone() },
            ConfigLayerSource::CliOverrides => Self::RawOverride { key },
        }
    }

    pub(crate) fn describe(&self) -> String {
        match self {
            Self::Defaults => "built-in defaults".to_owned(),
            Self::UserFile { path } => format!("user config file {}", path.display()),
            Self::RawOverride { key } => format!("CLI raw override for {key}"),
            Self::TypedOverride { key } => format!("CLI typed override for {key}"),
        }
    }
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub(crate) struct ConfigOrigins {
    pub(super) active_org: ConfigValueOrigin,
    pub(super) server_url: ConfigValueOrigin,
    pub(super) request_timeout_sec: ConfigValueOrigin,
}

impl ConfigOrigins {
    #[cfg(test)]
    pub(super) fn defaults() -> Self {
        Self {
            active_org: ConfigValueOrigin::Defaults,
            server_url: ConfigValueOrigin::Defaults,
            request_timeout_sec: ConfigValueOrigin::Defaults,
        }
    }

    pub(crate) fn active_org(&self) -> &ConfigValueOrigin {
        &self.active_org
    }

    pub(crate) fn request_timeout_sec(&self) -> &ConfigValueOrigin {
        &self.request_timeout_sec
    }

    pub(crate) fn server_url(&self) -> &ConfigValueOrigin {
        &self.server_url
    }
}

pub(super) fn default_config_layer(startup_command: &str) -> Result<ConfigLayer, CliError> {
    let source = ConfigLayerSource::Defaults;
    let data = RawConfigLayerData::from_typed_config(&AppConfig::default());
    let config = raw_config_layer_toml_value(&data, &source, startup_command)?;
    let raw_toml = serialize_toml_value(&config, startup_command)?;
    Ok(ConfigLayer::enabled(
        source,
        config,
        Some(raw_toml.clone()),
        Some(config_fingerprint(&raw_toml)),
    ))
}

pub(super) fn load_user_file_layer(
    path: &PathBuf,
    startup_command: &str,
) -> Result<ConfigLayer, CliError> {
    let source = ConfigLayerSource::UserFile { path: path.clone() };

    if !path.exists() {
        return Ok(ConfigLayer::disabled(
            source,
            empty_config_table(),
            "user config file not found",
        ));
    }

    let raw = fs::read_to_string(path).map_err(|read_error| {
        CliError::new(
            "failed to read config file",
            startup_command,
            ErrorStage::LoadConfig,
            format!("{read_error} ({})", path.display()),
            vec!["onequery auth login".to_owned()],
        )
    })?;

    let config = toml::from_str::<TomlValue>(&raw)
        .map_err(|parse_error| {
            let config_error = config_error_from_toml(path, &raw, parse_error);
            CliError::new(
                "failed to parse config file",
                startup_command,
                ErrorStage::LoadConfig,
                format_config_error(&config_error, &raw),
                vec![format!("remove or fix {}", path.display())],
            )
        })
        .map(|config| normalize_toml_value_for_layer_source(config, &source))?;

    Ok(ConfigLayer::enabled(
        source,
        config,
        Some(raw.clone()),
        Some(config_fingerprint(&raw)),
    ))
}

pub(super) fn raw_cli_overrides_layer(
    raw_cli_overrides: &RawCliConfigOverrides,
    startup_command: &str,
) -> Result<Option<ConfigLayer>, CliError> {
    if raw_cli_overrides.is_empty() {
        return Ok(None);
    }

    let source = ConfigLayerSource::CliOverrides;
    let config = build_cli_overrides_layer(raw_cli_overrides);
    let raw_toml = serialize_toml_value(&config, startup_command)?;

    Ok(Some(ConfigLayer::enabled(
        source,
        config,
        Some(raw_toml.clone()),
        Some(config_fingerprint(&raw_toml)),
    )))
}

pub(super) fn materialize_runtime_config(
    layer_stack: &ConfigLayerStack,
    merged_layers: TomlValue,
    mut origins: ConfigOrigins,
    typed_overrides: &TypedConfigOverrides,
    startup_command: &str,
    config_path: &Path,
) -> Result<(AppConfig, ConfigOrigins), CliError> {
    let merged_raw_toml = serialize_toml_value(&merged_layers, startup_command)?;
    let mut config = deserialize_typed_toml::<RawConfigLayerData>(&merged_raw_toml)
        .map_err(|parse_error| {
            cli_error_for_typed_config(&parse_error, layer_stack, startup_command, config_path)
        })?
        .into_app_config();
    config.active_org = normalize_optional_string(config.active_org);
    config.server_url = normalize_optional_string(config.server_url);
    typed_overrides.apply_to(&mut config, &mut origins);
    validate_config(&config, &origins, startup_command)?;
    Ok((config, origins))
}

pub(super) fn layer_stack_for_persisted_state(
    path: &Path,
    data: &AppConfig,
    command_line: &str,
) -> Result<ConfigLayerStack, CliError> {
    let default_layer = default_config_layer(command_line)?;
    let user_source = ConfigLayerSource::UserFile {
        path: path.to_path_buf(),
    };
    let user_data = RawConfigLayerData::from_typed_config(data);
    let user_config = raw_config_layer_toml_value(&user_data, &user_source, command_line)?;
    let user_raw_toml = serialize_toml_value(&user_config, command_line)?;
    let user_layer = ConfigLayer::enabled(
        user_source,
        user_config,
        Some(user_raw_toml.clone()),
        Some(config_fingerprint(&user_raw_toml)),
    );
    Ok(ConfigLayerStack::new(vec![default_layer, user_layer]))
}

pub(super) fn origins_for_layer_stack(layer_stack: &ConfigLayerStack) -> ConfigOrigins {
    ConfigOrigins {
        active_org: origin_for_path(layer_stack, "org.active", "org.active"),
        server_url: origin_for_path(layer_stack, "api.server_url", "api.server_url"),
        request_timeout_sec: origin_for_path(
            layer_stack,
            "api.request_timeout_sec",
            "api.request_timeout_sec",
        ),
    }
}

fn normalize_optional_string(value: Option<String>) -> Option<String> {
    value.and_then(|raw_value| {
        let normalized = raw_value.trim();
        if normalized.is_empty() {
            None
        } else {
            Some(normalized.to_owned())
        }
    })
}

fn validate_config(
    data: &AppConfig,
    origins: &ConfigOrigins,
    startup_command: &str,
) -> Result<(), CliError> {
    if let Some(server_url) = data.server_url.as_deref() {
        super::normalize_server_url(server_url).map_err(|failure| {
            CliError::new(
                "invalid config value",
                startup_command,
                ErrorStage::LoadConfig,
                format!(
                    "{} (from {})",
                    failure.render("server_url"),
                    origins.server_url.describe()
                ),
                vec![super::config_set_server_url_command_example()],
            )
        })?;
    }

    if data.request_timeout_sec == 0 {
        return Err(CliError::new(
            "invalid config value",
            startup_command,
            ErrorStage::LoadConfig,
            format!(
                "request_timeout_sec must be greater than 0 (from {})",
                origins.request_timeout_sec.describe()
            ),
            vec![super::config_set_request_timeout_sec_command_example()],
        ));
    }

    Ok(())
}

fn serialize_toml_value(data: &TomlValue, command_line: &str) -> Result<String, CliError> {
    toml::to_string_pretty(data).map_err(|serialize_error| {
        CliError::new(
            "failed to serialize config",
            command_line,
            ErrorStage::LoadConfig,
            serialize_error.to_string(),
            vec!["retry command".to_owned()],
        )
    })
}

fn raw_config_layer_toml_value(
    data: &RawConfigLayerData,
    source: &ConfigLayerSource,
    command_line: &str,
) -> Result<TomlValue, CliError> {
    TomlValue::try_from(data.clone())
        .map_err(|serialize_error| {
            CliError::new(
                "failed to serialize config",
                command_line,
                ErrorStage::LoadConfig,
                serialize_error.to_string(),
                vec!["retry command".to_owned()],
            )
        })
        .map(|config| normalize_toml_value_for_layer_source(config, source))
}

fn normalize_toml_value_for_layer_source(
    value: TomlValue,
    source: &ConfigLayerSource,
) -> TomlValue {
    match source {
        ConfigLayerSource::Defaults | ConfigLayerSource::CliOverrides => value,
        ConfigLayerSource::UserFile { path } => {
            normalize_toml_value_for_base_dir(value, path.parent())
        }
    }
}

fn normalize_toml_value_for_base_dir(value: TomlValue, base_dir: Option<&Path>) -> TomlValue {
    let _ = base_dir;

    // Comment: there are no path-valued config keys yet, but normalization still belongs
    // here so future relative-path fields are anchored per layer before merge.
    value
}

fn empty_config_table() -> TomlValue {
    TomlValue::Table(toml::map::Map::new())
}

fn origin_for_path(
    layer_stack: &ConfigLayerStack,
    dotted_path: &str,
    origin_key: &'static str,
) -> ConfigValueOrigin {
    layer_stack
        .origin_for_path(dotted_path)
        .map(|metadata| ConfigValueOrigin::from_layer_source(metadata.source(), origin_key))
        .unwrap_or(ConfigValueOrigin::Defaults)
}

fn cli_error_for_typed_config(
    parse_error: &TypedTomlDeserializationError,
    layer_stack: &ConfigLayerStack,
    startup_command: &str,
    config_path: &Path,
) -> CliError {
    if let Some(dotted_path) = parse_error.path.as_deref()
        && let Some(metadata) = layer_stack.origin_for_path(dotted_path)
    {
        return CliError::new(
            "failed to parse config file",
            startup_command,
            ErrorStage::LoadConfig,
            format!(
                "{} (from {})",
                parse_error.message,
                describe_layer_source(metadata.source(), dotted_path)
            ),
            try_next_for_layer_source(metadata.source(), dotted_path),
        );
    }

    CliError::new(
        "failed to parse config file",
        startup_command,
        ErrorStage::LoadConfig,
        format!("{} ({})", parse_error.message, config_path.display()),
        vec![format!("remove or fix {}", config_path.display())],
    )
}

fn describe_layer_source(source: &ConfigLayerSource, dotted_path: &str) -> String {
    match source {
        ConfigLayerSource::Defaults => "built-in defaults".to_owned(),
        ConfigLayerSource::UserFile { path } => format!("user config file {}", path.display()),
        ConfigLayerSource::CliOverrides => format!("CLI raw override for {dotted_path}"),
    }
}

fn try_next_for_layer_source(source: &ConfigLayerSource, dotted_path: &str) -> Vec<String> {
    match source {
        ConfigLayerSource::Defaults => vec!["report this default config bug".to_owned()],
        ConfigLayerSource::UserFile { path } => vec![format!("remove or fix {}", path.display())],
        ConfigLayerSource::CliOverrides => {
            vec![format!("fix CLI raw override for {dotted_path}")]
        }
    }
}
