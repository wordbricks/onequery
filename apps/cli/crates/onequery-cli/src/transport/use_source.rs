use std::fmt;
use std::str::FromStr;

use clap::ValueEnum;
use clap::builder::PossibleValue;

use crate::transport::generated::types;

macro_rules! use_sources {
    (
        $(
            $variant:ident => {
                label: $label:literal,
                generated: $generated:ident,
            }
        ),+ $(,)?
    ) => {
        #[derive(Debug, Clone, Copy, Eq, PartialEq)]
        pub(crate) enum UseSource {
            $(
                $variant,
            )+
        }

        impl UseSource {
            const ALL: [Self; use_sources!(@count $($variant),+)] = [
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

        impl ValueEnum for UseSource {
            fn value_variants<'a>() -> &'a [Self] {
                Self::supported()
            }

            fn to_possible_value(&self) -> Option<PossibleValue> {
                Some(PossibleValue::new(self.as_str()))
            }
        }

        impl fmt::Display for UseSource {
            fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
                formatter.write_str(self.as_str())
            }
        }

        impl FromStr for UseSource {
            type Err = String;

            fn from_str(value: &str) -> Result<Self, Self::Err> {
                match value {
                    $(
                        $label => Ok(Self::$variant),
                    )+
                    _ => Err(format!("invalid use source `{value}`")),
                }
            }
        }

        impl From<UseSource> for types::CliUseSource {
            fn from(value: UseSource) -> Self {
                match value {
                    $(
                        UseSource::$variant => Self::$generated,
                    )+
                }
            }
        }

        impl TryFrom<types::CliUseSource> for UseSource {
            type Error = ();

            fn try_from(value: types::CliUseSource) -> Result<Self, Self::Error> {
                match value {
                    $(
                        types::CliUseSource::$generated => Ok(Self::$variant),
                    )+
                    types::CliUseSource::CLI_USE_SOURCE_UNSPECIFIED => Err(()),
                }
            }
        }
    };
    (@count $($variant:ident),+) => {
        <[()]>::len(&[$(use_sources!(@replace $variant ())),+])
    };
    (@replace $_variant:ident $value:expr) => {
        $value
    };
}

// CONTEXT: Keep the `use` source surface in one declaration so CLI parsing,
// retry text, relay URLs, and generated enum conversions cannot drift apart.
use_sources! {
    Amplitude => {
        label: "amplitude",
        generated: CLI_USE_SOURCE_AMPLITUDE,
    },
    Ga => {
        label: "ga",
        generated: CLI_USE_SOURCE_GA,
    },
    Github => {
        label: "github",
        generated: CLI_USE_SOURCE_GITHUB,
    },
    Mixpanel => {
        label: "mixpanel",
        generated: CLI_USE_SOURCE_MIXPANEL,
    },
    Mongodb => {
        label: "mongodb",
        generated: CLI_USE_SOURCE_MONGODB,
    },
    Posthog => {
        label: "posthog",
        generated: CLI_USE_SOURCE_POSTHOG,
    },
    Sentry => {
        label: "sentry",
        generated: CLI_USE_SOURCE_SENTRY,
    },
}

#[cfg(test)]
mod tests {
    use pretty_assertions::assert_eq;

    use super::UseSource;
    use super::types;

    #[test]
    fn use_source_strings_round_trip_through_clap_values() {
        assert_eq!(
            UseSource::supported()
                .iter()
                .copied()
                .map(|source| source.to_string())
                .collect::<Vec<_>>(),
            UseSource::supported()
                .iter()
                .copied()
                .map(|source| source.as_str().parse::<UseSource>())
                .collect::<Result<Vec<_>, _>>()
                .expect("all supported use sources should parse")
                .iter()
                .map(ToString::to_string)
                .collect::<Vec<_>>()
        );
    }

    #[test]
    fn use_source_generated_values_round_trip_supported_surface() {
        assert_eq!(
            UseSource::supported().to_vec(),
            UseSource::supported()
                .iter()
                .copied()
                .map(types::CliUseSource::from)
                .map(UseSource::try_from)
                .collect::<Result<Vec<_>, _>>()
                .expect("supported use sources should convert from generated values")
        );
    }
}
