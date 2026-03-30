use serde::Serialize;

#[derive(Debug, Clone, Eq, PartialEq, Default)]
pub(crate) struct UntrustedOutputMetadata {
    pub(crate) untrusted_paths: Vec<String>,
    pub(crate) sanitization: Option<SanitizationMetadata>,
}

impl UntrustedOutputMetadata {
    pub(crate) fn is_empty(&self) -> bool {
        self.untrusted_paths.is_empty() && self.sanitization.is_none()
    }
}

#[derive(Debug, Clone, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SanitizationMetadata {
    pub(crate) profile: String,
    pub(crate) sanitized_paths: Vec<String>,
    pub(crate) raw_available: bool,
}
