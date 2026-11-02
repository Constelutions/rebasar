use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use rebasar_core::{
    ApiError, Core, CoreEvent, FoundRepository, Group, MutationOutcome, OutputStream, Tab,
};
use rebasar_testkit::{TempRepo, Workspace};

struct Harness {
    core: Arc<Core>,
    events: Arc<Mutex<Vec<CoreEvent>>>,
}

impl Harness {
    fn new() -> Self {
        let events = Arc::new(Mutex::new(Vec::new()));
        let sink = Arc::clone(&events);
        let core = Core::new(move |event| sink.lock().unwrap().push(event));
        Self {
            core: Arc::new(core),
            events,
        }
    }

    fn events(&self) -> Vec<CoreEvent> {
        self.events.lock().unwrap().clone()
    }

    fn registered(&self) -> Vec<String> {
        self.core
            .repositories()
            .repositories
            .into_iter()
            .map(|repository| repository.name)
            .collect()
    }

    fn group_of(&self, name: &str) -> Option<String> {
        self.core
            .repositories()
            .repositories
            .into_iter()
            .find(|repository| repository.name == name)
            .and_then(|repository| repository.group_id)
    }

    fn create_group(&self, name: &str) -> Group {
        self.core.create_group(name).expect("create group")
    }
}

fn canonical(path: &Path) -> String {
    dunce::canonicalize(path)
        .expect("canonicalize")
        .to_string_lossy()
        .into_owned()
}

fn origin() -> TempRepo {
    let repo = TempRepo::init("origin");
    repo.commit_file("README.md", "hello", "Initial commit");
    repo
}

fn clone_of(harness: &Harness, source: &Path, parent: &Path) -> Result<Option<Tab>, ApiError> {
    harness
        .core
        .clone_repository(source.to_str().unwrap(), parent, None)
}

#[test]
fn cloning_a_repository_opens_it_as_a_tab_and_remembers_it() {
    let harness = Harness::new();
    let source = origin();
    let destination = Workspace::new();

    let tab = clone_of(&harness, source.path(), destination.path())
        .unwrap()
        .expect("the clone finished");

    assert_eq!(tab.repository_name, "origin");
    assert_eq!(
        tab.worktree_path,
        canonical(&destination.path().join("origin"))
    );
    assert!(destination.path().join("origin").join("README.md").exists());
    assert!(harness.events().contains(&CoreEvent::TabOpened { tab }));
    assert_eq!(harness.registered(), ["origin"]);
}

#[test]
fn a_clone_streams_its_progress_through_the_mutation_events() {
    let harness = Harness::new();
    let source = origin();
    let destination = Workspace::new();

    clone_of(&harness, source.path(), destination.path()).unwrap();

    let events = harness.events();
    assert!(events.iter().any(|event| matches!(
        event,
        CoreEvent::MutationQueued { mutation } if mutation.title.starts_with("Clone ")
    )));
    assert!(events.iter().any(|event| matches!(
        event,
        CoreEvent::MutationOutput { stream: OutputStream::Stderr, text, .. }
            if text.contains("Cloning into")
    )));
    assert!(events.iter().any(|event| matches!(
        event,
        CoreEvent::MutationFinished {
            outcome: MutationOutcome::Succeeded,
            ..
        }
    )));
}

#[test]
fn a_cloned_repository_can_be_placed_in_a_group() {
    let harness = Harness::new();
    let source = origin();
    let destination = Workspace::new();
    let work = harness.create_group("Work");

    harness
        .core
        .clone_repository(
            source.path().to_str().unwrap(),
            destination.path(),
            Some(&work.id),
        )
        .unwrap();

    assert_eq!(harness.group_of("origin"), Some(work.id));
}

