use std::fs;

use rebasar_core::{
    ApiError, AppearanceSettings, ChangesSettings, ConfirmTabClose, Core, CopySettings, DiffMode,
    DiffSettings, FilesView, GraphStyle, HistoryOrientation, HistorySettings, Settings, SyncSettings, TabSettings,
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
        appearance: AppearanceSettings {
            code_font_size: 14,
            sidebar_collapsed: true,
        },
        sync: SyncSettings {
            auto_fetch: false,
            fetch_interval_minutes: 15,
        },
        copy: CopySettings {
            on_select: false,
        },
        tabs: TabSettings {
            confirm_close: ConfirmTabClose::Never,
            restore_on_launch: false,
        },
        history: HistorySettings {
            mine: true,
            merges: true,
            all_branches: false,
            orientation: HistoryOrientation::Horizontal,
            graph_style: GraphStyle::Tree,
            files_view: FilesView::Flat,
        },
        changes: ChangesSettings {
            files_view: FilesView::Flat,
        },
    }
}

#[test]
fn changed_files_start_as_a_tree_everywhere() {
    let settings = Settings::default();

    assert_eq!(settings.history.files_view, FilesView::Tree);
    assert_eq!(settings.changes.files_view, FilesView::Tree);
}

#[test]
fn settings_files_written_before_the_files_view_existed_still_load() {
    let dir = tempfile::tempdir().unwrap();
    fs::write(
        dir.path().join("settings.json"),
        r#"{ "history": { "mine": true } }"#,
    )
    .unwrap();

    let settings = core_in(dir.path()).settings().expect("settings");

    assert!(settings.history.mine);
    assert_eq!(settings.history.files_view, FilesView::Tree);
    assert_eq!(settings.changes.files_view, FilesView::Tree);
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
fn closing_a_tab_asks_only_when_something_would_be_lost_and_tabs_are_restored_by_default() {
    let tabs = Settings::default().tabs;

    assert_eq!(tabs.confirm_close, ConfirmTabClose::WhenLost);
    assert!(tabs.restore_on_launch);
}

#[test]
fn history_starts_showing_every_branch_and_everyone() {
    let history = Settings::default().history;

    assert!(history.all_branches);
    assert!(!history.mine);
    assert!(!history.merges);
}

#[test]
fn history_starts_vertical_as_a_tree() {
    let history = Settings::default().history;

    assert_eq!(history.orientation, HistoryOrientation::Vertical);
    assert_eq!(history.graph_style, GraphStyle::Tree);
}

#[test]
fn a_stored_horizontal_linear_history_becomes_horizontal_tree() {
    let dir = tempfile::tempdir().unwrap();
    fs::write(
        dir.path().join("settings.json"),
        r#"{ "history": { "orientation": "horizontal", "graphStyle": "linear" } }"#,
    )
    .unwrap();

    let history = core_in(dir.path()).settings().expect("settings").history;

    assert_eq!(history.orientation, HistoryOrientation::Horizontal);
    assert_eq!(history.graph_style, GraphStyle::Tree);
}

#[test]
fn saving_horizontal_linear_history_stores_horizontal_tree() {
    let dir = tempfile::tempdir().unwrap();
    let mut settings = Settings::default();
    settings.history.orientation = HistoryOrientation::Horizontal;
    settings.history.graph_style = GraphStyle::Linear;

    let saved = core_in(dir.path()).update_settings(&settings).expect("update");

    assert_eq!(saved.history.graph_style, GraphStyle::Tree);
}

#[test]
fn vertical_linear_history_is_kept() {
    let dir = tempfile::tempdir().unwrap();
    let mut settings = Settings::default();
    settings.history.graph_style = GraphStyle::Linear;

    let saved = core_in(dir.path()).update_settings(&settings).expect("update");

    assert_eq!(saved.history.orientation, HistoryOrientation::Vertical);
    assert_eq!(saved.history.graph_style, GraphStyle::Linear);
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
        appearance: AppearanceSettings {
            code_font_size: 40,
            ..AppearanceSettings::default()
        },
        ..Settings::default()
    };
    let too_small = Settings {
        appearance: AppearanceSettings {
            code_font_size: 2,
            ..AppearanceSettings::default()
        },
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

#[test]
fn selecting_text_copies_it_by_default() {
    assert!(Settings::default().copy.on_select);
}

#[test]
fn a_settings_file_from_before_copy_on_select_keeps_it_on() {
    let dir = tempfile::tempdir().unwrap();
    fs::write(
        dir.path().join("settings.json"),
        r#"{ "sync": { "autoFetch": false } }"#,
    )
    .unwrap();

    let settings = core_in(dir.path()).settings().expect("settings");

    assert!(settings.copy.on_select);
}
