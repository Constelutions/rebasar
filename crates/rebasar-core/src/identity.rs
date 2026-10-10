use serde::{Deserialize, Serialize};

use crate::{platform::git_command, ApiError};

/// The name and email Git stamps on new commits, as set in the user's global Git configuration.
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

pub(crate) fn read() -> Result<GitIdentity, ApiError> {
    Ok(GitIdentity {
        name: read_key(NAME_KEY)?,
        email: read_key(EMAIL_KEY)?,
    })
}

/// Stored through the user's own `git`, so the terminal and every other tool see the change.
pub(crate) fn write(identity: &GitIdentity) -> Result<GitIdentity, ApiError> {
    write_key(NAME_KEY, identity.name.as_deref())?;
    write_key(EMAIL_KEY, identity.email.as_deref())?;
    read()
}

fn read_key(key: &str) -> Result<Option<String>, ApiError> {
    let output = global_config()
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

fn write_key(key: &str, value: Option<&str>) -> Result<(), ApiError> {
    let value = value.map(str::trim).filter(|value| !value.is_empty());
    let mut command = global_config();
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

fn global_config() -> std::process::Command {
    let mut command = git_command();
    command.args(["config", "--global"]);
    command
}

fn config_failure(output: &std::process::Output) -> ApiError {
    ApiError::Unexpected {
        message: format!(
            "git config failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ),
    }
}
