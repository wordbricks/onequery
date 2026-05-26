use std::fmt;

#[derive(Debug, Clone, Eq, PartialEq, Hash)]
pub(crate) struct OrgSlug(String);

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub(crate) struct OrgSlugParseError;

impl OrgSlug {
    pub(crate) fn as_str(&self) -> &str {
        self.0.as_str()
    }
}

impl AsRef<str> for OrgSlug {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}

impl fmt::Display for OrgSlug {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.as_str())
    }
}

impl fmt::Display for OrgSlugParseError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("org must be a slug like acme-west")
    }
}

impl TryFrom<&str> for OrgSlug {
    type Error = OrgSlugParseError;

    fn try_from(value: &str) -> Result<Self, Self::Error> {
        normalize_org_slug(value)
            .map(|normalized| Self(normalized.to_owned()))
            .ok_or(OrgSlugParseError)
    }
}

impl TryFrom<String> for OrgSlug {
    type Error = OrgSlugParseError;

    fn try_from(value: String) -> Result<Self, Self::Error> {
        Self::try_from(value.as_str())
    }
}

impl From<OrgSlug> for String {
    fn from(value: OrgSlug) -> Self {
        value.0
    }
}

#[derive(Debug, Clone, Eq, PartialEq, Hash)]
pub(crate) struct SourceKey(String);

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub(crate) struct SourceKeyParseError;

#[derive(Debug, Clone, Eq, PartialEq, Hash)]
pub(crate) struct SourceReference(String);

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub(crate) struct SourceReferenceParseError;

impl SourceKey {
    pub(crate) fn as_str(&self) -> &str {
        self.0.as_str()
    }
}

impl AsRef<str> for SourceKey {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}

impl fmt::Display for SourceKey {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.as_str())
    }
}

impl fmt::Display for SourceKeyParseError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .write_str("source key must use only letters, numbers, dots, underscores, or hyphens")
    }
}

impl TryFrom<&str> for SourceKey {
    type Error = SourceKeyParseError;

    fn try_from(value: &str) -> Result<Self, Self::Error> {
        normalize_safe_path_segment(value)
            .map(|normalized| Self(normalized.to_owned()))
            .ok_or(SourceKeyParseError)
    }
}

impl TryFrom<String> for SourceKey {
    type Error = SourceKeyParseError;

    fn try_from(value: String) -> Result<Self, Self::Error> {
        Self::try_from(value.as_str())
    }
}

impl From<SourceKey> for String {
    fn from(value: SourceKey) -> Self {
        value.0
    }
}

impl SourceReference {
    pub(crate) fn as_str(&self) -> &str {
        self.0.as_str()
    }
}

impl AsRef<str> for SourceReference {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}

impl fmt::Display for SourceReference {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.as_str())
    }
}

impl fmt::Display for SourceReferenceParseError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(
            "source must look like provider://source-key and use only letters, numbers, dots, underscores, or hyphens in the source key",
        )
    }
}

impl TryFrom<&str> for SourceReference {
    type Error = SourceReferenceParseError;

    fn try_from(value: &str) -> Result<Self, Self::Error> {
        normalize_source_reference(value)
            .map(|normalized| Self(normalized.to_owned()))
            .ok_or(SourceReferenceParseError)
    }
}

impl TryFrom<String> for SourceReference {
    type Error = SourceReferenceParseError;

    fn try_from(value: String) -> Result<Self, Self::Error> {
        Self::try_from(value.as_str())
    }
}

impl From<SourceReference> for String {
    fn from(value: SourceReference) -> Self {
        value.0
    }
}

#[derive(Debug, Clone, Eq, PartialEq, Hash)]
pub(crate) struct RequestId(String);

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub(crate) struct RequestIdParseError;

pub(crate) const REQUEST_ID_PARSE_ERROR_MESSAGE: &str = "request ID must use only letters, numbers, underscores, hyphens, or equals signs and be at most 255 characters";

impl RequestId {
    pub(crate) fn as_str(&self) -> &str {
        self.0.as_str()
    }
}

impl AsRef<str> for RequestId {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}

impl fmt::Display for RequestId {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.as_str())
    }
}

impl fmt::Display for RequestIdParseError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(REQUEST_ID_PARSE_ERROR_MESSAGE)
    }
}

impl TryFrom<&str> for RequestId {
    type Error = RequestIdParseError;

    fn try_from(value: &str) -> Result<Self, Self::Error> {
        let normalized = value.trim();
        if !is_request_id_format(normalized) {
            return Err(RequestIdParseError);
        }

        Ok(Self(normalized.to_owned()))
    }
}

impl TryFrom<String> for RequestId {
    type Error = RequestIdParseError;

