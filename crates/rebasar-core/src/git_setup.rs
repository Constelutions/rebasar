use std::fmt;

use serde::{Serialize, Serializer};

use crate::platform;

/// The oldest `git` the test suite runs against. It covers everything the app relies on:
/// `git restore` and `git switch`, `--initial-branch`, `GIT_CONFIG_GLOBAL` and the
/// `worktree` subcommands.
pub const MINIMUM_GIT_VERSION: GitVersion = GitVersion {
    major: 2,
    minor: 35,
    patch: 0,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct GitVersion {
    pub major: u32,
    pub minor: u32,
    pub patch: u32,
}

impl fmt::Display for GitVersion {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{}.{}.{}", self.major, self.minor, self.patch)
    }
}

impl Serialize for GitVersion {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.collect_str(self)
    }
}

impl GitVersion {
    /// Reads the output of `git --version`, e.g. `git version 2.35.1.windows.2`.
    fn parse(output: &str) -> Option<Self> {
        let version = output.trim().strip_prefix("git version ")?;
        let mut numbers = version
            .split('.')
            .map_while(|part| part.parse::<u32>().ok());
        Some(Self {
            major: numbers.next()?,
            minor: numbers.next()?,
            patch: numbers.next().unwrap_or(0),
        })
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum GitSetup {
    Ready {
        version: GitVersion,
    },
    Missing {
        minimum: GitVersion,
    },
    TooOld {
        version: GitVersion,
        minimum: GitVersion,
    },
}

impl GitSetup {
    /// `version_output` is what `git --version` printed, or `None` when it could not be run.
    pub fn from_version_output(version_output: Option<&str>) -> Self {
        let minimum = MINIMUM_GIT_VERSION;
        match version_output.and_then(GitVersion::parse) {
            None => Self::Missing { minimum },
            Some(version) if version < minimum => Self::TooOld { version, minimum },
            Some(version) => Self::Ready { version },
        }
    }

    pub(crate) fn check() -> Self {
        let output = platform::git_command()
            .arg("--version")
            .output()
            .ok()
            .filter(|output| output.status.success())
            .map(|output| String::from_utf8_lossy(&output.stdout).into_owned());
        Self::from_version_output(output.as_deref())
    }
}
