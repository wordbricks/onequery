use serde::Deserialize;
use serde::Serialize;
#[derive(Debug, Clone, Default, Eq, PartialEq)]
pub(crate) struct ReadRequestControls {
    pub(crate) page_size: Option<usize>,
    pub(crate) cursor: Option<String>,
    pub(crate) page_all: bool,
}

impl ReadRequestControls {
    pub(crate) fn single_page(&self) -> SinglePageReadControls {
        SinglePageReadControls {
            page_size: self.page_size,
            cursor: self.cursor.clone(),
        }
    }

    pub(crate) fn with_cursor(&self, cursor: Option<String>) -> SinglePageReadControls {
        SinglePageReadControls {
            page_size: self.page_size,
            cursor,
        }
    }
}

#[derive(Debug, Clone, Default, Eq, PartialEq)]
pub(crate) struct SinglePageReadControls {
    pub(crate) page_size: Option<usize>,
    pub(crate) cursor: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PageInfo {
    pub(crate) next_cursor: Option<String>,
    pub(crate) returned: usize,
    pub(crate) has_more: bool,
}

impl PageInfo {
    pub(crate) fn aggregated(returned: usize) -> Self {
        Self {
            next_cursor: None,
            returned,
            has_more: false,
        }
    }
}
