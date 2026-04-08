use std::fmt;
use std::str::FromStr;

use clap::ValueEnum;
use clap::builder::PossibleValue;

use crate::transport::generated::types;

macro_rules! source_connect_providers {
    (
        $(
            $variant:ident => {
                label: $label:literal,
                generated: $generated:ident,
            }
        ),+ $(,)?
    ) => {
        #[derive(Debug, Clone, Copy, Eq, PartialEq)]
        pub(crate) enum SourceConnectProvider {
            $(
                $variant,
            )+
        }

        impl SourceConnectProvider {
            const ALL: [Self; source_connect_providers!(@count $($variant),+)] = [
                $(
                    Self::$variant,
                )+
            ];

            pub(crate) fn supported() -> &'static [Self] {
                &Self::ALL
            }

            pub(crate) fn as_str(self) -> &'static str {
                match self {
                    $(
                        Self::$variant => $label,
                    )+
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
                match value {
                    $(
                        $label => Ok(Self::$variant),
                    )+
                    _ => Err(format!("invalid source connect provider `{value}`")),
                }
            }
        }

        impl From<SourceConnectProvider> for types::CliSourceProvider {
            fn from(value: SourceConnectProvider) -> Self {
                match value {
                    $(
                        SourceConnectProvider::$variant => Self::$generated,
                    )+
                }
            }
        }

        impl TryFrom<types::CliSourceProvider> for SourceConnectProvider {
            type Error = ();

            fn try_from(value: types::CliSourceProvider) -> Result<Self, Self::Error> {
                match value {
                    $(
                        types::CliSourceProvider::$generated => Ok(Self::$variant),
                    )+
                    types::CliSourceProvider::CLI_SOURCE_PROVIDER_UNSPECIFIED => Err(()),
                }
            }
        }
    };
    (@count $($variant:ident),+) => {
        <[()]>::len(&[$(source_connect_providers!(@replace $variant ())),+])
    };
    (@replace $_variant:ident $value:expr) => {
        $value
    };
}

// CONTEXT: Keep the supported connect surface in one declaration so CLI values,
// labels, and generated transport conversions cannot drift apart.
source_connect_providers! {
    Postgres => {
        label: "postgres",
        generated: CLI_SOURCE_PROVIDER_POSTGRES,
    },
    Supabase => {
        label: "supabase",
        generated: CLI_SOURCE_PROVIDER_SUPABASE,
    },
    Mysql => {
        label: "mysql",
        generated: CLI_SOURCE_PROVIDER_MYSQL,
    },
    Mongodb => {
        label: "mongodb",
        generated: CLI_SOURCE_PROVIDER_MONGODB,
    },
    Bigquery => {
        label: "bigquery",
        generated: CLI_SOURCE_PROVIDER_BIGQUERY,
    },
    Laminar => {
        label: "laminar",
        generated: CLI_SOURCE_PROVIDER_LAMINAR,
    },
    AwsAthenaConnector => {
        label: "aws_athena_connector",
        generated: CLI_SOURCE_PROVIDER_AWS_ATHENA_CONNECTOR,
    },
    Ga => {
        label: "ga",
        generated: CLI_SOURCE_PROVIDER_GA,
    },
    Amplitude => {
        label: "amplitude",
        generated: CLI_SOURCE_PROVIDER_AMPLITUDE,
    },
    Mixpanel => {
        label: "mixpanel",
        generated: CLI_SOURCE_PROVIDER_MIXPANEL,
    },
    Posthog => {
        label: "posthog",
        generated: CLI_SOURCE_PROVIDER_POSTHOG,
    },
    Sentry => {
        label: "sentry",
        generated: CLI_SOURCE_PROVIDER_SENTRY,
    },
    Github => {
        label: "github",
        generated: CLI_SOURCE_PROVIDER_GITHUB,
    },
    Linear => {
        label: "linear",
        generated: CLI_SOURCE_PROVIDER_LINEAR,
    },
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