    fn try_from(value: String) -> Result<Self, Self::Error> {
        Self::try_from(value.as_str())
    }
}

impl From<RequestId> for String {
    fn from(value: RequestId) -> Self {
        value.0
    }
}

#[cfg(test)]
pub(crate) fn test_org_slug(value: &str) -> OrgSlug {
    OrgSlug::try_from(value)
        .unwrap_or_else(|error| panic!("expected valid org slug `{value}`: {error}"))
}

#[cfg(test)]
pub(crate) fn test_request_id(value: &str) -> RequestId {
    RequestId::try_from(value)
        .unwrap_or_else(|error| panic!("expected valid request ID `{value}`: {error}"))
}

#[cfg(test)]
pub(crate) fn test_source_reference(value: &str) -> SourceReference {
    SourceReference::try_from(value)
        .unwrap_or_else(|error| panic!("expected valid source reference `{value}`: {error}"))
}

pub(crate) fn normalize_org_slug(raw: &str) -> Option<&str> {
    let normalized = raw.trim();
    if normalized.is_empty() || !is_org_slug(normalized) {
        return None;
    }

    Some(normalized)
}

pub(crate) fn normalize_safe_path_segment(raw: &str) -> Option<&str> {
    let normalized = raw.trim();
    if normalized.is_empty() || normalized == "." || normalized == ".." {
        return None;
    }

    let first = normalized.chars().next()?;
    let last = normalized.chars().last()?;
    if !first.is_ascii_alphanumeric() || !last.is_ascii_alphanumeric() {
        return None;
    }

    if normalized.chars().any(|character| {
        character.is_control()
            || character.is_whitespace()
            || matches!(character, '/' | '\\' | '?' | '#' | '%')
    }) {
        return None;
    }

    if !normalized
        .chars()
        .all(|character| character.is_ascii_alphanumeric() || matches!(character, '.' | '-' | '_'))
    {
        return None;
    }

    Some(normalized)
}

pub(crate) fn normalize_source_reference(raw: &str) -> Option<&str> {
    let normalized = raw.trim();
    let (provider, source_key) = normalized.split_once("://")?;
    if !is_source_provider_scheme(provider) || normalize_safe_path_segment(source_key).is_none() {
        return None;
    }

    Some(normalized)
}

pub(crate) fn is_request_id_format(value: &str) -> bool {
    const REQUEST_ID_MAX_LEN: usize = 255;

    !value.is_empty()
        && value.len() <= REQUEST_ID_MAX_LEN
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-' | b'='))
}

#[cfg(test)]
pub(crate) fn is_public_id_format(value: &str) -> bool {
    let Some((prefix, number)) = value.split_once('-') else {
        return false;
    };
    let valid_prefix = !prefix.is_empty()
        && prefix
            .chars()
            .all(|character| character.is_ascii_uppercase() || character.is_ascii_digit());
    let valid_number =
        !number.is_empty() && number.chars().all(|character| character.is_ascii_digit());

    valid_prefix && valid_number
}

fn is_org_slug(value: &str) -> bool {
    let mut saw_character = false;
    let mut previous_was_dash = false;

    for character in value.chars() {
        if character.is_ascii_lowercase() || character.is_ascii_digit() {
            saw_character = true;
            previous_was_dash = false;
            continue;
        }

        if character == '-' && saw_character && !previous_was_dash {
            previous_was_dash = true;
            continue;
        }

        return false;
    }

    saw_character && !previous_was_dash
}

fn is_source_provider_scheme(value: &str) -> bool {
    let mut characters = value.chars();
    let Some(first) = characters.next() else {
        return false;
    };
    first.is_ascii_lowercase()
        && characters.all(|character| {
            character.is_ascii_lowercase() || character.is_ascii_digit() || character == '_'
        })
}

#[cfg(test)]
mod tests {
    use pretty_assertions::assert_eq;

    use super::OrgSlug;
    use super::REQUEST_ID_PARSE_ERROR_MESSAGE;
    use super::RequestId;
    use super::SourceKey;
    use super::SourceReference;
    use super::is_public_id_format;
    use super::normalize_org_slug;
    use super::normalize_safe_path_segment;
    use super::normalize_source_reference;

    #[test]
    fn normalize_org_slug_accepts_lowercase_slug() {
        assert_eq!(normalize_org_slug(" acme-west "), Some("acme-west"));
    }

    #[test]
    fn normalize_org_slug_rejects_invalid_slug_shapes() {
        assert_eq!(
            [
                normalize_org_slug("Acme"),
                normalize_org_slug("acme west"),
                normalize_org_slug("acme/ops"),
            ],
            [None, None, None]
        );
    }

