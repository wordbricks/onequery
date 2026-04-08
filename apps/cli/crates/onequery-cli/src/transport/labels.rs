use buffa::EnumValue;

use crate::transport::generated::types;
use crate::transport::source_connect_provider::SourceConnectProvider;

pub(crate) fn content_format_to_str(value: EnumValue<types::CliContentFormat>) -> String {
    match value.as_known() {
        Some(types::CliContentFormat::CLI_CONTENT_FORMAT_MARKDOWN) => "markdown".to_owned(),
        Some(types::CliContentFormat::CLI_CONTENT_FORMAT_UNSPECIFIED) | None => value.to_string(),
    }
}

pub(crate) fn source_provider_to_str(value: EnumValue<types::CliSourceProvider>) -> String {
    match value
        .as_known()
        .and_then(|provider| SourceConnectProvider::try_from(provider).ok())
    {
        Some(provider) => provider.to_string(),
        None => value.to_string(),
    }
}

pub(crate) fn source_status_to_str(value: EnumValue<types::CliSourceStatus>) -> String {
    match value.as_known() {
        Some(types::CliSourceStatus::CLI_SOURCE_STATUS_ACTIVE) => "active".to_owned(),
        Some(types::CliSourceStatus::CLI_SOURCE_STATUS_ERROR) => "error".to_owned(),
        Some(types::CliSourceStatus::CLI_SOURCE_STATUS_DISCONNECTED) => "disconnected".to_owned(),
        Some(types::CliSourceStatus::CLI_SOURCE_STATUS_UNSPECIFIED) | None => value.to_string(),
    }
}

pub(crate) fn use_source_from_str(value: &str) -> Option<types::CliUseSource> {
    match value {
        "amplitude" => Some(types::CliUseSource::CLI_USE_SOURCE_AMPLITUDE),
        "ga" => Some(types::CliUseSource::CLI_USE_SOURCE_GA),
        "github" => Some(types::CliUseSource::CLI_USE_SOURCE_GITHUB),
        "mixpanel" => Some(types::CliUseSource::CLI_USE_SOURCE_MIXPANEL),
        "mongodb" => Some(types::CliUseSource::CLI_USE_SOURCE_MONGODB),
        "posthog" => Some(types::CliUseSource::CLI_USE_SOURCE_POSTHOG),
        "sentry" => Some(types::CliUseSource::CLI_USE_SOURCE_SENTRY),
        _ => None,
    }
}

pub(crate) fn use_source_to_str(value: EnumValue<types::CliUseSource>) -> String {
    match value.as_known() {
        Some(types::CliUseSource::CLI_USE_SOURCE_AMPLITUDE) => "amplitude".to_owned(),
        Some(types::CliUseSource::CLI_USE_SOURCE_GA) => "ga".to_owned(),
        Some(types::CliUseSource::CLI_USE_SOURCE_GITHUB) => "github".to_owned(),
        Some(types::CliUseSource::CLI_USE_SOURCE_MIXPANEL) => "mixpanel".to_owned(),
        Some(types::CliUseSource::CLI_USE_SOURCE_MONGODB) => "mongodb".to_owned(),
        Some(types::CliUseSource::CLI_USE_SOURCE_POSTHOG) => "posthog".to_owned(),
        Some(types::CliUseSource::CLI_USE_SOURCE_SENTRY) => "sentry".to_owned(),
        Some(types::CliUseSource::CLI_USE_SOURCE_UNSPECIFIED) | None => value.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use pretty_assertions::assert_eq;

    use super::content_format_to_str;
    use super::source_provider_to_str;
    use super::source_status_to_str;
    use super::types;
    use super::use_source_from_str;
    use super::use_source_to_str;
    use crate::transport::source_connect_provider::SourceConnectProvider;

    #[test]
    fn source_provider_to_str_maps_supported_connect_providers() {
        assert_eq!(
            SourceConnectProvider::supported()
                .iter()
                .copied()
                .map(|provider| provider.to_string())
                .collect::<Vec<_>>(),
            SourceConnectProvider::supported()
                .iter()
                .copied()
                .map(types::CliSourceProvider::from)
                .map(|provider| source_provider_to_str(provider.into()))
                .collect::<Vec<_>>()
        );
    }

    #[test]
    fn source_status_to_str_maps_known_values() {
        assert_eq!(
            [
                source_status_to_str(types::CliSourceStatus::CLI_SOURCE_STATUS_ACTIVE.into()),
                source_status_to_str(types::CliSourceStatus::CLI_SOURCE_STATUS_ERROR.into()),
                source_status_to_str(types::CliSourceStatus::CLI_SOURCE_STATUS_DISCONNECTED.into(),),
            ],
            [
                "active".to_owned(),
                "error".to_owned(),
                "disconnected".to_owned(),
            ]
        );
    }

    #[test]
    fn use_source_mappings_round_trip_known_values() {
        assert_eq!(
            [
                Some(types::CliUseSource::CLI_USE_SOURCE_GITHUB),
                Some(types::CliUseSource::CLI_USE_SOURCE_SENTRY),
            ],
            [use_source_from_str("github"), use_source_from_str("sentry"),]
        );
        assert_eq!(
            ["github".to_owned(), "sentry".to_owned(),],
            [
                use_source_to_str(types::CliUseSource::CLI_USE_SOURCE_GITHUB.into()),
                use_source_to_str(types::CliUseSource::CLI_USE_SOURCE_SENTRY.into()),
            ]
        );
    }

    #[test]
    fn content_format_to_str_maps_markdown() {
        assert_eq!(
            content_format_to_str(types::CliContentFormat::CLI_CONTENT_FORMAT_MARKDOWN.into()),
            "markdown"
        );
    }
}