#[test]
fn cloning_a_url_that_leads_nowhere_fails_with_a_clear_error_and_leaves_nothing_behind() {
    let harness = Harness::new();
    let destination = Workspace::new();
    let elsewhere = Workspace::new();
    let missing = elsewhere.path().join("nowhere");

    let error = clone_of(&harness, &missing, destination.path()).unwrap_err();

    assert_eq!(
        error,
        ApiError::GitFailed {
            message: "No Repository was found at that URL.".to_owned()
        }
    );
    assert!(!destination.path().join("nowhere").exists());
    assert!(harness.registered().is_empty());
    assert!(!harness
        .events()
        .iter()
        .any(|event| matches!(event, CoreEvent::TabOpened { .. })));
}

#[test]
fn cloning_into_a_folder_that_is_in_use_fails_without_touching_it() {
    let harness = Harness::new();
    let source = origin();
    let destination = Workspace::new();
    let taken = destination.create_folder("origin");
    fs::write(taken.join("notes.txt"), "mine").unwrap();

    let error = clone_of(&harness, source.path(), destination.path()).unwrap_err();

    assert!(
        matches!(&error, ApiError::GitFailed { message } if message.contains("already exists and is not empty")),
        "{error:?}"
    );
    assert_eq!(fs::read_to_string(taken.join("notes.txt")).unwrap(), "mine");
}

#[test]
fn a_clone_without_a_url_is_rejected() {
    let harness = Harness::new();
    let destination = Workspace::new();

    let error = harness
        .core
        .clone_repository("  ", destination.path(), None)
        .unwrap_err();

    assert!(matches!(error, ApiError::InvalidRepositoryUrl { .. }));
}

#[test]
fn cloning_into_a_missing_folder_is_an_error() {
    let harness = Harness::new();
    let source = origin();
    let destination = Workspace::new();

    let error = clone_of(&harness, source.path(), &destination.path().join("gone")).unwrap_err();

    assert!(matches!(error, ApiError::FolderNotFound { .. }));
}

#[test]
fn a_running_clone_can_be_cancelled_and_leaves_nothing_behind() {
    // A transport that never answers keeps the clone running until it is cancelled.
    std::env::set_var("GIT_CONFIG_COUNT", "1");
    std::env::set_var("GIT_CONFIG_KEY_0", "protocol.ext.allow");
    std::env::set_var("GIT_CONFIG_VALUE_0", "always");
    let harness = Harness::new();
    let destination = Workspace::new();
    let parent = destination.path().to_path_buf();

    let clone = {
        let core = Arc::clone(&harness.core);
        thread::spawn(move || core.clone_repository("ext::sleep 60", &parent, None))
    };
    let started = wait_for(&harness, |event| match event {
        CoreEvent::MutationStarted { mutation_id } => Some(*mutation_id),
        _ => None,
    });
    harness.core.cancel_mutation(started);

    assert_eq!(clone.join().unwrap().unwrap(), None);
    assert!(harness.registered().is_empty());
    assert!(fs::read_dir(destination.path()).unwrap().next().is_none());
}

#[test]
fn initializing_a_folder_creates_a_repository_and_opens_it() {
    let harness = Harness::new();
    let workspace = Workspace::new();
    let folder = workspace.create_folder("fresh");

    let tab = harness
        .core
        .init_repository(&folder, None)
        .unwrap()
        .expect("the initialization finished");

    assert!(folder.join(".git").is_dir());
    assert_eq!(tab.repository_name, "fresh");
    assert_eq!(tab.worktree_path, canonical(&folder));
    assert!(harness.events().contains(&CoreEvent::TabOpened { tab }));
    assert_eq!(harness.registered(), ["fresh"]);
}

#[test]
fn an_initialized_repository_can_be_placed_in_a_group() {
    let harness = Harness::new();
    let workspace = Workspace::new();
    let folder = workspace.create_folder("fresh");
    let personal = harness.create_group("Personal");

    harness
        .core
        .init_repository(&folder, Some(&personal.id))
        .unwrap();

    assert_eq!(harness.group_of("fresh"), Some(personal.id));
}

