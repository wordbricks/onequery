//! Shared config-layer utilities for OneQuery CLI crates.

mod cli_overrides;
mod diagnostics;
mod fingerprint;
mod merge;
mod overrides;
mod state;

pub use self::cli_overrides::CliOverrideParseError;
pub use self::cli_overrides::parse_cli_override;
pub use self::cli_overrides::parse_cli_overrides;
pub use self::diagnostics::ConfigError;
pub use self::diagnostics::TextPosition;
pub use self::diagnostics::TextRange;
pub use self::diagnostics::TypedTomlDeserializationError;
pub use self::diagnostics::config_error_from_toml;
pub use self::diagnostics::config_error_from_typed_toml;
pub use self::diagnostics::deserialize_typed_toml;
pub use self::diagnostics::format_config_error;
pub use self::diagnostics::format_config_error_with_source;
pub use self::fingerprint::config_fingerprint;
pub use self::fingerprint::version_for_toml;
pub use self::merge::merge_toml_values;
pub use self::overrides::build_cli_overrides_layer;
pub use self::state::ConfigLayer;
pub use self::state::ConfigLayerMetadata;
pub use self::state::ConfigLayerSource;
pub use self::state::ConfigLayerStack;
pub use self::state::ConfigLayerStackOrdering;
pub use self::state::ConfigLayerStatus;
