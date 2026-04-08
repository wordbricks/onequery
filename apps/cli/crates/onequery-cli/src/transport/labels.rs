use buffa::EnumValue;
use clap::builder::PossibleValuesParser;

use crate::transport::generated::types;

const SUPPORTED_SOURCE_CONNECT_PROVIDERS: [types::CliSourceProvider; 14] = [
    types::CliSourceProvider::CLI_SOURCE_PROVIDER_POSTGRES,
    types::CliSourceProvider::CLI_SOURCE_PROVIDER_SUPABASE,
    types::CliSourceProvider::CLI_SOURCE_PROVIDER_MYSQL,
    types::CliSourceProvider::CLI_SOURCE_PROVIDER_MONGODB,
    types::CliSourceProvider::CLI_SOURCE_PROVIDER_BIGQUERY,
    types::CliSourceProvider::CLI_SOURCE_PROVIDER_LAMINAR,
    types::CliSourceProvider::CLI_SOURCE_PROVIDER_AWS_ATHENA_CONNECTOR,
    types::CliSourceProvider::CLI_SOURCE_PROVIDER_GA,
    types::CliSourceProvider::CLI_SOURCE_PROVIDER_AMPLITUDE,
    types::CliSourceProvider::CLI_SOURCE_PROVIDER_MIXPANEL,
    types::CliSourceProvider::CLI_SOURCE_PROVIDER_POSTHOG,
    types::CliSourceProvider::CLI_SOURCE_PROVIDER_SENTRY,
    types::CliSourceProvider::CLI_SOURCE_PROVIDER_GITHUB,
    types::CliSourceProvider::CLI_SOURCE_PROVIDER_LINEAR,
];

pub(crate) fn source_connect_provider_parser() -> PossibleValuesParser {
    PossibleValuesParser::new(SUPPORTED_SOURCE_CONNECT_PROVIDERS.map(source_provider_name))
}

pub(crate) fn content_format_to_str(value: EnumValue<types::CliContentFormat>) -> String {
    match value.as_known() {
        Some(types::CliContentFormat::CLI_CONTENT_FORMAT_MARKDOWN) => "markdown".to_owned(),
        Some(types::CliContentFormat::CLI_CONTENT_FORMAT_UNSPECIFIED) | None => value.to_string(),
    }
}

pub(crate) fn source_provider_from_str(value: &str) -> Option<types::CliSourceProvider> {
    SUPPORTED_SOURCE_CONNECT_PROVIDERS
        .into_iter()
        .find(|provider| source_provider_name(*provider) == value)
}

pub(crate) fn source_provider_to_str(value: EnumValue<types::CliSourceProvider>) -> String {
    match value.as_known() {
        Some(types::CliSourceProvider::CLI_SOURCE_PROVIDER_UNSPECIFIED) | None => value.to_string(),
        Some(provider) => source_provider_name(provider).to_owned(),
    }
}

fn source_provider_name(provider: types::CliSourceProvider) -> &'static str {
    match provider {
        types::CliSourceProvider::CLI_SOURCE_PROVIDER_POSTGRES => "postgres",
        types::CliSourceProvider::CLI_SOURCE_PROVIDER_SUPABASE => "supabase",
        types::CliSourceProvider::CLI_SOURCE_PROVIDER_MYSQL => "mysql",
        types::CliSourceProvider::CLI_SOURCE_PROVIDER_MONGODB => "mongodb",
        types::CliSourceProvider::CLI_SOURCE_PROVIDER_BIGQUERY => "bigquery",
        types::CliSourceProvider::CLI_SOURCE_PROVIDER_LAMINAR => "laminar",
        types::CliSourceProvider::CLI_SOURCE_PROVIDER_AWS_ATHENA_CONNECTOR => {
            "aws_athena_connector"
        }
        types::CliSourceProvider::CLI_SOURCE_PROVIDER_GA => "ga",
        types::CliSourceProvider::CLI_SOURCE_PROVIDER_AMPLITUDE => "amplitude",
        types::CliSourceProvider::CLI_SOURCE_PROVIDER_MIXPANEL => "mixpanel",
        types::CliSourceProvider::CLI_SOURCE_PROVIDER_POSTHOG => "posthog",
        types::CliSourceProvider::CLI_SOURCE_PROVIDER_SENTRY => "sentry",
        types::CliSourceProvider::CLI_SOURCE_PROVIDER_GITHUB => "github",
        types::CliSourceProvider::CLI_SOURCE_PROVIDER_LINEAR => "linear",
        types::CliSourceProvider::CLI_SOURCE_PROVIDER_UNSPECIFIED => {
            unreachable!("unspecified providers are not part of the supported connect surface")
        }
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

    use super::SUPPORTED_SOURCE_CONNECT_PROVIDERS;
    use super::content_format_to_str;
    use super::source_provider_from_str;
    use super::source_provider_name;
    use super::source_provider_to_str;
    use super::source_status_to_str;
    use super::types;
    use super::use_source_from_str;
    use super::use_source_to_str;

    #[test]
    fn source_provider_mappings_share_one_supported_provider_table() {
        assert_eq!(
            SUPPORTED_SOURCE_CONNECT_PROVIDERS.map(Some),
            SUPPORTED_SOURCE_CONNECT_PROVIDERS
                .map(source_provider_name)
                .map(source_provider_from_str)
        );
        assert_eq!(
            SUPPORTED_SOURCE_CONNECT_PROVIDERS
                .map(source_provider_name)
                .map(str::to_owned),
            SUPPORTED_SOURCE_CONNECT_PROVIDERS
                .map(|provider| source_provider_to_str(provider.into()))
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
