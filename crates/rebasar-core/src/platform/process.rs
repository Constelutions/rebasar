use std::io;
use std::process::{Child, Command, Stdio};

/// A `git` invocation that does not flash a console window when spawned from the GUI process.
pub fn git_command() -> Command {
    hidden_command("git")
}

pub fn ssh_command() -> Command {
    hidden_command("ssh")
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

    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }

    command
}

/// A spawned process together with everything it starts (hooks, credential helpers), so
/// that all of it can be ended at once. Killing `git` alone would leave its hooks running
/// and holding its output pipes open.
pub struct ProcessTree {
    #[cfg(windows)]
    job: JobHandle,
    #[cfg(unix)]
    group: u32,
}

#[cfg(windows)]
struct JobHandle(windows_sys::Win32::Foundation::HANDLE);

// A job handle is only ever used through thread-safe kernel calls.
#[cfg(windows)]
unsafe impl Send for JobHandle {}
#[cfg(windows)]
unsafe impl Sync for JobHandle {}

#[cfg(windows)]
impl Drop for JobHandle {
    fn drop(&mut self) {
        // Closing the handle does not end the processes: a detached `git gc --auto` must
        // be left to finish.
        unsafe { windows_sys::Win32::Foundation::CloseHandle(self.0) };
    }
}

impl ProcessTree {
    /// Call right after spawning; processes the child starts later belong to the tree.
    pub fn adopt(child: &Child) -> io::Result<Self> {
        #[cfg(windows)]
        {
            use std::os::windows::io::AsRawHandle;
            use windows_sys::Win32::System::JobObjects::{
                AssignProcessToJobObject, CreateJobObjectW,
            };

            let job = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
            if job.is_null() {
                return Err(io::Error::last_os_error());
            }
            let job = JobHandle(job);
            if unsafe { AssignProcessToJobObject(job.0, child.as_raw_handle()) } == 0 {
                return Err(io::Error::last_os_error());
            }
            Ok(Self { job })
        }

        #[cfg(unix)]
        {
            Ok(Self { group: child.id() })
        }
    }

    pub fn kill(&self) {
        #[cfg(windows)]
        {
            use windows_sys::Win32::System::JobObjects::TerminateJobObject;
            unsafe { TerminateJobObject(self.job.0, 1) };
        }

        #[cfg(unix)]
        {
            let _ = Command::new("kill")
                .args(["-KILL", "--", &format!("-{}", self.group)])
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status();
        }
    }
}
