use std::env::{self, consts::EXE_SUFFIX};
use std::process::{Command, ExitCode, Stdio};

const USAGE: &str = "\
Rebasar, a desktop Git client.

Usage:
  rebasar [path]    Open Rebasar. With a path, open the Worktree that contains it.
  rebasar help      Show this help.

Options:
  -h, --help        Show this help.
  -V, --version     Show the version.
";

enum Request {
    Help,
    Version,
    Open,
}

fn main() -> ExitCode {
    let arguments: Vec<String> = env::args().skip(1).collect();
    match parse(&arguments).and_then(run) {
        Ok(()) => ExitCode::SUCCESS,
        Err(message) => {
            eprintln!("rebasar: {message}");
            ExitCode::FAILURE
        }
    }
}

fn parse(arguments: &[String]) -> Result<Request, String> {
    match arguments.first().map(String::as_str) {
        None => Ok(Request::Open),
        Some("help" | "--help" | "-h") => Ok(Request::Help),
        Some("--version" | "-V") => Ok(Request::Version),
        Some(option) if option.starts_with('-') => {
            Err(format!("unknown option '{option}'. Try 'rebasar help'."))
        }
        Some(other) => Err(format!(
            "unexpected argument '{other}'. Try 'rebasar help'."
        )),
    }
}

fn run(request: Request) -> Result<(), String> {
    match request {
        Request::Help => print!("{USAGE}"),
        Request::Version => println!("rebasar {}", env!("CARGO_PKG_VERSION")),
        Request::Open => start_app()?,
    }
    Ok(())
}

/// Starts the desktop app that sits beside this executable, and does not wait for it.
fn start_app() -> Result<(), String> {
    let cli = env::current_exe().map_err(|error| format!("cannot locate itself: {error}"))?;
    let app = cli.with_file_name(format!("rebasar-app{EXE_SUFFIX}"));
    if !app.is_file() {
        return Err(format!(
            "could not find the Rebasar app at {}",
            app.display()
        ));
    }

    let mut command = Command::new(&app);
    command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    detach(&mut command);
    command.spawn().map_err(|error| {
        format!(
            "could not start the Rebasar app at {}: {error}",
            app.display()
        )
    })?;
    Ok(())
}

/// The app must outlive the terminal and its Ctrl+C, so it leaves this process's console and group.
#[cfg(windows)]
fn detach(command: &mut Command) {
    use std::os::windows::process::CommandExt;

    const DETACHED_PROCESS: u32 = 0x0000_0008;
    const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
    command.creation_flags(DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP);
}

#[cfg(unix)]
fn detach(command: &mut Command) {
    use std::os::unix::process::CommandExt;

    command.process_group(0);
}
