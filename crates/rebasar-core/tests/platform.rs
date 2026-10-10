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

#[cfg(windows)]
#[test]
fn the_windows_credential_store_round_trips_a_secret() {
    let store = platform::os_credential_store();
    let account = format!("rebasar-test-{}", std::process::id());

    assert_eq!(store.read(&account), Ok(None));
    store.save(&account, "first").expect("save");
    store.save(&account, "second").expect("overwrite");
    assert_eq!(store.read(&account), Ok(Some("second".to_owned())));
    store.delete(&account).expect("delete");
    assert_eq!(store.read(&account), Ok(None));
    store.delete(&account).expect("deleting twice is fine");
}
