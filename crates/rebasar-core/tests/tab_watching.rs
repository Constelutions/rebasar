use std::path::Path;
use std::sync::mpsc::{self, Receiver};
use std::time::Duration;

use rebasar_core::{Core, CoreEvent, CoreSettings};
use rebasar_testkit::TempRepo;

const PATIENCE: Duration = Duration::from_secs(10);

fn core_with_events(settings: CoreSettings) -> (Core, Receiver<CoreEvent>) {
    let (sender, receiver) = mpsc::channel();
    let core = Core::with_settings(settings, move |event| {
        let _ = sender.send(event);
    });
    (core, receiver)
}

fn canonical(path: &Path) -> String {
    dunce::canonicalize(path)
        .expect("canonicalize")
        .to_string_lossy()
        .into_owned()
}

fn sample(name: &str) -> TempRepo {
    let repo = TempRepo::init(name);
    repo.commit_file("README.md", "one\n", "Initial commit");
    repo
}

fn next_event_matching<T>(
    events: &Receiver<CoreEvent>,
    mut pick: impl FnMut(CoreEvent) -> Option<T>,
) -> T {
    loop {
        let event = events
            .recv_timeout(PATIENCE)
            .expect("the expected event never came");
        if let Some(found) = pick(event) {
            return found;
        }
    }
}

fn next_polling_change(events: &Receiver<CoreEvent>) -> Vec<String> {
    next_event_matching(events, |event| match event {
        CoreEvent::PollingTabsChanged { worktree_paths } => Some(worktree_paths),
        _ => None,
    })
}

fn next_change_in(events: &Receiver<CoreEvent>) -> String {
    next_event_matching(events, |event| match event {
        CoreEvent::WorktreeChanged { worktree_path } => Some(worktree_path),
        _ => None,
    })
}

fn limited_to(watched_tabs: usize) -> CoreSettings {
    CoreSettings {
        watch_limit: watched_tabs,
        poll_interval: Duration::from_millis(100),
        ..CoreSettings::default()
    }
}

#[test]
fn the_least_recently_used_tab_falls_back_to_polling_when_the_watch_limit_is_reached() {
    let (first, second, third) = (sample("first"), sample("second"), sample("third"));
    let (core, events) = core_with_events(limited_to(2));
    core.watch_worktree(first.path()).expect("watch first");
    core.watch_worktree(second.path()).expect("watch second");

    core.watch_worktree(third.path()).expect("watch third");

    assert_eq!(next_polling_change(&events), [canonical(first.path())]);
}

#[test]
fn using_a_tab_again_spares_it_from_the_fallback() {
    let (first, second, third) = (sample("first"), sample("second"), sample("third"));
    let (core, events) = core_with_events(limited_to(2));
    core.watch_worktree(first.path()).expect("watch first");
    core.watch_worktree(second.path()).expect("watch second");
    core.activate_tab(first.path()).expect("activate first");

    core.watch_worktree(third.path()).expect("watch third");

    assert_eq!(next_polling_change(&events), [canonical(second.path())]);
}

#[test]
fn a_polled_tab_still_reports_changes_made_outside_the_app() {
    let (first, second) = (sample("first"), sample("second"));
    let (core, events) = core_with_events(limited_to(1));
    core.watch_worktree(first.path()).expect("watch first");
    core.watch_worktree(second.path()).expect("watch second");
    next_polling_change(&events);
    // The poller reads its baseline on its own thread right after it starts.
    std::thread::sleep(Duration::from_millis(500));

    first.write_file("from-terminal.txt", "hello\n");

    assert_eq!(next_change_in(&events), canonical(first.path()));
}

#[test]
fn a_tab_that_is_used_again_gets_its_watcher_back_and_the_list_updates() {
    let (first, second) = (sample("first"), sample("second"));
    let (core, events) = core_with_events(limited_to(1));
    core.watch_worktree(first.path()).expect("watch first");
    core.watch_worktree(second.path()).expect("watch second");
    assert_eq!(next_polling_change(&events), [canonical(first.path())]);

    core.activate_tab(first.path()).expect("activate first");

    assert_eq!(next_polling_change(&events), [canonical(second.path())]);
}

#[test]
fn closing_a_watched_tab_gives_its_watcher_to_a_polled_one() {
    let (first, second) = (sample("first"), sample("second"));
    let (core, events) = core_with_events(limited_to(1));
    core.watch_worktree(first.path()).expect("watch first");
    core.watch_worktree(second.path()).expect("watch second");
    next_polling_change(&events);

    core.unwatch_worktree(second.path());

    assert!(next_polling_change(&events).is_empty());
}

#[test]
fn nothing_is_announced_while_every_tab_can_be_watched() {
    let (first, second) = (sample("first"), sample("second"));
    let (core, events) = core_with_events(limited_to(2));

    core.watch_worktree(first.path()).expect("watch first");
    core.watch_worktree(second.path()).expect("watch second");

    assert!(events.recv_timeout(Duration::from_millis(500)).is_err());
}

#[test]
fn a_background_tab_reports_after_the_active_one() {
    let (first, second) = (sample("first"), sample("second"));
    let (core, events) = core_with_events(CoreSettings {
        background_quiet: Duration::from_millis(1_500),
        ..CoreSettings::default()
    });
    core.activate_tab(first.path()).expect("activate first");
    core.activate_tab(second.path()).expect("activate second");

    first.write_file("background.txt", "x\n");
    second.write_file("active.txt", "x\n");

    assert_eq!(next_change_in(&events), canonical(second.path()));
    assert_eq!(next_change_in(&events), canonical(first.path()));
}
