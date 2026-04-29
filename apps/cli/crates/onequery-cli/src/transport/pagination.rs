use onequery_core::error::ErrorStage;

use crate::transport::api_failure::ApiFailure;
use crate::transport::api_failure::conversion_failure;
use crate::transport::api_failure::try_into_option;
use crate::transport::generated::types;
use crate::transport::read_controls::PageInfo;
use crate::transport::read_controls::SinglePageReadControls;
use buffa::MessageField;

pub(crate) fn page_info_from_generated(page: types::CliPage) -> PageInfo {
    PageInfo {
        next_cursor: page.next_cursor,
        returned_count: page
            .returned_count
            .and_then(|count| usize::try_from(count).ok())
            .unwrap_or_default(),
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

pub(crate) fn page_request_from_controls(
    controls: SinglePageReadControls,
    stage: ErrorStage,
) -> Result<MessageField<types::CliPageRequest>, ApiFailure> {
    let cursor = try_into_option(controls.cursor.as_deref(), stage)?;
    let limit = optional_page_size(controls.page_size, stage)?;

    Ok(match (limit, cursor) {
        (None, None) => MessageField::none(),
        (limit, cursor) => MessageField::some(types::CliPageRequest {
            limit,
            cursor,
            ..Default::default()
        }),
    })
}

#[cfg(test)]
mod tests {
    use buffa::MessageField;
    use onequery_core::error::ErrorStage;
    use pretty_assertions::assert_eq;

    use crate::transport::api_failure::conversion_failure;
    use crate::transport::generated::types;
    use crate::transport::read_controls::SinglePageReadControls;

    use super::optional_page_size;
    use super::page_info_from_generated;
    use super::page_request_from_controls;

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
    fn page_request_from_controls_omits_page_when_no_controls_are_set() {
        let page =
            page_request_from_controls(SinglePageReadControls::default(), ErrorStage::ResolveOrg)
                .expect("expected empty controls to parse");

        assert_eq!(page, MessageField::none());
    }

    #[test]
    fn page_request_from_controls_preserves_explicit_limit_and_cursor() {
        let page = page_request_from_controls(
            SinglePageReadControls {
                page_size: Some(25),
                cursor: Some("cursor_2".to_owned()),
            },
            ErrorStage::ResolveOrg,
        )
        .expect("expected explicit controls to parse");

        assert_eq!(
            page,
            MessageField::some(types::CliPageRequest {
                limit: Some(25),
                cursor: Some("cursor_2".to_owned()),
                ..Default::default()
            })
        );
    }

    #[test]
    fn page_info_from_generated_preserves_cursor_and_returned_count() {
        let page = serde_json::from_value(serde_json::json!({
            "nextCursor": "cursor_2",
            "returnedCount": 2,
        }))
        .expect("expected generated page to deserialize");

        assert_eq!(
            page_info_from_generated(page),
            crate::transport::read_controls::PageInfo {
                next_cursor: Some("cursor_2".to_owned()),
                returned_count: 2,
            }
        );
    }
}
