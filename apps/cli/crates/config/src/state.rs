use std::collections::HashMap;
use std::path::PathBuf;

use blake3::Hash;
use toml::Value as TomlValue;

use crate::fingerprint::record_origins;
use crate::merge::merge_toml_values;

#[derive(Debug, Clone, Eq, PartialEq)]
pub enum ConfigLayerSource {
    Defaults,
    UserFile { path: PathBuf },
    CliOverrides,
}

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub enum ConfigLayerStackOrdering {
    LowestPrecedenceFirst,
    HighestPrecedenceFirst,
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub enum ConfigLayerStatus {
    Enabled,
    Disabled { reason: String },
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub struct ConfigLayerMetadata {
    source: ConfigLayerSource,
    fingerprint: Option<Hash>,
}

impl ConfigLayerMetadata {
    pub fn new(source: ConfigLayerSource, fingerprint: Option<Hash>) -> Self {
        Self {
            source,
            fingerprint,
        }
    }

    pub fn source(&self) -> &ConfigLayerSource {
        &self.source
    }

    pub fn fingerprint(&self) -> Option<Hash> {
        self.fingerprint
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct ConfigLayer {
    source: ConfigLayerSource,
    status: ConfigLayerStatus,
    config: TomlValue,
    raw_toml: Option<String>,
    fingerprint: Option<Hash>,
}

impl ConfigLayer {
    pub fn enabled(
        source: ConfigLayerSource,
        config: TomlValue,
        raw_toml: Option<String>,
        fingerprint: Option<Hash>,
    ) -> Self {
        Self {
            source,
            status: ConfigLayerStatus::Enabled,
            config,
            raw_toml,
            fingerprint,
        }
    }

    pub fn disabled(
        source: ConfigLayerSource,
        config: TomlValue,
        reason: impl Into<String>,
    ) -> Self {
        Self {
            source,
            status: ConfigLayerStatus::Disabled {
                reason: reason.into(),
            },
            config,
            raw_toml: None,
            fingerprint: None,
        }
    }

    pub fn source(&self) -> &ConfigLayerSource {
        &self.source
    }

    pub fn status(&self) -> &ConfigLayerStatus {
        &self.status
    }

    pub fn config(&self) -> &TomlValue {
        &self.config
    }

    pub fn raw_toml(&self) -> Option<&str> {
        self.raw_toml.as_deref()
    }

    pub fn fingerprint(&self) -> Option<Hash> {
        self.fingerprint
    }

    pub fn metadata(&self) -> ConfigLayerMetadata {
        ConfigLayerMetadata::new(self.source.clone(), self.fingerprint)
    }

    pub fn is_disabled(&self) -> bool {
        matches!(self.status, ConfigLayerStatus::Disabled { .. })
    }
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct ConfigLayerStack {
    layers: Vec<ConfigLayer>,
}

impl ConfigLayerStack {
    pub fn new(layers: Vec<ConfigLayer>) -> Self {
        Self { layers }
    }

    pub fn layers(&self) -> &[ConfigLayer] {
        &self.layers
    }

    pub fn effective_config(&self) -> TomlValue {
        let mut merged = TomlValue::Table(toml::map::Map::new());
        for layer in self.get_layers(
            ConfigLayerStackOrdering::LowestPrecedenceFirst,
            /*include_disabled*/ false,
        ) {
            merge_toml_values(&mut merged, layer.config());
        }
        merged
    }

    pub fn origins(&self) -> HashMap<String, ConfigLayerMetadata> {
        let mut origins = HashMap::new();
        let mut path = Vec::new();

        for layer in self.get_layers(
            ConfigLayerStackOrdering::LowestPrecedenceFirst,
            /*include_disabled*/ false,
        ) {
            record_origins(layer.config(), &layer.metadata(), &mut path, &mut origins);
        }

        origins
    }

    pub fn origin_for_path(&self, dotted_path: &str) -> Option<ConfigLayerMetadata> {
        self.origins().get(dotted_path).cloned()
    }

    pub fn layers_high_to_low(&self) -> Vec<&ConfigLayer> {
        self.get_layers(
            ConfigLayerStackOrdering::HighestPrecedenceFirst,
            /*include_disabled*/ false,
        )
    }

    pub fn get_layers(
        &self,
        ordering: ConfigLayerStackOrdering,
        include_disabled: bool,
    ) -> Vec<&ConfigLayer> {
        let mut layers = self
            .layers
            .iter()
            .filter(|layer| include_disabled || !layer.is_disabled())
            .collect::<Vec<_>>();
        if ordering == ConfigLayerStackOrdering::HighestPrecedenceFirst {
            layers.reverse();
        }
        layers
    }
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use blake3::Hash;
    use pretty_assertions::assert_eq;
    use toml::Value as TomlValue;

    use super::ConfigLayer;
    use super::ConfigLayerMetadata;
    use super::ConfigLayerSource;
    use super::ConfigLayerStack;
    use super::ConfigLayerStatus;

    fn empty_config_table() -> TomlValue {
        TomlValue::Table(toml::map::Map::new())
    }

    fn sample_fingerprint(label: &str) -> Hash {
        blake3::hash(label.as_bytes())
    }

    #[test]
    fn enabled_layer_preserves_metadata() {
        let layer = ConfigLayer::enabled(
            ConfigLayerSource::UserFile {
                path: PathBuf::from("/tmp/onequery/config.toml"),
            },
            toml::from_str("active_org = \"acme\"\n").expect("expected TOML parse to succeed"),
            Some("active_org = \"acme\"\n".to_owned()),
            Some(sample_fingerprint("abc123")),
        );

        assert_eq!(
            layer,
            ConfigLayer {
                source: ConfigLayerSource::UserFile {
                    path: PathBuf::from("/tmp/onequery/config.toml"),
                },
                status: ConfigLayerStatus::Enabled,
                config: toml::from_str("active_org = \"acme\"\n")
                    .expect("expected TOML parse to succeed"),
                raw_toml: Some("active_org = \"acme\"\n".to_owned()),
                fingerprint: Some(sample_fingerprint("abc123")),
            }
        );
    }

    #[test]
    fn disabled_layer_clears_optional_fields() {
        let layer = ConfigLayer::disabled(
            ConfigLayerSource::Defaults,
            empty_config_table(),
            "not loaded",
        );

        assert_eq!(
            layer,
            ConfigLayer {
                source: ConfigLayerSource::Defaults,
                status: ConfigLayerStatus::Disabled {
                    reason: "not loaded".to_owned(),
                },
                config: empty_config_table(),
                raw_toml: None,
                fingerprint: None,
            }
        );
    }

    #[test]
    fn config_layer_stack_returns_stored_layers() {
        let stack = ConfigLayerStack::new(vec![ConfigLayer::disabled(
            ConfigLayerSource::Defaults,
            empty_config_table(),
            "missing",
        )]);

        assert_eq!(stack.layers().len(), 1);
    }

    #[test]
    fn effective_config_ignores_disabled_layers() {
        let stack = ConfigLayerStack::new(vec![
            ConfigLayer::enabled(
                ConfigLayerSource::Defaults,
                toml::from_str::<TomlValue>(
                    r#"
[api]
request_timeout_sec = 60
"#,
                )
                .expect("expected TOML parse to succeed"),
                None,
                Some(sample_fingerprint("defaults")),
            ),
            ConfigLayer::disabled(
                ConfigLayerSource::UserFile {
                    path: PathBuf::from("/tmp/onequery/config.toml"),
                },
                toml::from_str::<TomlValue>(
                    r#"
[api]
request_timeout_sec = 15
"#,
                )
                .expect("expected TOML parse to succeed"),
                "missing",
            ),
        ]);

        assert_eq!(
            stack.effective_config(),
            toml::from_str::<TomlValue>(
                r#"
[api]
request_timeout_sec = 60
"#,
            )
            .expect("expected TOML parse to succeed")
        );
    }

    #[test]
    fn origins_track_highest_precedence_leaf_source() {
        let stack = ConfigLayerStack::new(vec![
            ConfigLayer::enabled(
                ConfigLayerSource::Defaults,
                toml::from_str::<TomlValue>(
                    r#"
[api]
request_timeout_sec = 60

[org]
active = "acme"
"#,
                )
                .expect("expected TOML parse to succeed"),
                None,
                Some(sample_fingerprint("defaults")),
            ),
            ConfigLayer::enabled(
                ConfigLayerSource::UserFile {
                    path: PathBuf::from("/tmp/onequery/config.toml"),
                },
                toml::from_str::<TomlValue>(
                    r#"
[api]
request_timeout_sec = 15
"#,
                )
                .expect("expected TOML parse to succeed"),
                None,
                Some(sample_fingerprint("user")),
            ),
        ]);

        assert_eq!(
            stack.origin_for_path("api.request_timeout_sec"),
            Some(ConfigLayerMetadata::new(
                ConfigLayerSource::UserFile {
                    path: PathBuf::from("/tmp/onequery/config.toml"),
                },
                Some(sample_fingerprint("user")),
            ))
        );
        assert_eq!(
            stack.origin_for_path("org.active"),
            Some(ConfigLayerMetadata::new(
                ConfigLayerSource::Defaults,
                Some(sample_fingerprint("defaults")),
            ))
        );
    }
}
