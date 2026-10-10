use std::io::{self, BufWriter, Write};
use std::path::Path;
use std::process::{ChildStdin, Command, Stdio};

use rebasar_core::platform::git_command;

fn failure(what: &str, stderr: &[u8]) -> io::Error {
    io::Error::other(format!(
        "{what} failed: {}",
        String::from_utf8_lossy(stderr)
    ))
}

pub fn run(repo: &Path, args: &[&str]) -> io::Result<()> {
    let output = git_command().args(args).current_dir(repo).output()?;
    if output.status.success() {
        return Ok(());
    }
    Err(failure(&format!("git {args:?}"), &output.stderr))
}

pub fn init(repo: &Path) -> io::Result<()> {
    std::fs::create_dir_all(repo)?;
    run(repo, &["init", "--quiet", "--initial-branch=main"])?;
    // Generated content is checked out and measured byte for byte on every platform.
    run(repo, &["config", "core.autocrlf", "false"])
}

/// Feeds `script` to a `git` subprocess that reads commands from stdin.
fn pipe_into(
    mut command: Command,
    script: impl FnOnce(&mut BufWriter<ChildStdin>) -> io::Result<()>,
) -> io::Result<()> {
    let mut child = command
        .stdin(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;
    let stdin = child.stdin.take().expect("stdin is piped");
    let mut writer = BufWriter::with_capacity(1 << 20, stdin);
    let written = script(&mut writer).and_then(|()| writer.flush());
    drop(writer);

    let output = child.wait_with_output()?;
    if !output.status.success() {
        return Err(failure("git", &output.stderr));
    }
    written
}

/// Streams a `git fast-import` script into `repo`, the only way to build a million commits in
/// minutes rather than hours.
pub fn fast_import(
    repo: &Path,
    script: impl FnOnce(&mut BufWriter<ChildStdin>) -> io::Result<()>,
) -> io::Result<()> {
    let mut command = git_command();
    command.args(["fast-import", "--quiet"]).current_dir(repo);
    pipe_into(command, script)
}

pub fn update_refs(repo: &Path, commands: &str) -> io::Result<()> {
    if commands.is_empty() {
        return Ok(());
    }
    let mut command = git_command();
    command.args(["update-ref", "--stdin"]).current_dir(repo);
    pipe_into(command, |stdin| stdin.write_all(commands.as_bytes()))
}
