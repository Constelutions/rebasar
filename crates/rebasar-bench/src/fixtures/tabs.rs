use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use super::{git, snapshot, Scale};

const REPOSITORY_PREFIX: &str = "repo-";

pub fn generate(root: &Path, scale: &Scale) -> io::Result<()> {
    let linked = scale.tab_worktrees.saturating_sub(scale.tab_repositories);
    for index in 0..scale.tab_repositories {
        let repository = root.join(format!("{REPOSITORY_PREFIX}{index:02}"));
        git::init(&repository)?;
        snapshot::generate_worktree(&repository, scale.tab_files)?;

        let extra =
            linked / scale.tab_repositories + usize::from(index < linked % scale.tab_repositories);
        for number in 1..=extra {
            let worktree = root.join(format!("{REPOSITORY_PREFIX}{index:02}-wt-{number}"));
            let worktree = worktree.to_string_lossy();
            git::run(
                &repository,
                &[
                    "worktree",
                    "add",
                    "--quiet",
                    "-b",
                    &format!("wt-{number}"),
                    &worktree,
                ],
            )?;
        }
    }
    Ok(())
}

/// The fixture is built under a scratch name, and Git records the absolute paths of linked
/// Worktrees, so the links have to be pointed at the final location.
pub fn repair_after_move(root: &Path) -> io::Result<()> {
    for folder in worktrees(root)? {
        if folder.join(".git").is_file() {
            let main = main_worktree(root, &folder)?;
            git::run(
                &main,
                &["worktree", "repair", folder.to_string_lossy().as_ref()],
            )?;
        }
    }
    Ok(())
}

fn main_worktree(root: &Path, linked: &Path) -> io::Result<PathBuf> {
    let name = linked
        .file_name()
        .and_then(|name| name.to_str())
        .and_then(|name| name.split_once("-wt-"))
        .map(|(main, _)| main.to_owned())
        .ok_or_else(|| {
            io::Error::other(format!("{} is not a linked Worktree", linked.display()))
        })?;
    Ok(root.join(name))
}

pub fn worktrees(root: &Path) -> io::Result<Vec<PathBuf>> {
    let mut folders = Vec::new();
    for entry in fs::read_dir(root)? {
        let entry = entry?;
        if entry
            .file_name()
            .to_string_lossy()
            .starts_with(REPOSITORY_PREFIX)
        {
            folders.push(entry.path());
        }
    }
    folders.sort();
    Ok(folders)
}
