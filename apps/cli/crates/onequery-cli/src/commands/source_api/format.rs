pub(super) fn push_section(lines: &mut Vec<String>, title: &str, values: &[String]) {
    if values.is_empty() {
        return;
    }

    if !lines.is_empty() {
        lines.push(String::new());
    }
    lines.push(title.to_owned());
    lines.extend(values.iter().cloned());
}

pub(super) fn status_line(status: u32) -> String {
    format!("HTTP {status}")
}
