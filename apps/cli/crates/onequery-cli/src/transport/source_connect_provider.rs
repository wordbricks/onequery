use std::fmt;
use std::str::FromStr;

use clap::ValueEnum;
use clap::builder::PossibleValue;

use crate::transport::generated::types;

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub(crate) enum SourceConnectProvider {
    Postgres,
    Supabase,
    Mysql,
    Mongodb,
    Bigquery,
    Laminar,
    AwsAthenaConnector,
    Ga,
    Amplitude,
    Mixpanel,
    Posthog,
    Sentry,
    Github,
    Linear,
}

impl SourceConnectProvider {
    const ALL: [Self; 14] = [
        Self::Postgres,
        Self::Supabase,
        Self::Mysql,
        Self::Mongodb,
        Self::Bigquery,
        Self::Laminar,
        Self::AwsAthenaConnector,
        Self::Ga,
        Self::Amplitude,
        Self::Mixpanel,
        Self::Posthog,
        Self::Sentry,
        Self::Github,
        Self::Linear,
    ];

    pub(crate) fn supported() -> &'static [Self] {
        &Self::ALL
    }

    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Postgres => "postgres",
            Self::Supabase => "supabase",
            Self::Mysql => "mysql",
            Self::Mongodb => "mongodb",
            Self::Bigquery => "bigquery",
            Self::Laminar => "laminar",
            Self::AwsAthenaConnector => "aws_athena_connector",
            Self::Ga => "ga",
            Self::Amplitude => "amplitude",
            Self::Mixpanel => "mixpanel",
            Self::Posthog => "posthog",
            Self::Sentry => "sentry",
            Self::Github => "github",
            Self::Linear => "linear",
        }
    }
}

impl ValueEnum for SourceConnectProvider {
    fn value_variants<'a>() -> &'a [Self] {
        Self::supported()
    }

    fn to_possible_value(&self) -> Option<PossibleValue> {
        Some(PossibleValue::new(self.as_str()))
    }
}

impl fmt::Display for SourceConnectProvider {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.as_str())
    }
}

impl FromStr for SourceConnectProvider {
    type Err = String;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        <Self as ValueEnum>::from_str(value, false)
    }
}

impl From<SourceConnectProvider> for types::CliSourceProvider {
    fn from(value: SourceConnectProvider) -> Self {
        match value {
            SourceConnectProvider::Postgres => Self::CLI_SOURCE_PROVIDER_POSTGRES,
            SourceConnectProvider::Supabase => Self::CLI_SOURCE_PROVIDER_SUPABASE,
            SourceConnectProvider::Mysql => Self::CLI_SOURCE_PROVIDER_MYSQL,
            SourceConnectProvider::Mongodb => Self::CLI_SOURCE_PROVIDER_MONGODB,
            SourceConnectProvider::Bigquery => Self::CLI_SOURCE_PROVIDER_BIGQUERY,
            SourceConnectProvider::Laminar => Self::CLI_SOURCE_PROVIDER_LAMINAR,
            SourceConnectProvider::AwsAthenaConnector => {
                Self::CLI_SOURCE_PROVIDER_AWS_ATHENA_CONNECTOR
            }
            SourceConnectProvider::Ga => Self::CLI_SOURCE_PROVIDER_GA,
            SourceConnectProvider::Amplitude => Self::CLI_SOURCE_PROVIDER_AMPLITUDE,
            SourceConnectProvider::Mixpanel => Self::CLI_SOURCE_PROVIDER_MIXPANEL,
            SourceConnectProvider::Posthog => Self::CLI_SOURCE_PROVIDER_POSTHOG,
            SourceConnectProvider::Sentry => Self::CLI_SOURCE_PROVIDER_SENTRY,
            SourceConnectProvider::Github => Self::CLI_SOURCE_PROVIDER_GITHUB,
            SourceConnectProvider::Linear => Self::CLI_SOURCE_PROVIDER_LINEAR,
        }
    }
}

impl TryFrom<types::CliSourceProvider> for SourceConnectProvider {
    type Error = ();

    fn try_from(value: types::CliSourceProvider) -> Result<Self, Self::Error> {
        match value {
            types::CliSourceProvider::CLI_SOURCE_PROVIDER_POSTGRES => Ok(Self::Postgres),
            types::CliSourceProvider::CLI_SOURCE_PROVIDER_SUPABASE => Ok(Self::Supabase),
            types::CliSourceProvider::CLI_SOURCE_PROVIDER_MYSQL => Ok(Self::Mysql),
            types::CliSourceProvider::CLI_SOURCE_PROVIDER_MONGODB => Ok(Self::Mongodb),
            types::CliSourceProvider::CLI_SOURCE_PROVIDER_BIGQUERY => Ok(Self::Bigquery),
            types::CliSourceProvider::CLI_SOURCE_PROVIDER_LAMINAR => Ok(Self::Laminar),
            types::CliSourceProvider::CLI_SOURCE_PROVIDER_AWS_ATHENA_CONNECTOR => {
                Ok(Self::AwsAthenaConnector)
            }
            types::CliSourceProvider::CLI_SOURCE_PROVIDER_GA => Ok(Self::Ga),
            types::CliSourceProvider::CLI_SOURCE_PROVIDER_AMPLITUDE => Ok(Self::Amplitude),
            types::CliSourceProvider::CLI_SOURCE_PROVIDER_MIXPANEL => Ok(Self::Mixpanel),
            types::CliSourceProvider::CLI_SOURCE_PROVIDER_POSTHOG => Ok(Self::Posthog),
            types::CliSourceProvider::CLI_SOURCE_PROVIDER_SENTRY => Ok(Self::Sentry),
            types::CliSourceProvider::CLI_SOURCE_PROVIDER_GITHUB => Ok(Self::Github),
            types::CliSourceProvider::CLI_SOURCE_PROVIDER_LINEAR => Ok(Self::Linear),
            types::CliSourceProvider::CLI_SOURCE_PROVIDER_UNSPECIFIED => Err(()),
        }
    }
}

#[cfg(test)]
mod tests {
    use pretty_assertions::assert_eq;

    use super::SourceConnectProvider;
    use super::types;

    #[test]
    fn source_connect_provider_strings_round_trip_through_clap_values() {
        assert_eq!(
            SourceConnectProvider::supported()
                .iter()
                .copied()
                .map(|provider| provider.to_string())
                .collect::<Vec<_>>(),
            SourceConnectProvider::supported()
                .iter()
                .copied()
                .map(|provider| provider.as_str().parse::<SourceConnectProvider>())
                .collect::<Result<Vec<_>, _>>()
                .expect("all supported providers should parse")
                .iter()
                .map(ToString::to_string)
                .collect::<Vec<_>>()
        );
    }

    #[test]
    fn source_connect_provider_generated_values_round_trip_supported_surface() {
        assert_eq!(
            SourceConnectProvider::supported().to_vec(),
            SourceConnectProvider::supported()
                .iter()
                .copied()
                .map(types::CliSourceProvider::from)
                .map(SourceConnectProvider::try_from)
                .collect::<Result<Vec<_>, _>>()
                .expect("supported providers should convert from generated values")
        );
    }
}