#[test]
fn initializing_a_folder_that_is_a_repository_already_is_an_error() {
    let harness = Harness::new();
    let source = origin();

    let error = harness
        .core
        .init_repository(source.path(), None)
        .unwrap_err();

    assert!(matches!(error, ApiError::AlreadyARepository { .. }));
}

#[test]
fn initializing_a_folder_that_does_not_exist_is_an_error() {
    let harness = Harness::new();
    let workspace = Workspace::new();

    let error = harness
        .core
        .init_repository(&workspace.path().join("gone"), None)
        .unwrap_err();

    assert!(matches!(error, ApiError::FolderNotFound { .. }));
}

#[test]
fn adding_to_a_group_that_does_not_exist_changes_nothing() {
    let harness = Harness::new();
    let workspace = Workspace::new();
    let folder = workspace.create_folder("fresh");

    let error = harness
        .core
        .init_repository(&folder, Some("group-9"))
        .unwrap_err();

    assert_eq!(
        error,
        ApiError::GroupNotFound {
            id: "group-9".to_owned()
        }
    );
    assert!(!folder.join(".git").exists());
}

fn found(harness: &Harness, parent: &Path) -> Vec<FoundRepository> {
    harness.core.scan_folder(parent).unwrap()
}

fn relative_paths(parent: &Path, found: &[FoundRepository]) -> Vec<String> {
    let parent = canonical(parent);
    found
        .iter()
        .map(|repository| {
            Path::new(&repository.path)
                .strip_prefix(&parent)
                .unwrap()
                .to_string_lossy()
                .replace('\\', "/")
        })
        .collect()
}

#[test]
fn a_scan_lists_the_repositories_below_a_folder() {
    let harness = Harness::new();
    let workspace = Workspace::new();
    workspace.init_repository("beta");
    workspace.init_repository("clients/acme/alpha");
    workspace.create_folder("notes");

    let repositories = found(&harness, workspace.path());

    assert_eq!(
        relative_paths(workspace.path(), &repositories),
        ["beta", "clients/acme/alpha"]
    );
    assert_eq!(repositories[0].name, "beta");
    assert!(repositories.iter().all(|repository| !repository.already_added));
}

#[test]
fn a_scan_lists_the_folder_itself_when_it_is_a_repository() {
    let harness = Harness::new();
    let source = origin();

    let repositories = found(&harness, source.path());

    assert_eq!(repositories.len(), 1);
    assert_eq!(repositories[0].path, canonical(source.path()));
}

#[test]
fn a_scan_does_not_look_inside_repositories_or_into_vendored_hidden_and_linked_folders() {
    let harness = Harness::new();
    let workspace = Workspace::new();
    workspace.init_repository("outer");
    workspace.init_repository("outer/vendor/inner");
    workspace.init_repository("node_modules/package");
    workspace.init_repository(".cache/hidden");
    let linked = workspace.create_folder("linked");
    fs::write(linked.join(".git"), "gitdir: ../outer/.git/worktrees/linked").unwrap();

    let repositories = found(&harness, workspace.path());

    assert_eq!(relative_paths(workspace.path(), &repositories), ["outer"]);
}

#[test]
fn a_scan_stops_after_a_few_levels() {
    let harness = Harness::new();
    let workspace = Workspace::new();
    workspace.init_repository("a/b/c/d");
    workspace.init_repository("a/b/c/d2/e");

    let repositories = found(&harness, workspace.path());

    assert_eq!(relative_paths(workspace.path(), &repositories), ["a/b/c/d"]);
}

#[test]
fn a_scan_marks_the_repositories_that_were_added_already() {
    let harness = Harness::new();
    let workspace = Workspace::new();
    let known = workspace.init_repository("known");
    workspace.init_repository("fresh");
    harness.core.open_folder(&known).unwrap();

    let repositories = found(&harness, workspace.path());

    let flags: Vec<(String, bool)> = repositories
        .into_iter()
        .map(|repository| (repository.name, repository.already_added))
        .collect();
    assert_eq!(
        flags,
        [("fresh".to_owned(), false), ("known".to_owned(), true)]
    );
}

