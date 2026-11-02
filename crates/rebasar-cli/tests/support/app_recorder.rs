use std::{env, fs};

fn main() {
    let out = env::var_os("REBASAR_RECORDER_OUT").expect("REBASAR_RECORDER_OUT");
    let arguments: Vec<String> = env::args().skip(1).collect();
    fs::write(out, arguments.join("\n")).expect("write the recording");
}
