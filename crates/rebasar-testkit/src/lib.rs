//! Temporary Git repositories built with the real `git` CLI, removed on drop.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use tempfile::TempDir;

pub struct TempRepo {
    root: TempDir,
    path: PathBuf,
}

impl TempRepo {
    /// Creates an initialised repository on branch `main` inside a folder called `name`.
    pub fn init(name: &str) -> Self {
        let root = tempfile::tempdir().expect("create temp dir");
        let path = root.path().join(name);
        fs::create_dir(&path).expect("create repository folder");
        let repo = Self { root, path };
        repo.git(&["init", "--initial-branch=main"]);
        repo
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn commit_file(&self, file_name: &str, contents: &str, message: &str) -> &Self {
        fs::write(self.path.join(file_name), contents).expect("write file");
        self.git(&["add", file_name]);
        self.git(&["commit", "--message", message]);
        self
    }

    pub fn detach_head(&self) -> &Self {
        self.git(&["checkout", "--detach"]);
        self
    }

    /// Adds a linked worktree on a new `branch`, living beside the repository folder.
    pub fn add_worktree(&self, folder_name: &str, branch: &str) -> PathBuf {
        let worktree_path = self.root.path().join(folder_name);
        self.git(&[
            "worktree",
            "add",
            "-b",
            branch,
            worktree_path.to_str().expect("utf-8 worktree path"),
        ]);
        worktree_path
    }

    pub fn head_commit(&self) -> String {
        self.git(&["rev-parse", "HEAD"]).trim().to_owned()
    }

    pub fn git(&self, args: &[&str]) -> String {
        let global_config = self.root.path().join("empty.gitconfig");
        let output = Command::new("git")
            .args(args)
            .current_dir(&self.path)
            .env("GIT_CONFIG_GLOBAL", &global_config)
            .env("GIT_CONFIG_NOSYSTEM", "1")
            .env("GIT_AUTHOR_NAME", "Test Author")
            .env("GIT_AUTHOR_EMAIL", "author@example.com")
            .env("GIT_COMMITTER_NAME", "Test Author")
            .env("GIT_COMMITTER_EMAIL", "author@example.com")
            .output()
            .expect("run git");
        assert!(
            output.status.success(),
            "git {args:?} failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        String::from_utf8_lossy(&output.stdout).into_owned()
    }
}
