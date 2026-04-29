use std::ffi::OsStr;
use std::path::Component;
use std::path::Path;
use std::path::PathBuf;

/// Return the nearest Git repository root for `base_dir`.
///
/// The check walks up the directory hierarchy looking for a `.git` file or
/// directory. It does not invoke `git`, and it returns the checkout root for
/// linked worktrees rather than the main repository root.
pub fn get_git_repo_root(base_dir: &Path) -> Option<PathBuf> {
    let base = if base_dir.is_dir() {
        base_dir
    } else {
        base_dir.parent()?
    };
    find_ancestor_git_entry(base).map(|(repo_root, _)| repo_root)
}

/// Resolve the root project used for repository-scoped decisions.
///
/// Regular repositories resolve to their nearest checkout root. Linked
/// worktrees resolve to the main repository root by inspecting the `.git`
/// pointer file without invoking `git`.
pub fn resolve_root_git_project(base_dir: &Path) -> Option<PathBuf> {
    let base = if base_dir.is_dir() {
        base_dir
    } else {
        base_dir.parent()?
    };
    let (repo_root, dot_git) = find_ancestor_git_entry(base)?;
    if dot_git.is_dir() {
        return Some(repo_root);
    }

    let git_dir_s = std::fs::read_to_string(&dot_git).ok()?;
    let git_dir_rel = git_dir_s.trim().strip_prefix("gitdir:")?.trim();
    if git_dir_rel.is_empty() {
        return None;
    }

    let git_dir_path = resolve_path_against_base(git_dir_rel, &repo_root);
    let worktrees_dir = git_dir_path.parent()?;
    if worktrees_dir.file_name() != Some(OsStr::new("worktrees")) {
        return None;
    }

    worktrees_dir.parent()?.parent().map(Path::to_path_buf)
}

fn find_ancestor_git_entry(base_dir: &Path) -> Option<(PathBuf, PathBuf)> {
    let mut dir = base_dir.to_path_buf();

    loop {
        let dot_git = dir.join(".git");
        if dot_git.exists() {
            return Some((dir, dot_git));
        }

        if !dir.pop() {
            break;
        }
    }

    None
}

fn resolve_path_against_base(path: &str, base_path: &Path) -> PathBuf {
    let path = Path::new(path);
    let path = if path.is_absolute() {
        path.to_path_buf()
    } else {
        base_path.join(path)
    };
    normalize_path_components(&path)
}

fn normalize_path_components(path: &Path) -> PathBuf {
    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                normalized.pop();
            }
            Component::Prefix(_) | Component::RootDir | Component::Normal(_) => {
                normalized.push(component.as_os_str());
            }
        }
    }
    normalized
}

#[cfg(test)]
mod tests {
    use std::fs;

    use pretty_assertions::assert_eq;
    use tempfile::TempDir;

    use super::*;

    #[test]
    fn get_git_repo_root_returns_none_outside_repo() -> std::io::Result<()> {
        let temp = TempDir::new()?;
        assert_eq!(get_git_repo_root(temp.path()), None);
        Ok(())
    }

    #[test]
    fn get_git_repo_root_returns_nearest_checkout_root() -> std::io::Result<()> {
        let temp = TempDir::new()?;
        let repo_root = temp.path().join("repo");
        let nested = repo_root.join("nested").join("child");
        fs::create_dir_all(repo_root.join(".git"))?;
        fs::create_dir_all(&nested)?;

        assert_eq!(get_git_repo_root(&nested), Some(repo_root));
        Ok(())
    }

    #[test]
    fn resolve_root_git_project_returns_regular_repo_root() -> std::io::Result<()> {
        let temp = TempDir::new()?;
        let repo_root = temp.path().join("repo");
        let nested = repo_root.join("nested").join("child");
        fs::create_dir_all(repo_root.join(".git"))?;
        fs::create_dir_all(&nested)?;

        assert_eq!(resolve_root_git_project(&nested), Some(repo_root));
        Ok(())
    }

    #[test]
    fn resolve_root_git_project_detects_worktree_pointer() -> std::io::Result<()> {
        let temp = TempDir::new()?;
        let repo_root = temp.path().join("repo");
        let common_dir = repo_root.join(".git");
        let worktree_git_dir = common_dir.join("worktrees").join("feature-x");
        let worktree_root = temp.path().join("wt");
        let nested = worktree_root.join("nested");
        fs::create_dir_all(&worktree_git_dir)?;
        fs::create_dir_all(&nested)?;
        fs::write(
            worktree_root.join(".git"),
            format!("gitdir: {}\n", worktree_git_dir.display()),
        )?;

        assert_eq!(resolve_root_git_project(&nested), Some(repo_root));
        Ok(())
    }

    #[test]
    fn resolve_root_git_project_detects_relative_worktree_pointer() -> std::io::Result<()> {
        let temp = TempDir::new()?;
        let repo_root = temp.path().join("repo");
        let worktree_git_dir = repo_root.join(".git").join("worktrees").join("feature-x");
        let worktree_root = repo_root.join("worktrees").join("feature-x");
        let nested = worktree_root.join("nested");
        fs::create_dir_all(&worktree_git_dir)?;
        fs::create_dir_all(&nested)?;
        fs::write(
            worktree_root.join(".git"),
            "gitdir: ../../.git/worktrees/feature-x\n",
        )?;

        assert_eq!(resolve_root_git_project(&nested), Some(repo_root));
        Ok(())
    }

    #[test]
    fn resolve_root_git_project_rejects_non_worktree_gitdir_file() -> std::io::Result<()> {
        let temp = TempDir::new()?;
        let repo_root = temp.path().join("repo");
        let non_worktree_git_dir = temp.path().join("somewhere");
        fs::create_dir_all(&repo_root)?;
        fs::create_dir_all(&non_worktree_git_dir)?;
        fs::write(
            repo_root.join(".git"),
            format!("gitdir: {}\n", non_worktree_git_dir.display()),
        )?;

        assert_eq!(resolve_root_git_project(&repo_root), None);
        Ok(())
    }
}
