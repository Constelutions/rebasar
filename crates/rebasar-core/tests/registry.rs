use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use rebasar_core::{
    ApiError, CacheKind, Core, CoreEvent, Group, Head, RepositoryEntry, WindowBounds, WorktreeEntry,
};
use rebasar_testkit::TempRepo;
use serde_json::{json, Map, Value};
use tempfile::TempDir;

struct Config {
    dir: TempDir,
}

impl Config {
    fn new() -> Self {
        Self {
            dir: tempfile::tempdir().expect("temp dir"),
        }
    }

    fn file(&self) -> PathBuf {
        self.dir.path().join("config").join("registry.json")
    }

    /// A fresh core reading the registry file, as a new launch of the app would.
    fn launch(&self) -> Core {
        Core::new(|_| {}).with_registry_file(self.file())
    }

    fn launch_recording_events(&self) -> (Core, Arc<Mutex<Vec<CoreEvent>>>) {
        let events = Arc::new(Mutex::new(Vec::new()));
        let sink = Arc::clone(&events);
        let core = Core::new(move |event| sink.lock().unwrap().push(event))
            .with_registry_file(self.file());
        (core, events)
    }
}

fn canonical(path: &Path) -> String {
    dunce::canonicalize(path)
        .expect("canonicalize")
        .to_string_lossy()
        .into_owned()
}

fn sample(name: &str) -> TempRepo {
    let repo = TempRepo::init(name);
    repo.commit_file("README.md", "hello", "Initial commit");
    repo
}

fn on_main() -> Head {
    Head::Branch {
        name: "main".to_owned(),
    }
}

fn names(core: &Core) -> Vec<String> {
    core.repositories()
        .repositories
        .into_iter()
        .map(|repository| repository.name)
        .collect()
}

fn entry(core: &Core, repo: &TempRepo) -> RepositoryEntry {
    let path = canonical(repo.path());
    core.repositories()
        .repositories
        .into_iter()
        .find(|repository| repository.path == path)
        .expect("listed Repository")
}

fn group_names(core: &Core) -> Vec<String> {
    core.repositories()
        .groups
        .into_iter()
        .map(|group| group.name)
        .collect()
}

#[test]
fn a_repository_opened_in_one_run_is_listed_with_its_worktree_in_the_next() {
    let config = Config::new();
    let repo = sample("sample");
    config.launch().open_folder(repo.path()).expect("open");

    let listed = config.launch().repositories();

    assert_eq!(
        listed.repositories,
        vec![RepositoryEntry {
            path: canonical(repo.path()),
            name: "sample".to_owned(),
            group_id: None,
            missing: false,
            worktrees: vec![WorktreeEntry {
                path: canonical(repo.path()),
                main: true,
                head: on_main(),
            }],
        }]
    );
    assert!(listed.groups.is_empty());
}

#[test]
fn a_repository_opened_through_two_worktrees_is_listed_once_with_both_nested() {
    let config = Config::new();
    let repo = sample("sample");
    let hotfix = repo.add_worktree("sample-hotfix", "hotfix");
    let core = config.launch();
    core.open_folder(&hotfix).expect("open linked");
    core.open_folder(repo.path()).expect("open main");

    let repositories = config.launch().repositories().repositories;

    assert_eq!(repositories.len(), 1);
    assert_eq!(
        repositories[0].worktrees,
        vec![
            WorktreeEntry {
                path: canonical(repo.path()),
                main: true,
                head: on_main(),
            },
            WorktreeEntry {
                path: canonical(&hotfix),
                main: false,
                head: Head::Branch {
                    name: "hotfix".to_owned()
                },
            },
        ]
    );
}

#[test]
fn a_worktree_created_outside_the_app_shows_up_in_the_listing() {
    let config = Config::new();
    let repo = sample("sample");
    let core = config.launch();
    core.open_folder(repo.path()).expect("open");

    let docs = repo.add_worktree("sample-docs", "docs");

    let worktrees = entry(&core, &repo).worktrees;
    assert_eq!(worktrees.len(), 2);
    assert_eq!(worktrees[1].path, canonical(&docs));
}

