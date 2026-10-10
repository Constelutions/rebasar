use std::fs;
use std::io::{self, Write};
use std::path::Path;

use super::git;

const AUTHOR: &str = "Author 0 <author0@example.com> 1500000000 +0000";

fn file_path(index: usize) -> String {
    format!(
        "dir-{}/sub-{}/file-{index}.txt",
        index / 1000,
        index % 1000 / 50
    )
}

/// Commits `files` files, in one commit, and checks them out.
fn commit_files(repo: &Path, files: usize, contents: impl Fn(usize) -> String) -> io::Result<()> {
    git::fast_import(repo, |out| {
        let message = "Add files\n";
        writeln!(out, "commit refs/heads/main")?;
        writeln!(out, "author {AUTHOR}")?;
        writeln!(out, "committer {AUTHOR}")?;
        writeln!(out, "data {}", message.len())?;
        out.write_all(message.as_bytes())?;
        for index in 0..files {
            let contents = contents(index);
            writeln!(out, "M 100644 inline {}", file_path(index))?;
            writeln!(out, "data {}", contents.len())?;
            out.write_all(contents.as_bytes())?;
            writeln!(out)?;
        }
        Ok(())
    })?;
    git::run(repo, &["reset", "--hard", "--quiet"])
}

pub fn generate_worktree(repo: &Path, files: usize) -> io::Result<()> {
    commit_files(repo, files, |index| format!("file {index}\n"))
}

/// Leaves `changed_lines` added and removed lines, spread evenly over `files` modified files,
/// uncommitted in the working tree: each file has its first lines replaced.
pub fn generate_changeset(repo: &Path, files: usize, changed_lines: usize) -> io::Result<()> {
    let changed_per_file = changed_lines / files;
    let replaced = changed_per_file / 2;
    let lines_per_file = changed_per_file.max(1);
    let content = |index: usize, edited: bool| -> String {
        (0..lines_per_file)
            .map(|line| match edited && line < replaced {
                true => format!("file {index} edited line {line}\n"),
                false => format!("file {index} line {line}\n"),
            })
            .collect()
    };

    commit_files(repo, files, |index| content(index, false))?;
    for index in 0..files {
        fs::write(repo.join(file_path(index)), content(index, true))?;
    }
    Ok(())
}
