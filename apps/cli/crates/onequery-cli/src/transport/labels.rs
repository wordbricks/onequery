use buffa::EnumValue;

use crate::transport::generated::types;
use crate::transport::source_connect_provider::SourceConnectProvider;

pub(crate) fn source_provider_to_str(value: EnumValue<types::SourceProvider>) -> String {
    match value
        .as_known()
        .and_then(|provider| SourceConnectProvider::try_from(provider).ok())
    {
        Some(provider) => provider.to_string(),
        None => value.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use pretty_assertions::assert_eq;

    use super::source_provider_to_str;
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
}
