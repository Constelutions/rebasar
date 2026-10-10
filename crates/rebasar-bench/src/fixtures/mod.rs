use std::ffi::OsString;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use serde::Serialize;

mod git;
mod history;
mod snapshot;
mod tabs;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Scale {
    pub history_commits: usize,
    pub worktree_files: usize,
    pub changeset_files: usize,
    pub changeset_changed_lines: usize,
    pub tab_repositories: usize,
    /// Counts the main Worktree of every Repository, so the rest are linked ones.
    pub tab_worktrees: usize,
    pub tab_files: usize,
}

impl Scale {
    /// The alpha thresholds' reference sizes: a Linux-kernel-scale history, a 100k-file working
    /// tree and a 5,000-file / 500k-changed-line changeset.
    pub const ALPHA: Scale = Scale {
        history_commits: 1_200_000,
        worktree_files: 100_000,
        changeset_files: 5_000,
        changeset_changed_lines: 500_000,
        tab_repositories: 20,
        tab_worktrees: 50,
        tab_files: 200,
    };

    pub const SMOKE: Scale = Scale {
        history_commits: 500,
        worktree_files: 200,
        changeset_files: 20,
        changeset_changed_lines: 400,
        tab_repositories: 3,
        tab_worktrees: 5,
        tab_files: 10,
    };
}

pub struct FixtureCache {
    root: PathBuf,
}

impl FixtureCache {
    pub fn new(root: impl Into<PathBuf>) -> Self {
        Self { root: root.into() }
    }

    /// `REBASAR_FIXTURE_DIR`, else a `rebasar/fixtures` folder in the user's cache directory.
    pub fn default_location() -> Option<PathBuf> {
        Self::location_from(|name| std::env::var_os(name))
    }

    pub fn location_from(var: impl Fn(&str) -> Option<OsString>) -> Option<PathBuf> {
        if let Some(chosen) = var("REBASAR_FIXTURE_DIR") {
            return Some(PathBuf::from(chosen));
        }
        let user_cache = var("LOCALAPPDATA")
            .or_else(|| var("XDG_CACHE_HOME"))
            .map(PathBuf::from)
            .or_else(|| var("HOME").map(|home| PathBuf::from(home).join(".cache")))?;
        Some(user_cache.join("rebasar").join("fixtures"))
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn history(&self, scale: &Scale) -> io::Result<PathBuf> {
        let name = format!("history-{}-commits", scale.history_commits);
        self.ensure(&name, |path| history::generate(path, scale.history_commits))
    }

    pub fn worktree(&self, scale: &Scale) -> io::Result<PathBuf> {
        let name = format!("worktree-{}-files", scale.worktree_files);
        self.ensure(&name, |path| {
            snapshot::generate_worktree(path, scale.worktree_files)
        })
    }

    pub fn changeset(&self, scale: &Scale) -> io::Result<PathBuf> {
        let name = format!(
            "changeset-{}-files-{}-lines",
            scale.changeset_files, scale.changeset_changed_lines
        );
        self.ensure(&name, |path| {
            snapshot::generate_changeset(path, scale.changeset_files, scale.changeset_changed_lines)
        })
    }

    /// Many small Repositories with linked Worktrees, as a user with a crowded tab strip would
    /// have open. Returns the folder that holds them; see [`FixtureCache::tab_worktrees`].
    pub fn tabs(&self, scale: &Scale) -> io::Result<PathBuf> {
        let name = format!(
            "tabs-{}-repositories-{}-worktrees-{}-files",
            scale.tab_repositories, scale.tab_worktrees, scale.tab_files
        );
        self.ensure_with(
            &name,
            |path| tabs::generate(path, scale),
            tabs::repair_after_move,
        )
    }

    /// Every Worktree folder in a `tabs` fixture, in a stable order.
    pub fn tab_worktrees(fixture: &Path) -> io::Result<Vec<PathBuf>> {
        tabs::worktrees(fixture)
    }

    /// Builds `name` in a scratch folder and renames it into place, so an interrupted run never
    /// leaves a half-built fixture that the next run would trust.
    fn ensure(
        &self,
        name: &str,
        build: impl FnOnce(&Path) -> io::Result<()>,
    ) -> io::Result<PathBuf> {
        self.ensure_with(
            name,
            |scratch| {
                git::init(scratch)?;
                build(scratch)
            },
            |_| Ok(()),
        )
    }

    /// `after_move` runs once the fixture is in its final place, for anything that records
    /// absolute paths while it is built.
    fn ensure_with(
        &self,
        name: &str,
        build: impl FnOnce(&Path) -> io::Result<()>,
        after_move: impl FnOnce(&Path) -> io::Result<()>,
    ) -> io::Result<PathBuf> {
        let ready = self.root.join(name);
        if ready.exists() {
            return Ok(ready);
        }
        let scratch = self.root.join(format!("{name}.partial"));
        if scratch.exists() {
            fs::remove_dir_all(&scratch)?;
        }
        build(&scratch)?;
        fs::rename(&scratch, &ready)?;
        if let Err(error) = after_move(&ready) {
            let _ = fs::remove_dir_all(&ready);
            return Err(error);
        }
        Ok(ready)
    }
}
