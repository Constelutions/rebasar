use std::sync::{Arc, Mutex};

use rebasar_core::{Core, CoreEvent};
use rebasar_testkit::TempRepo;

fn core_recording_events() -> (Core, Arc<Mutex<Vec<CoreEvent>>>) {
    let events = Arc::new(Mutex::new(Vec::new()));
    let sink = Arc::clone(&events);
    let core = Core::new(move |event| sink.lock().unwrap().push(event));
    (core, events)
}

#[test]
fn a_launch_path_opens_its_worktree_as_a_tab() {
    let repo = TempRepo::init("sample");
    repo.commit_file("README.md", "hello", "Initial commit");
    let (core, events) = core_recording_events();

    core.open_launch_path(repo.path());

    let events = events.lock().unwrap();
    assert!(
        matches!(events.as_slice(), [CoreEvent::TabOpened { tab }] if tab.repository_name == "sample"),
        "unexpected events: {events:?}"
    );
}

#[test]
fn a_launch_path_that_cannot_be_opened_is_reported_instead_of_raised() {
    let folder = tempfile::tempdir().expect("temp dir");
    let (core, events) = core_recording_events();

    core.open_launch_path(folder.path());

    let events = events.lock().unwrap();
    assert!(
        matches!(
            events.as_slice(),
            [CoreEvent::LaunchFailed { message }] if message.contains("is not a Git repository")
        ),
        "unexpected events: {events:?}"
    );
}
