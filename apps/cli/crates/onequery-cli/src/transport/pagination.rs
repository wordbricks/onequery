use onequery_cli_core::error::ErrorStage;

use crate::transport::generated::types;
use crate::transport::http::ApiFailure;
use crate::transport::http::conversion_failure;
use crate::transport::read_controls::PageInfo;

pub(crate) fn page_info_from_generated(page: types::CliPage) -> PageInfo {
    PageInfo {
        next_cursor: page.next_cursor,
        returned: usize::try_from(page.returned).unwrap_or(usize::MAX),
        has_more: page.has_more,
    }
}

pub(crate) fn optional_page_size(
    page_size: Option<usize>,
    stage: ErrorStage,
) -> Result<Option<u32>, ApiFailure> {
    page_size
        .map(|page_size| {
            let page_size = u32::try_from(page_size)
                .map_err(|error| conversion_failure(stage, error.to_string()))?;
            (page_size > 0)
                .then_some(page_size)
                .ok_or_else(|| conversion_failure(stage, "page size must be greater than zero"))
        })
        .transpose()
}

#[cfg(test)]
mod tests {
    use onequery_cli_core::error::ErrorStage;
    use pretty_assertions::assert_eq;

    use crate::transport::http::conversion_failure;

    use super::optional_page_size;
    use super::page_info_from_generated;

    #[test]
    fn optional_page_size_rejects_zero() {
        let error =
            optional_page_size(Some(0), ErrorStage::ResolveOrg).expect_err("expected zero to fail");

        assert_eq!(
            error,
            conversion_failure(
                ErrorStage::ResolveOrg,
                "page size must be greater than zero"
            )
        );
    }

    #[test]
    fn page_info_from_generated_preserves_cursor_and_returned_count() {
        let page = serde_json::from_value(serde_json::json!({
            "nextCursor": "cursor_2",
            "returned": 2,
            "hasMore": true,
        }))
        .expect("expected generated page to deserialize");

        assert_eq!(
            page_info_from_generated(page),
            crate::transport::read_controls::PageInfo {
                next_cursor: Some("cursor_2".to_owned()),
                returned: 2,
                has_more: true,
            }
        );
    }
}
