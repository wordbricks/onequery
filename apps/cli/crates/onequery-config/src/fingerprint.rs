use std::collections::HashMap;
use std::fmt::Write;

use serde_json::Value as JsonValue;
use sha2::Digest;
use sha2::Sha256;
use toml::Value as TomlValue;

use crate::state::ConfigLayerMetadata;

pub fn config_fingerprint(raw_toml: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(raw_toml.as_bytes());
    format!("{:x}", hasher.finalize())
}

pub fn version_for_toml(value: &TomlValue) -> String {
    let canonical = canonical_json_from_toml(value);
    let serialized = canonical.to_string().into_bytes();
    let mut hasher = Sha256::new();
    hasher.update(serialized);
    let hash = hasher.finalize();
    let mut fingerprint = String::with_capacity("sha256:".len() + hash.len() * 2);
    fingerprint.push_str("sha256:");
    for byte in hash {
        let _ = write!(fingerprint, "{byte:02x}");
    }
    fingerprint
}

pub(crate) fn record_origins(
    value: &TomlValue,
    metadata: &ConfigLayerMetadata,
    path: &mut Vec<String>,
    origins: &mut HashMap<String, ConfigLayerMetadata>,
) {
    match value {
        TomlValue::Table(table) => {
            for (key, value) in table {
                path.push(key.clone());
                record_origins(value, metadata, path, origins);
                path.pop();
            }
        }
        TomlValue::Array(items) => {
            for (index, item) in (0_i32..).zip(items.iter()) {
                path.push(index.to_string());
                record_origins(item, metadata, path, origins);
                path.pop();
            }
        }
        _ => {
            if !path.is_empty() {
                origins.insert(path.join("."), metadata.clone());
            }
        }
    }
}

fn canonical_json_from_toml(value: &TomlValue) -> JsonValue {
    match value {
        TomlValue::String(value) => JsonValue::String(value.clone()),
        TomlValue::Integer(value) => JsonValue::Number((*value).into()),
        TomlValue::Float(value) => serde_json::Number::from_f64(*value)
            .map(JsonValue::Number)
            .unwrap_or_else(|| JsonValue::String(value.to_string())),
        TomlValue::Boolean(value) => JsonValue::Bool(*value),
        TomlValue::Datetime(value) => JsonValue::String(value.to_string()),
        TomlValue::Array(items) => {
            JsonValue::Array(items.iter().map(canonical_json_from_toml).collect())
        }
        TomlValue::Table(table) => {
            let mut sorted = serde_json::Map::new();
            let mut keys = table.keys().cloned().collect::<Vec<_>>();
            keys.sort();
            for key in keys {
                if let Some(value) = table.get(&key) {
                    sorted.insert(key, canonical_json_from_toml(value));
                }
            }
            JsonValue::Object(sorted)
        }
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use pretty_assertions::assert_eq;
    use toml::Value as TomlValue;

    use super::config_fingerprint;
    use super::record_origins;
    use super::version_for_toml;
    use crate::state::ConfigLayerMetadata;
    use crate::state::ConfigLayerSource;

    #[test]
    fn config_fingerprint_hashes_raw_toml_bytes() {
        assert_eq!(
            config_fingerprint("active_org = \"acme\"\n"),
            "76fdee3b74aafdba536765bfde10b7970db9739b68cef122865261af8ed39149"
        );
    }

    #[test]
    fn version_for_toml_is_stable_across_key_orderings() {
        let first = toml::from_str::<TomlValue>(
            r#"
request_timeout_sec = 60
active_org = "acme"
"#,
        )
        .expect("expected TOML parse to succeed");
        let second = toml::from_str::<TomlValue>(
            r#"
active_org = "acme"
request_timeout_sec = 60
"#,
        )
        .expect("expected TOML parse to succeed");

        assert_eq!(version_for_toml(&first), version_for_toml(&second));
    }

    #[test]
    fn record_origins_tracks_leaf_paths() {
        let value = toml::from_str::<TomlValue>(
            r#"
[api]
request_timeout_sec = 60
"#,
        )
        .expect("expected TOML parse to succeed");
        let metadata =
            ConfigLayerMetadata::new(ConfigLayerSource::Defaults, Some("defaults".to_owned()));
        let mut origins = HashMap::new();
        let mut path = Vec::new();

        record_origins(&value, &metadata, &mut path, &mut origins);

        assert_eq!(
            origins.get("api.request_timeout_sec"),
            Some(&ConfigLayerMetadata::new(
                ConfigLayerSource::Defaults,
                Some("defaults".to_owned()),
            ))
        );
    }
}
