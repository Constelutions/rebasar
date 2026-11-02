#![allow(dead_code)]

use std::env::consts::EXE_SUFFIX;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};
use std::time::{Duration, Instant};

use tempfile::TempDir;

/// An install folder holding the CLI and, optionally, a recorder standing in for the desktop app,
/// laid out the way the installers lay them out: side by side.
pub struct Install {
    folder: TempDir,
}

impl Install {
    pub fn with_app() -> Self {
        let install = Self::without_app();
        let app = install
            .folder
            .path()
            .join(format!("rebasar-app{EXE_SUFFIX}"));
        fs::copy(env!("CARGO_BIN_EXE_app-recorder"), app).expect("copy the recorder");
        install
    }

    pub fn without_app() -> Self {
        let folder = tempfile::tempdir().expect("temp dir");
        let cli = folder.path().join(format!("rebasar{EXE_SUFFIX}"));
        fs::copy(env!("CARGO_BIN_EXE_rebasar"), cli).expect("copy the CLI");
        Self { folder }
    }

    fn recording(&self) -> PathBuf {
        self.folder.path().join("recording.txt")
    }

    fn command(&self) -> Command {
        let mut command = Command::new(self.folder.path().join(format!("rebasar{EXE_SUFFIX}")));
        command.env("REBASAR_RECORDER_OUT", self.recording());
        command
    }

    pub fn run(&self, args: &[&str]) -> Output {
        self.command().args(args).output().expect("run rebasar")
    }

    /// Runs from `folder`, as a user does from a terminal, so relative paths resolve against it.
    pub fn run_in(&self, folder: &Path, args: &[&str]) -> Output {
        self.command()
            .current_dir(folder)
            .args(args)
            .output()
            .expect("run rebasar")
    }

    /// Runs with nothing on the PATH, so `git` cannot be found.
    pub fn run_without_git(&self, args: &[&str]) -> Output {
        self.command()
            .env("PATH", "")
            .args(args)
            .output()
            .expect("run rebasar")
    }

    /// The app is started detached, so what it recorded appears shortly after the CLI exits.
    pub fn app_arguments(&self) -> Option<String> {
        wait_for_file(&self.recording())
    }

    pub fn app_was_not_started(&self) -> bool {
        std::thread::sleep(Duration::from_millis(500));
        !self.recording().exists()
    }
}

fn wait_for_file(path: &Path) -> Option<String> {
    let deadline = Instant::now() + Duration::from_secs(10);
    while Instant::now() < deadline {
        if let Ok(text) = fs::read_to_string(path) {
            return Some(text);
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    None
}

pub fn stdout(output: &Output) -> String {
    String::from_utf8_lossy(&output.stdout).into_owned()
}

pub fn stderr(output: &Output) -> String {
    String::from_utf8_lossy(&output.stderr).into_owned()
}
