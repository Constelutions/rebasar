use crate::platform;

/// Resolves the host of an SSH remote the way the user's SSH configuration does, so that an
/// alias such as `github-personal` is seen for the `github.com` it stands for.
pub trait SshResolver: Send + Sync {
    /// The `hostname` of `alias`, or what went wrong asking `ssh`.
    fn hostname(&self, alias: &str) -> Result<String, String>;
}

pub struct SystemSsh;

impl SshResolver for SystemSsh {
    fn hostname(&self, alias: &str) -> Result<String, String> {
        // A name that starts with `-` is an option to `ssh`, and the remote URL is not ours.
        if alias.starts_with('-') {
            return Err(format!("{alias} is not a host name"));
        }
        let output = platform::ssh_command()
            .args(["-G", "--", alias])
            .output()
            .map_err(|error| format!("ssh is not available: {error}"))?;
        if !output.status.success() {
            let reason = String::from_utf8_lossy(&output.stderr);
            let reason = reason.trim();
            return Err(if reason.is_empty() {
                format!("ssh -G {alias} failed with {}", output.status)
            } else {
                format!("ssh -G {alias} failed: {reason}")
            });
        }

        String::from_utf8_lossy(&output.stdout)
            .lines()
            .find_map(|line| line.strip_prefix("hostname "))
            .map(|hostname| hostname.trim().to_owned())
            .ok_or_else(|| format!("ssh -G {alias} printed no hostname"))
    }
}
