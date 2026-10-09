use rebasar_core::platform;

#[test]
fn the_platform_layer_spawns_the_system_git() {
    let output = platform::git_command()
        .arg("--version")
        .output()
        .expect("spawn git");

    assert!(output.status.success());
    assert!(String::from_utf8_lossy(&output.stdout).starts_with("git version"));
}
