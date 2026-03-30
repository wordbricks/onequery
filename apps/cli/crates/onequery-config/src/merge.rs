use toml::Value as TomlValue;

pub fn merge_toml_values(base: &mut TomlValue, overlay: &TomlValue) {
    if let TomlValue::Table(overlay_table) = overlay
        && let TomlValue::Table(base_table) = base
    {
        for (key, value) in overlay_table {
            if let Some(existing) = base_table.get_mut(key) {
                merge_toml_values(existing, value);
            } else {
                base_table.insert(key.clone(), value.clone());
            }
        }
    } else {
        *base = overlay.clone();
    }
}

#[cfg(test)]
mod tests {
    use pretty_assertions::assert_eq;
    use toml::Value as TomlValue;

    use super::merge_toml_values;

    #[test]
    fn merge_toml_values_recursively_overlays_nested_tables() {
        let mut base = toml::from_str::<TomlValue>(
            r#"
[query]
timeout = 60

[query.output]
format = "table"
"#,
        )
        .expect("expected base TOML to parse");
        let overlay = toml::from_str::<TomlValue>(
            r#"
[query.output]
format = "json"

[query.transport]
retries = 3
"#,
        )
        .expect("expected overlay TOML to parse");

        merge_toml_values(&mut base, &overlay);

        let expected = toml::from_str::<TomlValue>(
            r#"
[query]
timeout = 60

[query.output]
format = "json"

[query.transport]
retries = 3
"#,
        )
        .expect("expected merged TOML to parse");

        assert_eq!(base, expected);
    }
}
