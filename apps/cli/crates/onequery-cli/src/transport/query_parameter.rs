use std::fmt;
use std::str::FromStr;

use buffa::EnumValue;
use serde::Deserialize;
use serde::Deserializer;
use serde::Serialize;
use serde::Serializer;

use crate::transport::generated::types;

macro_rules! query_parameter_types {
    (
        $(
            $variant:ident => {
                label: $label:literal,
                generated: $generated:ident,
            }
        ),+ $(,)?
    ) => {
        #[derive(Debug, Clone, Copy, Eq, PartialEq)]
        pub(crate) enum QueryRequestParameterType {
            $(
                $variant,
            )+
        }

        impl QueryRequestParameterType {
            fn from_input_str(value: &str) -> Result<Self, String> {
                match value {
                    $(
                        $label => Ok(Self::$variant),
                    )+
                    _ => Err(format!("invalid query parameter type `{value}`")),
                }
            }

            fn as_str(self) -> &'static str {
                match self {
                    $(
                        Self::$variant => $label,
                    )+
                }
            }
        }

        impl fmt::Display for QueryRequestParameterType {
            fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
                formatter.write_str(self.as_str())
            }
        }

        impl FromStr for QueryRequestParameterType {
            type Err = String;

            fn from_str(value: &str) -> Result<Self, Self::Err> {
                Self::from_input_str(value)
            }
        }

        impl Serialize for QueryRequestParameterType {
            fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
            where
                S: Serializer,
            {
                serializer.serialize_str(self.as_str())
            }
        }

        impl<'de> Deserialize<'de> for QueryRequestParameterType {
            fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
            where
                D: Deserializer<'de>,
            {
                let value = String::deserialize(deserializer)?;
                Self::from_input_str(value.as_str()).map_err(serde::de::Error::custom)
            }
        }

        impl From<QueryRequestParameterType> for types::CliQueryParameterType {
            fn from(value: QueryRequestParameterType) -> Self {
                match value {
                    $(
                        QueryRequestParameterType::$variant => Self::$generated,
                    )+
                }
            }
        }

        #[derive(Debug, Clone, Eq, PartialEq)]
        pub(crate) enum QueryCanonicalParameterType {
            $(
                $variant,
            )+
            Unknown(String),
        }

        impl QueryCanonicalParameterType {
            fn from_output_str(value: &str) -> Self {
                match value {
                    $(
                        $label => Self::$variant,
                    )+
                    _ => Self::Unknown(value.to_owned()),
                }
            }

            pub(crate) fn from_generated(value: EnumValue<types::CliQueryParameterType>) -> Self {
                match value.as_known() {
                    $(
                        Some(types::CliQueryParameterType::$generated) => Self::$variant,
                    )+
                    Some(types::CliQueryParameterType::CLI_QUERY_PARAMETER_TYPE_UNSPECIFIED)
                    | None => Self::Unknown(value.to_string()),
                }
            }

            fn as_str(&self) -> &str {
                match self {
                    $(
                        Self::$variant => $label,
                    )+
                    Self::Unknown(value) => value.as_str(),
                }
            }
        }

        impl fmt::Display for QueryCanonicalParameterType {
            fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
                formatter.write_str(self.as_str())
            }
        }

        impl Serialize for QueryCanonicalParameterType {
            fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
            where
                S: Serializer,
            {
                serializer.serialize_str(self.as_str())
            }
        }

        impl<'de> Deserialize<'de> for QueryCanonicalParameterType {
            fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
            where
                D: Deserializer<'de>,
            {
                let value = String::deserialize(deserializer)?;
                Ok(Self::from_output_str(value.as_str()))
            }
        }
    };
}

// CONTEXT: Request parameters must stay fully validated, while canonical output
// needs to preserve future server values without making those values sendable.
query_parameter_types! {
    String => {
        label: "string",
        generated: CLI_QUERY_PARAMETER_TYPE_STRING,
    },
    Number => {
        label: "number",
        generated: CLI_QUERY_PARAMETER_TYPE_NUMBER,
    },
    Boolean => {
        label: "boolean",
        generated: CLI_QUERY_PARAMETER_TYPE_BOOLEAN,
    },
    Null => {
        label: "null",
        generated: CLI_QUERY_PARAMETER_TYPE_NULL,
    },
}

#[derive(Debug, Clone, Deserialize, Serialize, Eq, PartialEq)]
pub(crate) struct QueryRequestParameter {
    #[serde(rename = "type")]
    pub(crate) parameter_type: QueryRequestParameterType,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) value: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, Eq, PartialEq)]
