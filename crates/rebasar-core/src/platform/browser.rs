use std::process::Command;

/// Opens an `https` address in the default browser. Anything else is refused, so a crafted
/// address can never make the system run a program or open a file.
pub fn open_in_browser(url: &str) -> Result<(), String> {
    if !url.starts_with("https://") || url.contains(char::is_whitespace) {
        return Err(format!("{url} is not an https address"));
    }

    #[cfg(windows)]
    let mut command = {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let mut command = Command::new("rundll32");
        command.args(["url.dll,FileProtocolHandler", url]);
        command.creation_flags(CREATE_NO_WINDOW);
        command
    };
    #[cfg(target_os = "macos")]
    let mut command = {
        let mut command = Command::new("open");
        command.arg(url);
        command
    };
    #[cfg(all(unix, not(target_os = "macos")))]
    let mut command = {
        let mut command = Command::new("xdg-open");
        command.arg(url);
        command
    };

    command
        .spawn()
        .map(drop)
        .map_err(|error| format!("could not open the browser: {error}"))
}