    #[test]
    fn normalize_safe_path_segment_accepts_safe_ascii_segments() {
        assert_eq!(
            [
                normalize_safe_path_segment("warehouse"),
                normalize_safe_path_segment("team_slack"),
                normalize_safe_path_segment("github-main"),
                normalize_safe_path_segment("sales.daily"),
            ],
            [
                Some("warehouse"),
                Some("team_slack"),
                Some("github-main"),
                Some("sales.daily"),
            ]
        );
    }

    #[test]
    fn normalize_safe_path_segment_rejects_reserved_path_characters() {
        assert_eq!(
            [
                normalize_safe_path_segment("../warehouse"),
                normalize_safe_path_segment("warehouse/main"),
                normalize_safe_path_segment("%2e%2e"),
                normalize_safe_path_segment("ACME-13#draft"),
            ],
            [None, None, None, None]
        );
    }

    #[test]
    fn org_slug_type_parses_valid_slug() {
        assert_eq!(
            OrgSlug::try_from(" acme-west "),
            Ok(OrgSlug("acme-west".to_owned()))
        );
    }

    #[test]
    fn source_key_type_rejects_unsafe_path_segments() {
        assert_eq!(
            SourceKey::try_from("warehouse/main").map_err(|error| error.to_string()),
            Err(
                "source key must use only letters, numbers, dots, underscores, or hyphens"
                    .to_owned()
            )
        );
    }

    #[test]
    fn source_reference_type_parses_provider_prefixed_source_key() {
        assert_eq!(
            [
                SourceReference::try_from(" postgres://warehouse "),
                SourceReference::try_from("bigquery://bq-hello"),
                SourceReference::try_from("cloudflare_d1://prod.d1"),
            ],
            [
                Ok(SourceReference("postgres://warehouse".to_owned())),
                Ok(SourceReference("bigquery://bq-hello".to_owned())),
                Ok(SourceReference("cloudflare_d1://prod.d1".to_owned())),
            ]
        );
    }

    #[test]
    fn source_reference_type_rejects_bare_or_malformed_values() {
        assert_eq!(
            [
                SourceReference::try_from("warehouse").map_err(|error| error.to_string()),
                SourceReference::try_from("Postgres://warehouse")
                    .map_err(|error| error.to_string()),
                SourceReference::try_from("postgres://warehouse/main")
                    .map_err(|error| error.to_string()),
                SourceReference::try_from("postgres://").map_err(|error| error.to_string()),
            ],
            [
                Err("source must look like provider://source-key and use only letters, numbers, dots, underscores, or hyphens in the source key".to_owned()),
                Err("source must look like provider://source-key and use only letters, numbers, dots, underscores, or hyphens in the source key".to_owned()),
                Err("source must look like provider://source-key and use only letters, numbers, dots, underscores, or hyphens in the source key".to_owned()),
                Err("source must look like provider://source-key and use only letters, numbers, dots, underscores, or hyphens in the source key".to_owned()),
            ]
        );
    }

    #[test]
    fn normalize_source_reference_accepts_provider_prefixed_source_key() {
        assert_eq!(
            normalize_source_reference(" github://gh-bye "),
            Some("github://gh-bye")
        );
    }

    #[test]
    fn request_id_type_parses_hono_request_id_values() {
        assert_eq!(
            RequestId::try_from(" Req_123-abc= "),
            Ok(RequestId("Req_123-abc=".to_owned()))
        );
    }

    #[test]
    fn request_id_type_rejects_values_hono_would_replace() {
        let long_request_id = "a".repeat(256);

        assert_eq!(
            [
                RequestId::try_from("req\t123").map_err(|error| error.to_string()),
                RequestId::try_from("req.123").map_err(|error| error.to_string()),
                RequestId::try_from("req:123").map_err(|error| error.to_string()),
                RequestId::try_from(long_request_id.as_str()).map_err(|error| error.to_string()),
            ],
            [
                Err(REQUEST_ID_PARSE_ERROR_MESSAGE.to_owned()),
                Err(REQUEST_ID_PARSE_ERROR_MESSAGE.to_owned()),
                Err(REQUEST_ID_PARSE_ERROR_MESSAGE.to_owned()),
                Err(REQUEST_ID_PARSE_ERROR_MESSAGE.to_owned()),
            ]
        );
    }

    #[test]
    fn is_public_id_format_only_accepts_uppercase_prefixes_and_numeric_suffixes() {
        assert_eq!(
            [
                is_public_id_format("ACME-13"),
                is_public_id_format("not-valid"),
                is_public_id_format("ACME-thirteen"),
            ],
            [true, false, false]
        );
    }
}
