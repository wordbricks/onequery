use buffa::EnumValue;

use crate::transport::generated::types;

pub(crate) fn content_format_to_str(value: EnumValue<types::CliContentFormat>) -> String {
    match value.as_known() {
        Some(types::CliContentFormat::CLI_CONTENT_FORMAT_MARKDOWN) => "markdown".to_owned(),
        Some(types::CliContentFormat::CLI_CONTENT_FORMAT_UNSPECIFIED) | None => value.to_string(),
    }
}

pub(crate) fn source_provider_from_str(value: &str) -> Option<types::CliSourceProvider> {
    match value {
        "postgres" => Some(types::CliSourceProvider::CLI_SOURCE_PROVIDER_POSTGRES),
        "supabase" => Some(types::CliSourceProvider::CLI_SOURCE_PROVIDER_SUPABASE),
        "mysql" => Some(types::CliSourceProvider::CLI_SOURCE_PROVIDER_MYSQL),
        "mongodb" => Some(types::CliSourceProvider::CLI_SOURCE_PROVIDER_MONGODB),
        "bigquery" => Some(types::CliSourceProvider::CLI_SOURCE_PROVIDER_BIGQUERY),
        "laminar" => Some(types::CliSourceProvider::CLI_SOURCE_PROVIDER_LAMINAR),
        "aws_athena_connector" => {
            Some(types::CliSourceProvider::CLI_SOURCE_PROVIDER_AWS_ATHENA_CONNECTOR)
        }
        "ga" => Some(types::CliSourceProvider::CLI_SOURCE_PROVIDER_GA),
        "amplitude" => Some(types::CliSourceProvider::CLI_SOURCE_PROVIDER_AMPLITUDE),
        "mixpanel" => Some(types::CliSourceProvider::CLI_SOURCE_PROVIDER_MIXPANEL),
        "posthog" => Some(types::CliSourceProvider::CLI_SOURCE_PROVIDER_POSTHOG),
        "sentry" => Some(types::CliSourceProvider::CLI_SOURCE_PROVIDER_SENTRY),
        "github" => Some(types::CliSourceProvider::CLI_SOURCE_PROVIDER_GITHUB),
        "linear" => Some(types::CliSourceProvider::CLI_SOURCE_PROVIDER_LINEAR),
        _ => None,
    }
}

pub(crate) fn source_provider_to_str(value: EnumValue<types::CliSourceProvider>) -> String {
    match value.as_known() {
        Some(types::CliSourceProvider::CLI_SOURCE_PROVIDER_POSTGRES) => "postgres".to_owned(),
        Some(types::CliSourceProvider::CLI_SOURCE_PROVIDER_SUPABASE) => "supabase".to_owned(),
        Some(types::CliSourceProvider::CLI_SOURCE_PROVIDER_MYSQL) => "mysql".to_owned(),
        Some(types::CliSourceProvider::CLI_SOURCE_PROVIDER_MONGODB) => "mongodb".to_owned(),
        Some(types::CliSourceProvider::CLI_SOURCE_PROVIDER_BIGQUERY) => "bigquery".to_owned(),
        Some(types::CliSourceProvider::CLI_SOURCE_PROVIDER_LAMINAR) => "laminar".to_owned(),
        Some(types::CliSourceProvider::CLI_SOURCE_PROVIDER_AWS_ATHENA_CONNECTOR) => {
            "aws_athena_connector".to_owned()
        }
        Some(types::CliSourceProvider::CLI_SOURCE_PROVIDER_GA) => "ga".to_owned(),
        Some(types::CliSourceProvider::CLI_SOURCE_PROVIDER_AMPLITUDE) => "amplitude".to_owned(),
        Some(types::CliSourceProvider::CLI_SOURCE_PROVIDER_MIXPANEL) => "mixpanel".to_owned(),
        Some(types::CliSourceProvider::CLI_SOURCE_PROVIDER_POSTHOG) => "posthog".to_owned(),
        Some(types::CliSourceProvider::CLI_SOURCE_PROVIDER_SENTRY) => "sentry".to_owned(),
        Some(types::CliSourceProvider::CLI_SOURCE_PROVIDER_GITHUB) => "github".to_owned(),
        Some(types::CliSourceProvider::CLI_SOURCE_PROVIDER_LINEAR) => "linear".to_owned(),
        Some(types::CliSourceProvider::CLI_SOURCE_PROVIDER_UNSPECIFIED) | None => value.to_string(),
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
    use super::source_provider_from_str;
    use super::source_provider_to_str;
    use super::source_status_to_str;
    use super::types;
    use super::use_source_from_str;
    use super::use_source_to_str;

    #[test]
    fn source_provider_mappings_round_trip_known_values() {
        assert_eq!(
            [
                Some(types::CliSourceProvider::CLI_SOURCE_PROVIDER_POSTGRES),
                Some(types::CliSourceProvider::CLI_SOURCE_PROVIDER_LINEAR),
            ],
            [
                source_provider_from_str("postgres"),
                source_provider_from_str("linear"),
            ]
        );
        assert_eq!(
            ["postgres".to_owned(), "linear".to_owned(),],
            [
                source_provider_to_str(
                    types::CliSourceProvider::CLI_SOURCE_PROVIDER_POSTGRES.into(),
                ),
                source_provider_to_str(types::CliSourceProvider::CLI_SOURCE_PROVIDER_LINEAR.into(),),
            ]
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
