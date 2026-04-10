use serde::Serialize;

#[derive(Debug, Clone, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SanitizationMetadata {
    pub(crate) profile: String,
    pub(crate) sanitized_paths: Vec<String>,
    pub(crate) raw_available: bool,
}
