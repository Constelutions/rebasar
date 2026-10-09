use std::process::Command;

/// A `git` invocation that does not flash a console window when spawned from the GUI process.
pub fn git_command() -> Command {
    let mut command = Command::new("git");

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }

    command
}
