use std::path::Path;

use std::sync::{Arc, Mutex};

use rebasar_core::{ApiError, Core, CoreEvent, Head, Tab};
use rebasar_testkit::TempRepo;

fn core() -> Core {
    Core::new(|_| {})
}

fn core_recording_events() -> (Core, Arc<Mutex<Vec<CoreEvent>>>) {
    let events = Arc::new(Mutex::new(Vec::new()));
    let sink = Arc::clone(&events);
    let core = Core::new(move |event| sink.lock().unwrap().push(event));
    (core, events)
}

fn canonical(path: &Path) -> String {
    dunce::canonicalize(path)
        .expect("canonicalize")
        .to_string_lossy()
        .into_owned()
}

#[test]
fn opening_a_repository_folder_yields_a_tab_with_its_name_and_branch() {
    let repo = TempRepo::init("sample");
    repo.commit_file("README.md", "hello", "Initial commit");

    let tab = core().open_folder(repo.path()).expect("open folder");

    assert_eq!(
        tab,
        Tab {
            repository_name: "sample".to_owned(),
            worktree_path: canonical(repo.path()),
            head: Head::Branch {
                name: "main".to_owned()
            },
        }
    );
}

#[test]
fn opening_a_linked_worktree_yields_a_tab_named_after_the_repository() {
    let repo = TempRepo::init("sample");
    repo.commit_file("README.md", "hello", "Initial commit");
    let worktree_path = repo.add_worktree("sample-hotfix", "hotfix");

    let tab = core().open_folder(&worktree_path).expect("open worktree");

    assert_eq!(tab.repository_name, "sample");
    assert_eq!(tab.worktree_path, canonical(&worktree_path));
    assert_eq!(
        tab.head,
        Head::Branch {
            name: "hotfix".to_owned()
        }
    );
}

#[test]
fn opening_a_folder_that_is_not_a_repository_reports_it() {
    let folder = tempfile::tempdir().expect("temp dir");

    let error = core()
        .open_folder(folder.path())
        .expect_err("not a repository");

    assert_eq!(
        error,
        ApiError::NotARepository {
            path: canonical(folder.path())
        }
    );
}

#[test]
fn opening_a_folder_that_does_not_exist_reports_it() {
    let folder = tempfile::tempdir().expect("temp dir");
    let missing = folder.path().join("missing");

    let error = core().open_folder(&missing).expect_err("missing folder");

    assert_eq!(
        error,
        ApiError::FolderNotFound {
            path: missing.to_string_lossy().into_owned()
        }
    );
}

#[test]
fn opening_a_repository_emits_a_tab_opened_event() {
    let repo = TempRepo::init("sample");
    repo.commit_file("README.md", "hello", "Initial commit");
    let (core, events) = core_recording_events();

    let tab = core.open_folder(repo.path()).expect("open folder");

    assert_eq!(*events.lock().unwrap(), vec![CoreEvent::TabOpened { tab }]);
}

#[test]
fn a_failed_open_emits_no_event() {
    let folder = tempfile::tempdir().expect("temp dir");
    let (core, events) = core_recording_events();

    let _ = core.open_folder(folder.path());

    assert!(events.lock().unwrap().is_empty());
}

#[test]
fn a_detached_head_is_shown_as_the_short_commit() {
    let repo = TempRepo::init("sample");
    repo.commit_file("README.md", "hello", "Initial commit");
    repo.detach_head();

    let tab = core().open_folder(repo.path()).expect("open folder");

    assert_eq!(
        tab.head,
        Head::Detached {
            commit: repo.head_commit()[..7].to_owned()
        }
    );
}