#[test]
fn a_worktree_whose_folder_was_deleted_is_left_out_of_the_listing() {
    let config = Config::new();
    let repo = sample("sample");
    let hotfix = repo.add_worktree("sample-hotfix", "hotfix");
    let core = config.launch();
    core.open_folder(repo.path()).expect("open");
    fs::remove_dir_all(&hotfix).expect("delete worktree folder");

    let worktrees = entry(&core, &repo).worktrees;

    assert_eq!(worktrees.len(), 1);
    assert!(worktrees[0].main);
}

#[test]
fn everything_is_stored_in_one_file_in_the_config_directory() {
    let config = Config::new();
    let repo = sample("sample");
    let core = config.launch();
    core.open_folder(repo.path()).expect("open");
    core.create_group("Work").expect("create group");
    core.save_view("History");
    core.remember_window(1200, 700, false);

    let files: Vec<_> = fs::read_dir(config.file().parent().unwrap())
        .expect("config dir")
        .map(|file| file.unwrap().file_name().to_string_lossy().into_owned())
        .collect();

    assert_eq!(files, vec!["registry.json"]);
}

#[test]
fn a_core_without_a_registry_file_remembers_nothing_beyond_its_own_lifetime() {
    let repo = sample("sample");
    let core = Core::new(|_| {});
    core.open_folder(repo.path()).expect("open");

    assert_eq!(names(&core), vec!["sample"]);
    assert!(names(&Core::new(|_| {})).is_empty());
}

#[test]
fn groups_are_created_renamed_and_reordered_and_come_back_after_a_restart() {
    let config = Config::new();
    let core = config.launch();
    let work = core.create_group("Work").expect("create");
    core.create_group("  Personal ").expect("create");
    let oss = core.create_group("Open source").expect("create");

    core.rename_group(&work.id, "Day job").expect("rename");
    core.move_group(&oss.id, 0).expect("move");

    assert_eq!(
        group_names(&config.launch()),
        vec!["Open source", "Day job", "Personal"]
    );
}

#[test]
fn a_group_moved_beyond_the_end_goes_last() {
    let config = Config::new();
    let core = config.launch();
    let first = core.create_group("First").expect("create");
    core.create_group("Second").expect("create");

    core.move_group(&first.id, 99).expect("move");

    assert_eq!(group_names(&core), vec!["Second", "First"]);
}

#[test]
fn groups_created_after_a_restart_never_reuse_an_id() {
    let config = Config::new();
    let first = config.launch().create_group("First").expect("create");
    config.launch().create_group("Second").expect("create");
    config
        .launch()
        .rename_group(&first.id, "Renamed")
        .expect("rename");

    let ids: Vec<String> = config
        .launch()
        .repositories()
        .groups
        .into_iter()
        .map(|group| group.id)
        .collect();

    assert_eq!(ids.len(), 2);
    assert_ne!(ids[0], ids[1]);
}

#[test]
fn a_group_needs_a_name() {
    let core = Config::new().launch();
    let group = core.create_group("Work").expect("create");

    assert_eq!(core.create_group("   "), Err(ApiError::InvalidGroupName));
    assert_eq!(
        core.rename_group(&group.id, ""),
        Err(ApiError::InvalidGroupName)
    );
    assert_eq!(group_names(&core), vec!["Work"]);
}

#[test]
fn renaming_or_moving_an_unknown_group_is_reported() {
    let core = Config::new().launch();
    let unknown = ApiError::GroupNotFound {
        id: "nope".to_owned(),
    };

    assert_eq!(core.rename_group("nope", "Name"), Err(unknown.clone()));
    assert_eq!(core.move_group("nope", 0), Err(unknown));
}

#[test]
fn a_repository_belongs_to_at_most_one_group_and_returns_to_ungrouped() {
    let config = Config::new();
    let repo = sample("sample");
    let core = config.launch();
    core.open_folder(repo.path()).expect("open");
    let work = core.create_group("Work").expect("create");
    let personal = core.create_group("Personal").expect("create");
    let path = canonical(repo.path());

    core.move_repository(Path::new(&path), Some(&work.id))
        .expect("move to work");
    core.move_repository(Path::new(&path), Some(&personal.id))
        .expect("move to personal");

    let group_of = |core: &Core| entry(core, &repo).group_id;
    assert_eq!(group_of(&config.launch()), Some(personal.id.clone()));

    core.move_repository(Path::new(&path), None)
        .expect("move to ungrouped");

    assert_eq!(group_of(&config.launch()), None);
}

