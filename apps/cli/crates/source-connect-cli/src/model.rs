use serde::Deserialize;
use serde::Serialize;

#[derive(Debug, Clone, Deserialize, Serialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SourceConnectGuide {
    pub title: String,
    pub description: String,
    pub format: String,
    pub content: String,
    pub command: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SourceConnectResult {
    pub source: SourceConnectSourceSummary,
    pub next_command: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SourceConnectSourceSummary {
    pub source_key: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
    pub provider: String,
    pub status: String,
    pub interfaces: Vec<String>,
}
