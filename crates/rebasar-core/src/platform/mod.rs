//! The only place where operating-system differences are allowed to leak in.

mod credentials;
mod paths;
mod process;

pub use credentials::{os_credential_store, CredentialError, CredentialStore};
pub use paths::canonical;
pub use process::{gh_command, git_command, kill_process_tree, non_interactive_git_command};