#[test]
fn a_repository_cannot_be_moved_to_an_unknown_group_or_from_an_unknown_path() {
    let repo = sample("sample");
    let core = Config::new().launch();
    core.open_folder(repo.path()).expect("open");
    let path = canonical(repo.path());

    assert_eq!(
        core.move_repository(Path::new(&path), Some("nope")),
        Err(ApiError::GroupNotFound {
            id: "nope".to_owned()
        })
    );
    assert_eq!(entry(&core, &repo).group_id, None);
    assert_eq!(
        core.move_repository(Path::new("C:\\elsewhere"), None),
        Err(ApiError::RepositoryNotFound {
            path: "C:\\elsewhere".to_owned()
        })
    );
}

#[test]
fn open_tabs_the_active_tab_and_the_view_are_restored_in_the_order_they_were_opened() {
    let config = Config::new();
    let app = sample("app");
    let tools = sample("tools");
    let core = config.launch();
    core.open_folder(app.path()).expect("open app");
    core.open_folder(tools.path()).expect("open tools");
    core.activate_tab(app.path()).expect("activate app");
    core.save_view("History");

    let session = config.launch().restore_session();

    assert_eq!(
        session
            .tabs
            .iter()
            .map(|tab| tab.repository_name.as_str())
            .collect::<Vec<_>>(),
        vec!["app", "tools"]
    );
    assert_eq!(session.tabs[0].head, on_main());
    assert_eq!(session.active, Some(canonical(app.path())));
    assert_eq!(session.view.as_deref(), Some("History"));
}

#[test]
fn a_first_launch_restores_an_empty_session() {
    let session = Config::new().launch().restore_session();

    assert!(session.tabs.is_empty());
    assert_eq!(session.active, None);
    assert_eq!(session.view, None);
}

#[test]
fn the_branch_shown_on_a_restored_tab_is_the_one_last_seen() {
    let config = Config::new();
    let repo = sample("sample");
    let core = config.launch();
    core.open_folder(repo.path()).expect("open");
    repo.git(&["switch", "--create", "feature"]);
    core.refresh_tab(repo.path()).expect("refresh");

    let session = config.launch().restore_session();

    assert_eq!(
        session.tabs[0].head,
        Head::Branch {
            name: "feature".to_owned()
        }
    );
}

#[test]
fn a_restored_tab_shows_what_was_last_seen_until_it_is_refreshed() {
    let config = Config::new();
    let repo = sample("sample");
    config.launch().open_folder(repo.path()).expect("open");
    repo.git(&["switch", "--create", "feature"]);

    let session = config.launch().restore_session();

    assert_eq!(session.tabs[0].head, on_main());
}

#[test]
fn a_tab_whose_worktree_folder_is_gone_is_not_restored_but_its_repository_still_is() {
    let config = Config::new();
    let repo = sample("sample");
    let hotfix = repo.add_worktree("sample-hotfix", "hotfix");
    let core = config.launch();
    core.open_folder(repo.path()).expect("open main");
    core.open_folder(&hotfix).expect("open linked");
    fs::remove_dir_all(&hotfix).expect("delete worktree folder");

    let session = config.launch().restore_session();

    assert_eq!(session.tabs.len(), 1);
    assert_eq!(session.tabs[0].worktree_path, canonical(repo.path()));
    assert_eq!(session.active, Some(canonical(repo.path())));
}

