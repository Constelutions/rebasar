use std::io;
use std::path::{Path, PathBuf};

/// Resolves symlinks, `..` segments and Windows 8.3 short names without the `\?\` verbatim
/// prefix, which `git` and most UI code do not expect.
pub fn canonical(path: &Path) -> io::Result<PathBuf> {
    dunce::canonicalize(path)
}
