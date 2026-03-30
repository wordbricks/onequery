use std::env;
use std::fs;
use std::fs::File;
use std::path::Path;

fn main() {
    let spec_path = "../../../../packages/cli-contract/openapi/generated/cli.openapi.json";
    println!("cargo:rerun-if-changed={spec_path}");

    let file = match File::open(spec_path) {
        Ok(file) => file,
        Err(error) => panic!("expected checked-in CLI OpenAPI spec at {spec_path}: {error}"),
    };
    let spec = match serde_json::from_reader(file) {
        Ok(spec) => spec,
        Err(error) => panic!("expected valid OpenAPI JSON at {spec_path}: {error}"),
    };

    let mut settings = progenitor::GenerationSettings::default();
    settings.with_derive("PartialEq").with_derive("Eq");
    let mut generator = progenitor::Generator::new(&settings);

    let tokens = match generator.generate_tokens(&spec) {
        Ok(tokens) => tokens,
        Err(error) => panic!("expected progenitor client generation to succeed: {error}"),
    };
    let ast = match syn::parse2(tokens) {
        Ok(ast) => ast,
        Err(error) => panic!("expected progenitor tokens to parse: {error}"),
    };
    let content = prettyplease::unparse(&ast);

    let out_dir = match env::var("OUT_DIR") {
        Ok(out_dir) => out_dir,
        Err(error) => panic!("expected OUT_DIR: {error}"),
    };
    let mut out_file = Path::new(&out_dir).to_path_buf();
    out_file.push("cli_api.rs");

    if let Err(error) = fs::write(&out_file, content) {
        panic!(
            "expected generated client file write to succeed at {}: {error}",
            out_file.display()
        );
    }
}
