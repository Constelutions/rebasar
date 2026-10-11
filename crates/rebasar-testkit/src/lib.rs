//! Temporary Git repositories built with the real `git` CLI, removed on drop.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, MutexGuard};

use tempfile::TempDir;

pub const AUTHOR_NAME: &str = "Test Author";
pub const AUTHOR_EMAIL: &str = "author@example.com";
const FIRST_COMMIT_TIME: u64 = 1_700_000_000;
const SECONDS_BETWEEN_COMMITS: u64 = 60;

static GLOBAL_CONFIG_LOCK: Mutex<()> = Mutex::new(());

/// Points the process's `git` at an empty, throwaway global configuration, so a test can read
/// and write `--global` settings without touching the developer's own.
///
/// The environment is shared by the whole test process, so holding one of these serialises the
/// tests that use it.
pub struct IsolatedGitConfig {
    _lock: MutexGuard<'static, ()>,
    root: TempDir,
}

impl IsolatedGitConfig {
    pub fn new() -> Self {
        let lock = GLOBAL_CONFIG_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let config = Self {
            _lock: lock,
            root: tempfile::tempdir().expect("create temp dir"),
        };
        std::env::set_var("GIT_CONFIG_GLOBAL", config.global_config_path());
        std::env::set_var("GIT_CONFIG_NOSYSTEM", "1");
        config
    }

    pub fn global_config_path(&self) -> PathBuf {
        self.root.path().join("global.gitconfig")
    }

    pub fn set_global(&self, key: &str, value: &str) {
        self.run(&["--file", &self.path_arg(), key, value]);
    }

    pub fn global(&self, key: &str) -> Option<String> {
        let output = Command::new("git")
            .args(["config", "--file", &self.path_arg(), "--get", key])
            .output()
            .expect("run git");
        output
            .status
            .success()
            .then(|| String::from_utf8_lossy(&output.stdout).trim().to_owned())
    }

    fn path_arg(&self) -> String {
        self.global_config_path()
            .to_str()
            .expect("utf-8 config path")
            .to_owned()
    }

