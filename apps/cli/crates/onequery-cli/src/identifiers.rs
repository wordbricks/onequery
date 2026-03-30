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

#[cfg(test)]
mod tests {
    use pretty_assertions::assert_eq;

    use super::is_public_id_format;
    use super::normalize_org_slug;
    use super::normalize_safe_path_segment;

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
