use crate::SourceConnectGuide;
use crate::SourceConnectResult;

#[derive(Debug, Clone, Eq, PartialEq)]
pub struct SourceConnectRenderedOutput {
    pub lines: Vec<String>,
    pub data: SourceConnectRenderedData,
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub enum SourceConnectRenderedData {
    Guide(SourceConnectGuide),
    Result(SourceConnectResult),
}

pub fn render_source_connect_guide_output(
    guide: SourceConnectGuide,
) -> SourceConnectRenderedOutput {
    SourceConnectRenderedOutput {
        lines: guide.content.lines().map(ToOwned::to_owned).collect(),
        data: SourceConnectRenderedData::Guide(guide),
    }
}

pub fn render_source_connect_result_output(
    result: SourceConnectResult,
) -> SourceConnectRenderedOutput {
    let lines = vec![
        format!("Source connected: {}", &result.source.source_key),
        format!("Provider: {}", &result.source.provider),
        format!("Status: {}", &result.source.status),
        format!(
            "Interfaces: {}",
            format_source_interfaces(&result.source.interfaces)
        ),
        format!("Next: {}", result.next_command),
    ];

    SourceConnectRenderedOutput {
        lines,
        data: SourceConnectRenderedData::Result(result),
    }
}

fn format_source_interfaces(interfaces: &[String]) -> String {
    if interfaces.is_empty() {
        return "-".to_owned();
    }

    interfaces.join(",")
}
