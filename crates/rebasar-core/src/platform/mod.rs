//! The only place where operating-system differences are allowed to leak in.

mod paths;
mod process;

pub use paths::canonical;
pub use process::git_command;