#[test]
fn a_repository_whose_folder_is_gone_stays_listed_as_missing_and_its_tabs_are_not_restored() {
    let config = Config::new();
    let repo = sample("sample");
    let work = {
        let core = config.launch();
        core.open_folder(repo.path()).expect("open");
        let work = core.create_group("Work").expect("create group");
        core.move_repository(Path::new(&canonical(repo.path())), Some(&work.id))
            .expect("move");
        work
    };
    let path = canonical(repo.path());
    fs::remove_dir_all(repo.path()).expect("delete repository");

    let relaunched = config.launch();
    let session = relaunched.restore_session();
    let listed = relaunched.repositories().repositories;

    assert!(session.tabs.is_empty());
    assert_eq!(session.active, None);
    assert_eq!(
        listed,
        vec![RepositoryEntry {
            path: path.clone(),
            name: "sample".to_owned(),
            group_id: Some(work.id),
            missing: true,
            worktrees: Vec::new(),
        }]
    );
    assert_eq!(config.launch().repositories().repositories, listed);
}

#[test]
fn listing_a_repository_found_missing_closes_its_tabs() {
    let config = Config::new();
    let repo = sample("sample");
    let other = sample("other");
    let (core, events) = config.launch_recording_events();
    let tab = core.open_folder(repo.path()).expect("open");
    core.open_folder(other.path()).expect("open other");
    fs::remove_dir_all(repo.path()).expect("delete repository");
    events.lock().unwrap().clear();

    core.repositories();

    assert_eq!(
        *events.lock().unwrap(),
        vec![CoreEvent::TabClosed {
            worktree_path: tab.worktree_path
        }]
    );
    assert_eq!(config.launch().restore_session().tabs.len(), 1);
}

#[test]
fn a_tab_closed_for_a_missing_repository_is_not_announced_again() {
    let config = Config::new();
    let repo = sample("sample");
    let (core, events) = config.launch_recording_events();
    core.open_folder(repo.path()).expect("open");
    fs::remove_dir_all(repo.path()).expect("delete repository");
    core.repositories();
    events.lock().unwrap().clear();

    core.repositories();

    assert!(events.lock().unwrap().is_empty());
}

#[test]
fn removing_a_repository_unlists_it_and_closes_its_tabs_but_keeps_the_folder() {
    let config = Config::new();
    let repo = sample("sample");
    let (core, events) = config.launch_recording_events();
    let tab = core.open_folder(repo.path()).expect("open");
    events.lock().unwrap().clear();

    core.remove_repository(Path::new(&canonical(repo.path())))
        .expect("remove");

    assert!(names(&config.launch()).is_empty());
    assert!(config.launch().restore_session().tabs.is_empty());
    assert_eq!(
        *events.lock().unwrap(),
        vec![CoreEvent::TabClosed {
            worktree_path: tab.worktree_path
        }]
    );
    assert!(repo.path().exists());
}

#[test]
fn removing_an_unknown_repository_is_reported() {
    let core = Config::new().launch();

    assert_eq!(
        core.remove_repository(Path::new("C:\\elsewhere")),
        Err(ApiError::RepositoryNotFound {
            path: "C:\\elsewhere".to_owned()
        })
    );
}

#[test]
fn locating_a_missing_repository_relists_it_in_its_group_with_its_worktrees() {
    let config = Config::new();
    let repo = sample("sample");
    let core = config.launch();
    core.open_folder(repo.path()).expect("open");
    let old = canonical(repo.path());
    let work = core.create_group("Work").expect("create group");
    core.move_repository(Path::new(&old), Some(&work.id))
        .expect("move");
    let moved_to = tempfile::tempdir().expect("temp dir");
    let new_folder = moved_to.path().join("relocated");
    fs::rename(repo.path(), &new_folder).expect("move repository folder");
    core.repositories();

    core.locate_repository(Path::new(&old), &new_folder)
        .expect("locate");

    let listed = config.launch().repositories().repositories;
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].path, canonical(&new_folder));
    assert_eq!(listed[0].name, "relocated");
    assert_eq!(listed[0].group_id, Some(work.id));
    assert!(!listed[0].missing);
    assert_eq!(listed[0].worktrees.len(), 1);
}

#[test]
fn locating_through_a_linked_worktree_finds_the_main_folder() {
    let config = Config::new();
    let repo = sample("sample");
    let hotfix = repo.add_worktree("sample-hotfix", "hotfix");
    let core = config.launch();
    core.open_folder(repo.path()).expect("open");
    let old = canonical(repo.path());

    core.locate_repository(Path::new(&old), &hotfix)
        .expect("locate");

    assert_eq!(
        config.launch().repositories().repositories[0].path,
        canonical(repo.path())
    );
}