#[test]
fn a_scan_remembers_nothing() {
    let harness = Harness::new();
    let workspace = Workspace::new();
    workspace.init_repository("beta");

    found(&harness, workspace.path());

    assert!(harness.registered().is_empty());
    assert!(harness.core.restore_session().tabs.is_empty());
}

#[test]
fn scanning_a_folder_that_does_not_exist_is_an_error() {
    let harness = Harness::new();
    let workspace = Workspace::new();

    let error = harness
        .core
        .scan_folder(&workspace.path().join("gone"))
        .unwrap_err();

    assert!(matches!(error, ApiError::FolderNotFound { .. }));
}

#[test]
fn importing_adds_the_selected_repositories_to_a_group_without_opening_tabs() {
    let harness = Harness::new();
    let workspace = Workspace::new();
    let alpha = workspace.init_repository("alpha");
    let beta = workspace.init_repository("beta");
    workspace.init_repository("gamma");
    let work = harness.create_group("Work");

    harness
        .core
        .import_repositories(&[alpha, beta], Some(&work.id))
        .unwrap();

    assert_eq!(harness.registered(), ["alpha", "beta"]);
    assert_eq!(harness.group_of("alpha"), Some(work.id.clone()));
    assert_eq!(harness.group_of("beta"), Some(work.id));
    assert!(harness.core.restore_session().tabs.is_empty());
    let after = found(&harness, workspace.path());
    let added: Vec<bool> = after.iter().map(|found| found.already_added).collect();
    assert_eq!(added, [true, true, false]);
}

#[test]
fn importing_leaves_a_repository_that_is_known_already_where_it_is() {
    let harness = Harness::new();
    let workspace = Workspace::new();
    let alpha = workspace.init_repository("alpha");
    let work = harness.create_group("Work");
    let personal = harness.create_group("Personal");
    harness
        .core
        .import_repositories(std::slice::from_ref(&alpha), Some(&work.id))
        .unwrap();

    harness
        .core
        .import_repositories(&[alpha], Some(&personal.id))
        .unwrap();

    assert_eq!(harness.registered(), ["alpha"]);
    assert_eq!(harness.group_of("alpha"), Some(work.id));
}

#[test]
fn importing_adds_nothing_when_one_of_the_folders_is_not_a_repository() {
    let harness = Harness::new();
    let workspace = Workspace::new();
    let alpha = workspace.init_repository("alpha");
    let plain = workspace.create_folder("plain");

    let error = harness
        .core
        .import_repositories(&[alpha, plain], None)
        .unwrap_err();

    assert!(matches!(error, ApiError::NotARepository { .. }));
    assert!(harness.registered().is_empty());
}

#[test]
fn importing_into_a_group_that_does_not_exist_adds_nothing() {
    let harness = Harness::new();
    let workspace = Workspace::new();
    let alpha = workspace.init_repository("alpha");

    let error = harness
        .core
        .import_repositories(&[alpha], Some("group-9"))
        .unwrap_err();

    assert!(matches!(error, ApiError::GroupNotFound { .. }));
    assert!(harness.registered().is_empty());
}

fn wait_for<T>(harness: &Harness, pick: impl Fn(&CoreEvent) -> Option<T>) -> T {
    let deadline = Instant::now() + Duration::from_secs(15);
    loop {
        if let Some(found) = harness.events().iter().find_map(&pick) {
            return found;
        }
        assert!(Instant::now() < deadline, "timed out waiting for an event");
        thread::sleep(Duration::from_millis(20));
    }
}

#[allow(dead_code)]
fn unused(_: PathBuf) {}
