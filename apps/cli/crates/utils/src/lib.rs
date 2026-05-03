use std::io;
use std::path::Path;
use std::path::PathBuf;

/// Macro that derives a path to a crate-local resource at runtime.
///
/// This is expected to be used in test or build-time code. The macro reads
/// `CARGO_MANIFEST_DIR` at the call site so each crate resolves resources
/// relative to its own manifest directory.
#[macro_export]
macro_rules! find_resource {
    ($resource:expr) => {{
        let resource = std::path::Path::new(&$resource);
        let manifest_dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
        Ok::<std::path::PathBuf, std::io::Error>(manifest_dir.join(resource))
    }};
}

/// Include a repository-relative UTF-8 resource at compile time.
///
/// This macro is intended for crates under `apps/cli/crates/*`, which all have
/// the same depth from the repository root.
#[macro_export]
macro_rules! include_repo_resource_str {
    ($resource:literal) => {
        include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../../../",
            $resource
        ))
    };
}

/// Resolve a path relative to this crate's Cargo manifest directory.
pub fn resolve_cargo_resource(resource: &Path) -> io::Result<PathBuf> {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    Ok(manifest_dir.join(resource))
}

/// Resolve the top-level source repository root for local development.
pub fn repo_root() -> io::Result<PathBuf> {
    let mut root = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    for _ in 0..4 {
        root = root
            .parent()
            .ok_or_else(|| {
                io::Error::new(
                    io::ErrorKind::NotFound,
                    "CARGO_MANIFEST_DIR did not have expected parent depth",
                )
            })?
            .to_path_buf();
    }
    Ok(root)
}

/// Resolve a path relative to the top-level source repository root.
pub fn repo_path(path: impl AsRef<Path>) -> io::Result<PathBuf> {
    Ok(repo_root()?.join(path))
}

#[cfg(test)]
mod tests {
    use pretty_assertions::assert_eq;

    use super::*;

    #[test]
    fn repo_root_resolves_workspace_checkout_root() -> io::Result<()> {
        let root = repo_root()?;
        assert!(root.join("apps/cli/Cargo.toml").is_file());
        assert!(root.join("package.json").is_file());
        Ok(())
    }

    #[test]
    fn repo_path_resolves_under_workspace_checkout_root() -> io::Result<()> {
        assert_eq!(repo_path("apps/cli")?, repo_root()?.join("apps/cli"));
        Ok(())
    }

    #[test]
    fn find_resource_resolves_from_call_site_manifest_dir() -> io::Result<()> {
        let resource = find_resource!("Cargo.toml")?;
        assert!(resource.is_file());
        Ok(())
    }

    #[test]
    fn include_repo_resource_str_resolves_from_repo_root() {
        let package_json = include_repo_resource_str!("package.json");
        assert!(package_json.contains("onequery-workspace"));
    }
}
