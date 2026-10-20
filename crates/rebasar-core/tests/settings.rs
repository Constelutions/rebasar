use std::fs;

use rebasar_core::{
    ApiError, AppearanceSettings, Core, DiffMode, DiffSettings, Settings, SyncSettings,
    WhitespaceMode,
};

fn core_in(dir: &std::path::Path) -> Core {
    Core::new(|_| {}).with_config_dir(dir.to_path_buf())
}

fn customised() -> Settings {
    Settings {
        diff: DiffSettings {
            whitespace: WhitespaceMode::IgnoreAll,
            default_mode: DiffMode::SideBySide,
        },
        appearance: AppearanceSettings { code_font_size: 14 },
        sync: SyncSettings {
            auto_fetch: false,
            fetch_interval_minutes: 15,
        },
    }
}

#[test]
fn settings_start_with_the_defaults() {
    let dir = tempfile::tempdir().unwrap();

    let settings = core_in(dir.path()).settings().expect("settings");

    assert_eq!(settings, Settings::default());
    assert_eq!(settings.diff.whitespace, WhitespaceMode::Show);
    assert_eq!(settings.diff.default_mode, DiffMode::Unified);
}

#[test]
fn updated_settings_are_returned_and_survive_a_restart() {
    let dir = tempfile::tempdir().unwrap();

    let saved = core_in(dir.path())
        .update_settings(&customised())
        .expect("update");
    let after_restart = core_in(dir.path()).settings().expect("settings");

    assert_eq!(saved, customised());
    assert_eq!(after_restart, customised());
}

#[test]
fn the_config_folder_is_created_when_the_first_setting_is_saved() {
    let dir = tempfile::tempdir().unwrap();
    let config_dir = dir.path().join("not").join("yet");

    core_in(&config_dir)
        .update_settings(&customised())
        .expect("update");

    assert!(config_dir.join("settings.json").is_file());
}

#[test]
fn settings_missing_from_the_file_fall_back_to_their_defaults() {
    let dir = tempfile::tempdir().unwrap();
    fs::write(
        dir.path().join("settings.json"),
        r#"{ "diff": { "whitespace": "ignoreAll" } }"#,
    )
    .unwrap();

    let settings = core_in(dir.path()).settings().expect("settings");

    assert_eq!(settings.diff.whitespace, WhitespaceMode::IgnoreAll);
    assert_eq!(settings.diff.default_mode, DiffMode::Unified);
    assert_eq!(settings.appearance, AppearanceSettings::default());
}

#[test]
fn an_unreadable_settings_file_falls_back_to_the_defaults() {
    let dir = tempfile::tempdir().unwrap();
    fs::write(dir.path().join("settings.json"), "{ not json").unwrap();

    let settings = core_in(dir.path()).settings().expect("settings");

    assert_eq!(settings, Settings::default());
}

#[test]
fn a_code_font_size_outside_the_supported_range_is_clamped() {
    let dir = tempfile::tempdir().unwrap();
    let core = core_in(dir.path());

    let too_big = Settings {
        appearance: AppearanceSettings { code_font_size: 40 },
        ..Settings::default()
    };
    let too_small = Settings {
        appearance: AppearanceSettings { code_font_size: 2 },
        ..Settings::default()
    };

    assert_eq!(
        core.update_settings(&too_big)
            .unwrap()
            .appearance
            .code_font_size,
        AppearanceSettings::MAX_CODE_FONT_SIZE
    );
    assert_eq!(
        core.update_settings(&too_small)
            .unwrap()
            .appearance
            .code_font_size,
        AppearanceSettings::MIN_CODE_FONT_SIZE
    );
}

#[test]
fn settings_cannot_be_used_without_a_config_folder() {
    let error = Core::new(|_| {}).settings().unwrap_err();

    assert!(matches!(error, ApiError::Unexpected { .. }));
}
