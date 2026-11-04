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
    pub copy: CopySettings,
    pub tabs: TabSettings,
    pub history: HistorySettings,
    pub changes: ChangesSettings,
    pub commit: CommitSettings,
    pub editor: EditorSettings,
    pub branches: BranchesSettings,
}

/// What the Branches page lists when it opens.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct BranchesSettings {
    pub filter: BranchesFilter,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum BranchesFilter {
    #[default]
    Both,
    Local,
    Remote,
}

/// The editor the title bar opens a Worktree in with one click.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct EditorSettings {
    /// The id of the editor chosen last; none until one is used.
    pub last_used: Option<String>,
}

/// How the commit composer opens.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct CommitSettings {
    /// Starts with Sign off checked.
    pub sign_off_by_default: bool,
}

/// How a list of changed files is laid out.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FilesView {
    #[default]
    Tree,
    Flat,
}

/// Where a view puts the pane that opens beside its list.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SplitPosition {
    #[default]
    Right,
    Bottom,
}

/// How the Staged and Unstaged lists open, and where the diff of the selected file goes.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct ChangesSettings {
    pub files_view: FilesView,
    pub diff_position: SplitPosition,
}

/// The filters History opens with, before the user changes them in a Tab.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct HistorySettings {
    /// Starts with only the user's own commits.
    pub mine: bool,
    pub merges: bool,
    /// Off starts with the commits reachable from HEAD only.
    pub all_branches: bool,
    pub graph_style: GraphStyle,
    /// How the changed files of a commit are listed.
    pub files_view: FilesView,
    /// Where the details of the selected commit open.
    pub detail_position: SplitPosition,
}

impl Default for HistorySettings {
    fn default() -> Self {
        Self {
            mine: false,
            merges: false,
            all_branches: true,
            graph_style: GraphStyle::default(),
            files_view: FilesView::default(),
            detail_position: SplitPosition::default(),
        }
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum GraphStyle {
    #[default]
    Tree,
    Linear,
}

/// When closing a Tab asks first.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ConfirmTabClose {
    Always,
    /// An unsent commit message or an Operation in progress.
    #[default]
    WhenLost,
    Never,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct TabSettings {
    pub confirm_close: ConfirmTabClose,
    pub restore_on_launch: bool,
}

impl Default for TabSettings {
    fn default() -> Self {
        Self {
            confirm_close: ConfirmTabClose::default(),
            restore_on_launch: true,
        }
    }
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

/// What selecting text copies. Only file paths, commit hashes and the Output panel copy; diffs and
/// commit messages never do.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct CopySettings {
    pub on_select: bool,
    /// How many characters of a commit hash a click on it copies; none copies all of it.
    pub hash_length: Option<u8>,
}

impl CopySettings {
    pub const MIN_HASH_LENGTH: u8 = 4;
    /// The longest hash Git writes, a SHA-256 one.
    pub const MAX_HASH_LENGTH: u8 = 64;
}

impl Default for CopySettings {
    fn default() -> Self {
        Self {
            on_select: true,
            hash_length: None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct AppearanceSettings {
    pub code_font_size: u8,
    pub sidebar_collapsed: bool,
}

impl AppearanceSettings {
    /// Diff rows have a fixed height, so larger text would be clipped.
    pub const MIN_CODE_FONT_SIZE: u8 = 11;
    pub const MAX_CODE_FONT_SIZE: u8 = 14;
}

impl Default for AppearanceSettings {
    fn default() -> Self {
        Self {
            code_font_size: 12,
            sidebar_collapsed: false,
        }
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
        self.copy.hash_length = self
            .copy
            .hash_length
            .map(|length| length.clamp(CopySettings::MIN_HASH_LENGTH, CopySettings::MAX_HASH_LENGTH));
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