    fn run(&self, args: &[&str]) {
        let output = Command::new("git")
            .arg("config")
            .args(args)
            .output()
            .expect("run git");
        assert!(
            output.status.success(),
            "git config {args:?} failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }
}

impl Default for IsolatedGitConfig {
    fn default() -> Self {
        Self::new()
    }
}

impl Drop for IsolatedGitConfig {
    fn drop(&mut self) {
        std::env::remove_var("GIT_CONFIG_GLOBAL");
        std::env::remove_var("GIT_CONFIG_NOSYSTEM");
    }
}

pub struct TempRepo {
    root: TempDir,
    path: PathBuf,
    commits_made: AtomicU64,
}

impl TempRepo {
    /// Creates an initialised repository on branch `main` inside a folder called `name`.
    pub fn init(name: &str) -> Self {
        let root = tempfile::tempdir().expect("create temp dir");
        let path = root.path().join(name);
        fs::create_dir(&path).expect("create repository folder");
        let repo = Self {
            root,
            path,
            commits_made: AtomicU64::new(0),
        };
        repo.git(&["init", "--initial-branch=main"]);
        // Set in the repository itself so the machine's own identity never leaks into a test.
        repo.git(&["config", "user.name", AUTHOR_NAME]);
        repo.git(&["config", "user.email", AUTHOR_EMAIL]);
        repo.git(&["config", "commit.gpgsign", "false"]);
        repo
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    /// `file_name` may sit in a folder (`src/a.txt`); the folder is created when missing.
    pub fn commit_file(&self, file_name: &str, contents: &str, message: &str) -> &Self {
        self.write_and_stage(file_name, contents);
        self.git(&["commit", "--message", message]);
        self
    }

    /// Writes `contents` without staging it, creating parent folders as needed.
    pub fn write_file(&self, relative_path: &str, contents: impl AsRef<[u8]>) -> &Self {
        let file = self.path.join(relative_path);
        if let Some(parent) = file.parent() {
            fs::create_dir_all(parent).expect("create parent folders");
        }
        fs::write(file, contents).expect("write file");
        self
    }

    pub fn delete_file(&self, relative_path: &str) -> &Self {
        fs::remove_file(self.path.join(relative_path)).expect("delete file");
        self
    }

    pub fn stage(&self, relative_path: &str) -> &Self {
        self.git(&["add", "--all", "--", relative_path]);
        self
    }

    /// Like [`Self::commit_file`], written by someone other than the repository's own identity.
    pub fn commit_file_as(
        &self,
        (name, email): (&str, &str),
        file_name: &str,
        contents: &str,
        message: &str,
    ) -> &Self {
        self.write_and_stage(file_name, contents);
        self.git_with(
            &["commit", "--message", message],
            &[("GIT_AUTHOR_NAME", name), ("GIT_AUTHOR_EMAIL", email)],
        );
        self
    }

    fn write_and_stage(&self, file_name: &str, contents: &str) {
        let file = self.path.join(file_name);
        if let Some(folder) = file.parent() {
            fs::create_dir_all(folder).expect("create folder");
        }
        fs::write(file, contents).expect("write file");
        self.git(&["add", file_name]);
    }

    /// Installs a hook that every Worktree of the repository runs, written as a `sh` script.
    pub fn install_hook(&self, name: &str, script: &str) -> &Self {
        let hook = self.path.join(".git").join("hooks").join(name);
        fs::write(&hook, format!("#!/bin/sh\n{script}\n")).expect("write hook");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&hook, fs::Permissions::from_mode(0o755))
                .expect("make hook executable");
        }
        self
    }

    pub fn detach_head(&self) -> &Self {
        self.git(&["checkout", "--detach"]);
        self
    }

    pub fn create_branch(&self, name: &str) -> &Self {
        self.git(&["checkout", "-b", name]);
        self
    }

    pub fn checkout(&self, name: &str) -> &Self {
        self.git(&["checkout", name]);
        self
    }

    /// Always records a merge commit, so the history shows the branch joining back.
    pub fn merge(&self, branch: &str) -> &Self {
        self.git(&[
            "merge",
            "--no-ff",
            "--message",
            &format!("Merge {branch}"),
            branch,
        ]);
        self
    }

    pub fn tag(&self, name: &str) -> &Self {
        self.git(&["tag", name]);
        self
    }

    /// Points `reference` (e.g. `refs/remotes/origin/main`) at the current commit.
    pub fn point_ref_at_head(&self, reference: &str) -> &Self {
        self.git(&["update-ref", reference, "HEAD"]);
        self
    }

    /// Commits with an explicit committer date, for histories whose clocks disagree.
    pub fn commit_file_dated(
        &self,
        file_name: &str,
        contents: &str,
        message: &str,
        unix_time: u64,
    ) -> &Self {
        fs::write(self.path.join(file_name), contents).expect("write file");
        self.git(&["add", file_name]);
        let date = format!("{unix_time} +0000");
        self.run_git(
            &["commit", "--message", message],
            &[("GIT_AUTHOR_DATE", &date), ("GIT_COMMITTER_DATE", &date)],
        );
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

    /// Adds a remote called `name` that is an empty bare repository beside this one.
    pub fn add_bare_remote(&self, name: &str) -> &Self {
        let remote_path = self.root.path().join(format!("{name}.git"));
        self.git(&[
            "init",
            "--bare",
            "--initial-branch=main",
            remote_path.to_str().expect("utf-8 remote path"),
        ]);
        self.git(&[
            "remote",
            "add",
            name,
            remote_path.to_str().expect("utf-8 remote path"),
        ]);
        self
    }

    pub fn head_commit(&self) -> String {
        self.git(&["rev-parse", "HEAD"]).trim().to_owned()
    }

    /// Commits and merges are dated one minute apart in the order they are made, so a history
    /// built in a test never has two commits in the same second.
    pub fn git(&self, args: &[&str]) -> String {
        self.git_with(args, &[])
    }

    fn git_with(&self, args: &[&str], extra_env: &[(&str, &str)]) -> String {
        let makes_commit = matches!(args.first(), Some(&"commit" | &"merge"));
        let date = if makes_commit {
            let made = self.commits_made.fetch_add(1, Ordering::Relaxed);
            format!(
                "{} +0000",
                FIRST_COMMIT_TIME + made * SECONDS_BETWEEN_COMMITS
            )
        } else {
            String::new()
        };
        let dates = [
            ("GIT_AUTHOR_DATE", date.as_str()),
            ("GIT_COMMITTER_DATE", date.as_str()),
        ];
        let mut env: Vec<(&str, &str)> = if makes_commit {
            dates.to_vec()
        } else {
            Vec::new()
        };
        env.extend_from_slice(extra_env);
        let output = self.run_git(args, &env);
        assert!(
            output.status.success(),
            "git {args:?} failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        String::from_utf8_lossy(&output.stdout).into_owned()
    }

    /// For commands that are expected to stop, such as a merge that conflicts.
    pub fn git_fails(&self, args: &[&str]) {
        let output = self.run_git(args, &[]);
        assert!(
            !output.status.success(),
            "git {args:?} was expected to fail"
        );
    }

    fn run_git(&self, args: &[&str], extra_env: &[(&str, &str)]) -> Output {
        let global_config = self.root.path().join("empty.gitconfig");
        Command::new("git")
            .args(args)
            .current_dir(&self.path)
            .env("GIT_CONFIG_GLOBAL", &global_config)
            .env("GIT_CONFIG_NOSYSTEM", "1")
            .env("GIT_AUTHOR_NAME", AUTHOR_NAME)
            .env("GIT_AUTHOR_EMAIL", AUTHOR_EMAIL)
            .env("GIT_COMMITTER_NAME", AUTHOR_NAME)
            .env("GIT_COMMITTER_EMAIL", AUTHOR_EMAIL)
            .envs(extra_env.iter().copied())
            .output()
            .expect("run git")
    }
}
