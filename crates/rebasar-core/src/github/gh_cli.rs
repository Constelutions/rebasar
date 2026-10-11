use crate::platform;

/// The token of the user's own `gh` installation, so signing in there is enough.
pub trait GhCli: Send + Sync {
    /// `None` when `gh` is not installed or not signed in to github.com.
    fn token(&self) -> Option<String>;
}

pub struct SystemGhCli;

impl GhCli for SystemGhCli {
    fn token(&self) -> Option<String> {
        let output = platform::gh_command()
            .args(["auth", "token", "--hostname", "github.com"])
            .output()
            .ok()?;
        if !output.status.success() {
            return None;
        }
        let token = String::from_utf8(output.stdout).ok()?;
        let token = token.trim();
        (!token.is_empty()).then(|| token.to_owned())
    }
}
