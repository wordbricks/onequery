use buffa::EnumValue;

use crate::transport::generated::types;
use crate::transport::source_connect_provider::SourceConnectProvider;

macro_rules! generated_label {
    (
        $name:ident,
        $enum_ty:ty,
        $unspecified:path,
        {
            $(
                $variant:path => $label:literal,
            )+
        }
    ) => {
        pub(crate) fn $name(value: EnumValue<$enum_ty>) -> String {
            match value.as_known() {
                $(
                    Some($variant) => $label.to_owned(),
                )+
                Some($unspecified) | None => value.to_string(),
            }
        }
    };
}

macro_rules! optional_generated_label {
    (
        $name:ident,
        $enum_ty:ty,
        $unspecified:path,
        {
            $(
                $variant:path => $label:literal,
            )+
        }
    ) => {
        pub(crate) fn $name(value: EnumValue<$enum_ty>) -> Option<String> {
            match value.as_known() {
                $(
                    Some($variant) => Some($label.to_owned()),
                )+
                Some($unspecified) => None,
                None => Some(value.to_string()),
            }
        }
    };
}

generated_label!(
    content_format_to_str,
    types::ContentFormat,
    types::ContentFormat::CONTENT_FORMAT_UNSPECIFIED,
    {
        types::ContentFormat::CONTENT_FORMAT_MARKDOWN => "markdown",
    }
);

pub(crate) fn source_provider_to_str(value: EnumValue<types::SourceProvider>) -> String {
    match value
        .as_known()
        .and_then(|provider| SourceConnectProvider::try_from(provider).ok())
    {
        Some(provider) => provider.to_string(),
        None => value.to_string(),
    }
}

generated_label!(
    source_status_to_str,
    types::SourceStatus,
    types::SourceStatus::SOURCE_STATUS_UNSPECIFIED,
    {
        types::SourceStatus::SOURCE_STATUS_ACTIVE => "active",
        types::SourceStatus::SOURCE_STATUS_ERROR => "error",
        types::SourceStatus::SOURCE_STATUS_DISCONNECTED => "disconnected",
    }
);

generated_label!(
    org_capability_to_str,
    types::OrgCapability,
    types::OrgCapability::ORG_CAPABILITY_UNSPECIFIED,
    {
        types::OrgCapability::ORG_CAPABILITY_ORG_LIST => "org.list",
        types::OrgCapability::ORG_CAPABILITY_ORG_READ => "org.read",
        types::OrgCapability::ORG_CAPABILITY_SOURCE_CONNECT => "source.connect",
        types::OrgCapability::ORG_CAPABILITY_SOURCE_LIST => "source.list",
        types::OrgCapability::ORG_CAPABILITY_SOURCE_READ => "source.read",
        types::OrgCapability::ORG_CAPABILITY_QUERY_EXECUTE => "query.execute",
        types::OrgCapability::ORG_CAPABILITY_SOURCE_API_DESCRIBE => "source_api.describe",
        types::OrgCapability::ORG_CAPABILITY_SOURCE_API_EXECUTE => "source_api.execute",
    }
);

optional_generated_label!(
    query_logical_type_to_str,
    types::QueryLogicalType,
    types::QueryLogicalType::QUERY_LOGICAL_TYPE_UNSPECIFIED,
    {
        types::QueryLogicalType::QUERY_LOGICAL_TYPE_STRING => "string",
        types::QueryLogicalType::QUERY_LOGICAL_TYPE_NUMBER => "number",
        types::QueryLogicalType::QUERY_LOGICAL_TYPE_BOOLEAN => "boolean",
        types::QueryLogicalType::QUERY_LOGICAL_TYPE_BIGINT => "bigint",
        types::QueryLogicalType::QUERY_LOGICAL_TYPE_DATETIME => "datetime",
        types::QueryLogicalType::QUERY_LOGICAL_TYPE_ARRAY => "array",
        types::QueryLogicalType::QUERY_LOGICAL_TYPE_JSON => "json",
    }
);

#[cfg(test)]
mod tests {
    use pretty_assertions::assert_eq;

    use super::content_format_to_str;
    use super::org_capability_to_str;
    use super::query_logical_type_to_str;
    use super::source_provider_to_str;
    use super::source_status_to_str;
    use super::types;
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
                .map(types::SourceProvider::from)
                .map(|provider| source_provider_to_str(provider.into()))
                .collect::<Vec<_>>()
        );
    }

    #[test]
    fn source_status_to_str_maps_known_values() {
        assert_eq!(
            [
                source_status_to_str(types::SourceStatus::SOURCE_STATUS_ACTIVE.into()),
                source_status_to_str(types::SourceStatus::SOURCE_STATUS_ERROR.into()),
                source_status_to_str(types::SourceStatus::SOURCE_STATUS_DISCONNECTED.into(),),
            ],
            [
                "active".to_owned(),
                "error".to_owned(),
                "disconnected".to_owned(),
            ]
        );
    }

    #[test]
    fn org_capability_to_str_maps_known_values() {
        assert_eq!(
            [
                org_capability_to_str(types::OrgCapability::ORG_CAPABILITY_ORG_LIST.into()),
                org_capability_to_str(
                    types::OrgCapability::ORG_CAPABILITY_SOURCE_API_DESCRIBE.into(),
                ),
                org_capability_to_str(
                    types::OrgCapability::ORG_CAPABILITY_SOURCE_API_EXECUTE.into(),
                ),
                org_capability_to_str(types::OrgCapability::ORG_CAPABILITY_QUERY_EXECUTE.into(),),
            ],
            [
                "org.list".to_owned(),
                "source_api.describe".to_owned(),
                "source_api.execute".to_owned(),
                "query.execute".to_owned(),
            ]
        );
    }

    #[test]
    fn query_logical_type_to_str_maps_known_values() {
        assert_eq!(
            Some("json".to_owned()),
            query_logical_type_to_str(types::QueryLogicalType::QUERY_LOGICAL_TYPE_JSON.into(),)
        );
    }

    #[test]
    fn content_format_to_str_maps_markdown() {
        assert_eq!(
            content_format_to_str(types::ContentFormat::CONTENT_FORMAT_MARKDOWN.into()),
            "markdown"
        );
    }
}
