use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::{platform::git_command, ApiError};

/// The name and email Git stamps on new commits, as set in one Git configuration. A value that is
/// not set there is `None`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GitIdentity {
    pub name: Option<String>,
    pub email: Option<String>,
}

const NAME_KEY: &str = "user.name";
const EMAIL_KEY: &str = "user.email";

/// `git config` exits with this when the key is not set.
const EXIT_KEY_NOT_SET: i32 = 1;
/// `git config --unset` exits with this when there was nothing to remove.
const EXIT_NOTHING_TO_UNSET: i32 = 5;

/// Which Git configuration an identity lives in. The Repository's is shared by all its Worktrees,
/// because `git config --local` writes to the common `config` file.
#[derive(Debug, Clone, Copy)]
pub(crate) enum Scope<'a> {
    Global,
    Repository(&'a Path),
}

impl Scope<'_> {
    fn config(self) -> std::process::Command {
        let mut command = git_command();
        match self {
            Scope::Global => command.args(["config", "--global"]),
            Scope::Repository(worktree_path) => command
                .current_dir(worktree_path)
                .args(["config", "--local"]),
        };
        command
    }
}

pub(crate) fn read(scope: Scope) -> Result<GitIdentity, ApiError> {
    Ok(GitIdentity {
        name: read_key(scope, NAME_KEY)?,
        email: read_key(scope, EMAIL_KEY)?,
    })
}

/// Stored through the user's own `git`, so the terminal and every other tool see the change.
pub(crate) fn write(scope: Scope, identity: &GitIdentity) -> Result<GitIdentity, ApiError> {
    write_key(scope, NAME_KEY, identity.name.as_deref())?;
    write_key(scope, EMAIL_KEY, identity.email.as_deref())?;
    read(scope)
}

fn read_key(scope: Scope, key: &str) -> Result<Option<String>, ApiError> {
    let output = scope
        .config()
        .args(["--get", key])
        .output()
        .map_err(ApiError::unexpected)?;
    match output.status.code() {
        Some(0) => Ok(Some(
            String::from_utf8_lossy(&output.stdout).trim().to_owned(),
        )),
        Some(EXIT_KEY_NOT_SET) => Ok(None),
        _ => Err(config_failure(&output)),
    }
}

fn write_key(scope: Scope, key: &str, value: Option<&str>) -> Result<(), ApiError> {
    let value = value.map(str::trim).filter(|value| !value.is_empty());
    let mut command = scope.config();
    match value {
        Some(value) => command.args([key, value]),
        None => command.args(["--unset", key]),
    };
    let output = command.output().map_err(ApiError::unexpected)?;
    match output.status.code() {
        Some(0) => Ok(()),
        Some(EXIT_NOTHING_TO_UNSET) if value.is_none() => Ok(()),
        _ => Err(config_failure(&output)),
    }
}

fn config_failure(output: &std::process::Output) -> ApiError {
    ApiError::Unexpected {
        message: format!(
            "git config failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ),
    }
}
