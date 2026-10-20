use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::{ApiError, WhitespaceMode};

const FILE_NAME: &str = "settings.json";

/// Everything the Settings screen stores in the app's own file. The Git identity is not here:
/// it lives in the user's Git configuration.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Settings {
    pub diff: DiffSettings,
    pub appearance: AppearanceSettings,
    pub sync: SyncSettings,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct DiffSettings {
    pub whitespace: WhitespaceMode,
    pub default_mode: DiffMode,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DiffMode {
    #[default]
    Unified,
    SideBySide,
}

/// How the Tab in front keeps up with its remote.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct SyncSettings {
    pub auto_fetch: bool,
    pub fetch_interval_minutes: u32,
}

impl SyncSettings {
    pub const MIN_FETCH_INTERVAL_MINUTES: u32 = 1;
    pub const MAX_FETCH_INTERVAL_MINUTES: u32 = 120;
}

impl Default for SyncSettings {
    fn default() -> Self {
        Self {
            auto_fetch: true,
            fetch_interval_minutes: 5,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct AppearanceSettings {
    pub code_font_size: u8,
}

impl AppearanceSettings {
    /// Diff rows have a fixed height, so larger text would be clipped.
    pub const MIN_CODE_FONT_SIZE: u8 = 11;
    pub const MAX_CODE_FONT_SIZE: u8 = 14;
}

impl Default for AppearanceSettings {
    fn default() -> Self {
        Self { code_font_size: 12 }
    }
}

impl Settings {
    fn normalised(mut self) -> Self {
        self.appearance.code_font_size = self.appearance.code_font_size.clamp(
            AppearanceSettings::MIN_CODE_FONT_SIZE,
            AppearanceSettings::MAX_CODE_FONT_SIZE,
        );
        self.sync.fetch_interval_minutes = self.sync.fetch_interval_minutes.clamp(
            SyncSettings::MIN_FETCH_INTERVAL_MINUTES,
            SyncSettings::MAX_FETCH_INTERVAL_MINUTES,
        );
        self
    }
}

/// A missing or unreadable file yields the defaults, so a damaged file never locks the user
/// out of the screen that would repair it.
pub(crate) fn read(config_dir: &Path) -> Settings {
    fs::read_to_string(config_dir.join(FILE_NAME))
        .ok()
        .and_then(|text| serde_json::from_str::<Settings>(&text).ok())
        .unwrap_or_default()
        .normalised()
}

/// Writes to a sibling file first so a crash cannot leave a half-written settings file behind.
pub(crate) fn write(config_dir: &Path, settings: Settings) -> Result<Settings, ApiError> {
    let settings = settings.normalised();
    fs::create_dir_all(config_dir).map_err(ApiError::unexpected)?;
    let text = serde_json::to_string_pretty(&settings).map_err(ApiError::unexpected)?;
    let temporary = config_dir.join(format!("{FILE_NAME}.tmp"));
    fs::write(&temporary, text).map_err(ApiError::unexpected)?;
    fs::rename(&temporary, config_dir.join(FILE_NAME)).map_err(ApiError::unexpected)?;
    Ok(settings)
}