#[test]
fn locating_a_folder_that_is_not_a_repository_changes_nothing() {
    let config = Config::new();
    let repo = sample("sample");
    let core = config.launch();
    core.open_folder(repo.path()).expect("open");
    let old = canonical(repo.path());
    let plain = tempfile::tempdir().expect("temp dir");

    let error = core
        .locate_repository(Path::new(&old), plain.path())
        .expect_err("not a repository");

    assert_eq!(
        error,
        ApiError::NotARepository {
            path: canonical(plain.path())
        }
    );
    assert_eq!(entry(&core, &repo).path, old);
}

#[test]
fn locating_a_repository_that_is_already_listed_merges_the_two_entries() {
    let config = Config::new();
    let first = sample("first");
    let second = sample("second");
    let core = config.launch();
    core.open_folder(first.path()).expect("open first");
    core.open_folder(second.path()).expect("open second");

    core.locate_repository(Path::new(&canonical(first.path())), second.path())
        .expect("locate");

    assert_eq!(names(&core), vec!["second"]);
}

#[test]
fn a_registry_file_that_cannot_be_read_is_set_aside_and_the_app_starts_empty() {
    let config = Config::new();
    let repo = sample("sample");
    fs::create_dir_all(config.file().parent().unwrap()).expect("config dir");
    fs::write(config.file(), "{ not json").expect("write garbage");

    let core = config.launch();
    assert!(names(&core).is_empty());
    core.open_folder(repo.path()).expect("open");

    let aside = config.file().with_extension("json.invalid");
    assert_eq!(fs::read_to_string(aside).unwrap(), "{ not json");
    assert_eq!(names(&config.launch()), vec!["sample"]);
}

#[test]
fn settings_are_stored_in_the_registry_and_come_back_after_a_restart() {
    let config = Config::new();
    let mut settings = Map::new();
    settings.insert("diff".to_owned(), json!({ "mode": "unified" }));
    config
        .launch()
        .save_settings(settings.clone())
        .expect("save settings");

    assert_eq!(config.launch().saved_settings(), settings);
}

#[test]
fn a_registry_file_without_some_sections_loads_with_those_sections_empty() {
    let config = Config::new();
    fs::create_dir_all(config.file().parent().unwrap()).expect("config dir");
    fs::write(
        config.file(),
        r#"{ "groups": [{ "id": "g", "name": "Work" }] }"#,
    )
    .expect("write file");

    let core = config.launch();

    assert_eq!(
        core.repositories().groups,
        vec![Group {
            id: "g".to_owned(),
            name: "Work".to_owned()
        }]
    );
    assert_eq!(core.saved_settings(), Map::<String, Value>::new());
}

#[test]
fn the_window_size_is_remembered_and_a_maximized_window_keeps_its_previous_size() {
    let config = Config::new();
    let core = config.launch();
    assert_eq!(core.window_bounds(), None);

    core.remember_window(1200, 700, false);
    assert_eq!(
        config.launch().window_bounds(),
        Some(WindowBounds {
            width: 1200,
            height: 700,
            maximized: false
        })
    );

    core.remember_window(1920, 1080, true);
    assert_eq!(
        config.launch().window_bounds(),
        Some(WindowBounds {
            width: 1200,
            height: 700,
            maximized: true
        })
    );
}

#[test]
fn a_window_without_a_size_is_not_remembered() {
    let core = Config::new().launch();
    core.remember_window(1200, 700, false);

    core.remember_window(0, 0, false);

    assert_eq!(
        core.window_bounds()
            .map(|bounds| (bounds.width, bounds.height)),
        Some((1200, 700))
    );
}

#[test]
fn a_restored_tab_watched_in_the_background_does_not_take_the_place_of_the_active_one() {
    let active = sample("active");
    let background = sample("background");
    let core = Core::new(|_| {});
    core.activate_tab(active.path()).expect("activate");

    core.watch_background_tab(background.path())
        .expect("watch in background");

    assert!(core.store_cache(active.path(), CacheKind::Graph, 1_u8));
    assert!(!core.store_cache(background.path(), CacheKind::Graph, 1_u8));
}
