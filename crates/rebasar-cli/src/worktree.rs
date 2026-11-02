use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::process::Command;

/// The root of the Worktree that contains `path`, as `git` reports it.
///
/// `git` is already a requirement of the app, and it alone knows what a Worktree is: a plain
/// folder, a linked Worktree and the inside of a `.git` folder all answer differently.
pub fn containing(path: &Path) -> Result<PathBuf, String> {
    if !path.exists() {
        return Err(format!("{} does not exist", path.display()));
    }
    let folder = if path.is_dir() {
        path
    } else {
        path.parent().unwrap_or(path)
    };

    // Asked together so that a bare repository, which makes `--show-toplevel` fail, can still be
    // told apart from a folder that is not a repository at all.
    let output = Command::new("git")
        // The failures below are told apart by git's own wording, which a translated git changes.
        .env("LC_ALL", "C")
        .arg("-C")
        .arg(folder)
        .args(["rev-parse", "--is-bare-repository", "--show-toplevel"])
        .output()
        .map_err(|error| match error.kind() {
            ErrorKind::NotFound => {
                "git was not found; install Git and make sure it is on your PATH".to_owned()
            }
            _ => format!("could not run git: {error}"),
        })?;

    let answer = String::from_utf8_lossy(&output.stdout);
    let mut lines = answer.lines();
    if lines.next() == Some("true") {
        return Err(format!(
            "{} is a bare repository, which has no Worktree to open",
            path.display()
        ));
    }
    if output.status.success() {
        if let Some(root) = lines.next() {
            return Ok(PathBuf::from(root));
        }
    }

    let complaint = String::from_utf8_lossy(&output.stderr);
    let reason = complaint.lines().next().unwrap_or_default();
    if reason.contains("not a git repository") || reason.contains("work tree") || reason.is_empty()
    {
        Err(format!("{} is not inside a Git worktree", path.display()))
    } else {
        Err(format!("git could not read {}: {reason}", path.display()))
    }
}