pub(crate) struct QueryCanonicalParameter {
    #[serde(rename = "type")]
    pub(crate) parameter_type: QueryCanonicalParameterType,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) value: Option<String>,
}

pub(crate) fn query_request_parameter_to_generated(
    parameter: QueryRequestParameter,
) -> types::CliQueryParameter {
    types::CliQueryParameter {
        r#type: types::CliQueryParameterType::from(parameter.parameter_type).into(),
        value: parameter.value,
        ..Default::default()
    }
}

pub(crate) fn query_canonical_parameter_from_generated(
    parameter: types::CliQueryParameter,
) -> QueryCanonicalParameter {
    QueryCanonicalParameter {
        parameter_type: QueryCanonicalParameterType::from_generated(parameter.r#type),
        value: parameter.value,
    }
}

#[cfg(test)]
mod tests {
    use pretty_assertions::assert_eq;
    use serde_json::json;

    use super::QueryCanonicalParameterType;
    use super::QueryRequestParameterType;
    use super::query_request_parameter_to_generated;
    use super::types;
    use crate::transport::query_parameter::QueryRequestParameter;

    #[test]
    fn query_request_parameter_type_json_round_trips_known_values() {
        assert_eq!(
            vec![
                QueryRequestParameterType::String,
                QueryRequestParameterType::Number,
                QueryRequestParameterType::Boolean,
                QueryRequestParameterType::Null,
            ],
            serde_json::from_value::<Vec<QueryRequestParameterType>>(json!([
                "string", "number", "boolean", "null"
            ]))
            .expect("known query parameter types should deserialize")
        );
        assert_eq!(
            json!(["string", "number", "boolean", "null"]),
            serde_json::to_value(vec![
                QueryRequestParameterType::String,
                QueryRequestParameterType::Number,
                QueryRequestParameterType::Boolean,
                QueryRequestParameterType::Null,
            ])
            .expect("known query parameter types should serialize")
        );
    }

    #[test]
    fn query_request_parameter_type_rejects_unknown_json_values() {
        let error = serde_json::from_value::<QueryRequestParameterType>(json!("uuid"))
            .expect_err("unknown query parameter types should fail");

        assert_eq!(error.to_string(), "invalid query parameter type `uuid`");
    }

    #[test]
    fn query_request_parameter_to_generated_maps_known_surface() {
        assert_eq!(
            types::CliQueryParameter {
                r#type: types::CliQueryParameterType::CLI_QUERY_PARAMETER_TYPE_BOOLEAN.into(),
                value: Some("true".to_owned()),
                ..Default::default()
            },
            query_request_parameter_to_generated(QueryRequestParameter {
                parameter_type: QueryRequestParameterType::Boolean,
                value: Some("true".to_owned()),
            })
        );
    }

    #[test]
    fn query_canonical_parameter_type_generated_values_round_trip_known_surface() {
        assert_eq!(
            vec![
                QueryCanonicalParameterType::String,
                QueryCanonicalParameterType::Number,
                QueryCanonicalParameterType::Boolean,
                QueryCanonicalParameterType::Null,
            ],
            [
                types::CliQueryParameterType::CLI_QUERY_PARAMETER_TYPE_STRING,
                types::CliQueryParameterType::CLI_QUERY_PARAMETER_TYPE_NUMBER,
                types::CliQueryParameterType::CLI_QUERY_PARAMETER_TYPE_BOOLEAN,
                types::CliQueryParameterType::CLI_QUERY_PARAMETER_TYPE_NULL,
            ]
            .into_iter()
            .map(Into::into)
            .map(QueryCanonicalParameterType::from_generated)
            .collect::<Vec<_>>()
        );
    }

    #[test]
    fn query_canonical_parameter_type_preserves_unknown_generated_values() {
        assert_eq!(
            QueryCanonicalParameterType::Unknown("CLI_QUERY_PARAMETER_TYPE_UNSPECIFIED".to_owned()),
            QueryCanonicalParameterType::from_generated(
                types::CliQueryParameterType::CLI_QUERY_PARAMETER_TYPE_UNSPECIFIED.into()
            )
        );
    }

    #[test]
    fn query_canonical_parameter_type_json_preserves_unknown_values() {
        assert_eq!(
            QueryCanonicalParameterType::Unknown("uuid".to_owned()),
            serde_json::from_value::<QueryCanonicalParameterType>(json!("uuid"))
                .expect("canonical output should preserve unknown values")
        );
        assert_eq!(
            json!("uuid"),
            serde_json::to_value(QueryCanonicalParameterType::Unknown("uuid".to_owned()))
                .expect("canonical output should serialize preserved unknown values")
        );
    }
}
