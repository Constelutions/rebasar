use std::process::Command;

/// A `git` invocation that does not flash a console window when spawned from the GUI process.
pub fn git_command() -> Command {
    hidden_command("git")
}

pub fn gh_command() -> Command {
    hidden_command("gh")
}

fn hidden_command(program: &str) -> Command {
    let mut command = Command::new(program);

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }

    command
}
