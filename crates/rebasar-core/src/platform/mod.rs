//! The only place where operating-system differences are allowed to leak in.

mod browser;
mod credentials;
mod paths;
mod process;

pub use browser::open_in_browser;
pub use credentials::{os_credential_store, CredentialError, CredentialStore};
pub use paths::canonical;
pub use process::{gh_command, git_command, non_interactive_git_command, ssh_command, ProcessTree};
