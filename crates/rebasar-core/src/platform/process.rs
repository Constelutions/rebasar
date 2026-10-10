use std::process::{Command, Stdio};

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

/// A `git` invocation that can never wait for a person: the app has no terminal to answer
/// prompts on, so a prompt would hang the Repository's mutation queue forever.
pub fn non_interactive_git_command() -> Command {
    let mut command = git_command();
    command
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GCM_INTERACTIVE", "never")
        .env("GIT_EDITOR", "true")
        .stdin(Stdio::null());

    // A process group lets the whole tree (hooks, credential helpers) be killed on cancel.
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }

    command
}

/// Kills the process and everything it started. Killing `git` alone would leave its hooks
/// running and holding its output pipes open.
pub fn kill_process_tree(pid: u32) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let _ = Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .creation_flags(CREATE_NO_WINDOW)
            .status();
    }

    #[cfg(unix)]
    {
        let _ = Command::new("kill")
            .args(["-KILL", "--", &format!("-{pid}")])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
}
