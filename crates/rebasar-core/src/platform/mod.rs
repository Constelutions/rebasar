//! The only place where operating-system differences are allowed to leak in.

mod browser;
mod credentials;
mod editors;
mod paths;
mod process;

pub use browser::open_in_browser;
pub use credentials::{os_credential_store, CredentialError, CredentialStore};
pub use editors::{detect_editors, open_in_editor, supported_editors, Editor, EditorDescriptor, Os, EDITORS};
pub use paths::canonical;
pub use process::{gh_command, git_command, non_interactive_git_command, ssh_command, ProcessTree};
