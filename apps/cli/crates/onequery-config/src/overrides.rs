use toml::Value as TomlValue;

fn default_empty_table() -> TomlValue {
    TomlValue::Table(Default::default())
}

pub fn build_cli_overrides_layer(cli_overrides: &[(String, TomlValue)]) -> TomlValue {
    let mut root = default_empty_table();
    for (path, value) in cli_overrides {
        apply_toml_override(&mut root, path, value.clone());
    }
    root
}

fn apply_toml_override(root: &mut TomlValue, path: &str, value: TomlValue) {
    use toml::value::Table;

    let mut current = root;
    let mut segments_iter = path.split('.').peekable();

    while let Some(segment) = segments_iter.next() {
        let is_last = segments_iter.peek().is_none();

        if is_last {
            match current {
                TomlValue::Table(table) => {
                    table.insert(segment.to_owned(), value);
                }
                _ => {
                    let mut table = Table::new();
                    table.insert(segment.to_owned(), value);
                    *current = TomlValue::Table(table);
                }
            }
            return;
        }

        match current {
            TomlValue::Table(table) => {
                current = table
                    .entry(segment.to_owned())
                    .or_insert_with(|| TomlValue::Table(Table::new()));
            }
            _ => {
                *current = TomlValue::Table(Table::new());
                if let TomlValue::Table(table) = current {
                    current = table
                        .entry(segment.to_owned())
                        .or_insert_with(|| TomlValue::Table(Table::new()));
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use pretty_assertions::assert_eq;
    use toml::Value as TomlValue;

    use super::build_cli_overrides_layer;

    #[test]
    fn build_cli_overrides_layer_expands_dotted_paths() {
        let layer = build_cli_overrides_layer(&[
            (
                "query.output.format".to_owned(),
                TomlValue::String("json".to_owned()),
            ),
            ("query.timeout".to_owned(), TomlValue::Integer(15)),
        ]);

        let expected = toml::from_str::<TomlValue>(
            r#"
[query]
timeout = 15

[query.output]
format = "json"
"#,
        )
        .expect("expected TOML parse to succeed");

        assert_eq!(layer, expected);
    }
}
