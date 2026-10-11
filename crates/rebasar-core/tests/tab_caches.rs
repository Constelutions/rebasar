use std::path::Path;

use rebasar_core::{CacheKind, Core, CoreSettings};
use rebasar_testkit::TempRepo;

fn sample(name: &str) -> TempRepo {
    let repo = TempRepo::init(name);
    repo.commit_file("README.md", "one\n", "Initial commit");
    repo
}

fn core_keeping_caches_for(tabs: usize) -> Core {
    Core::with_settings(
        CoreSettings {
            cached_tabs: tabs,
            ..CoreSettings::default()
        },
        |_| {},
    )
}

fn graph(core: &Core, worktree: &Path) -> Option<std::sync::Arc<Vec<u32>>> {
    core.cache::<Vec<u32>>(worktree, CacheKind::Graph)
}

#[test]
fn the_active_tab_keeps_what_it_caches() {
    let repo = sample("first");
    let core = core_keeping_caches_for(1);
    core.activate_tab(repo.path()).expect("activate");

    assert!(core.store_cache(repo.path(), CacheKind::Graph, vec![1u32, 2, 3]));

    assert_eq!(
        graph(&core, repo.path()).as_deref(),
        Some(&vec![1u32, 2, 3])
    );
}

#[test]
fn switching_tabs_evicts_the_caches_of_the_tab_left_behind() {
    let first = sample("first");
    let second = sample("second");
    let core = core_keeping_caches_for(1);
    core.activate_tab(first.path()).expect("activate first");
    core.store_cache(first.path(), CacheKind::Graph, vec![1u32]);
    core.store_cache(first.path(), CacheKind::Diff, vec![2u32]);

    core.activate_tab(second.path()).expect("activate second");

    assert!(graph(&core, first.path()).is_none());
    assert!(core
        .cache::<Vec<u32>>(first.path(), CacheKind::Diff)
        .is_none());
}

#[test]
fn a_background_tab_cannot_cache() {
    let first = sample("first");
    let second = sample("second");
    let core = core_keeping_caches_for(1);
    core.activate_tab(first.path()).expect("activate first");
    core.activate_tab(second.path()).expect("activate second");

    assert!(!core.store_cache(first.path(), CacheKind::Graph, vec![1u32]));

    assert!(graph(&core, first.path()).is_none());
}

#[test]
fn the_least_recently_used_tab_is_evicted_first() {
    let first = sample("first");
    let second = sample("second");
    let third = sample("third");
    let core = core_keeping_caches_for(2);
    for repo in [&first, &second] {
        core.activate_tab(repo.path()).expect("activate");
        core.store_cache(repo.path(), CacheKind::Graph, vec![1u32]);
    }
    core.activate_tab(first.path())
        .expect("activate first again");

    core.activate_tab(third.path()).expect("activate third");

    assert!(
        graph(&core, first.path()).is_some(),
        "used more recently than the second Tab"
    );
    assert!(graph(&core, second.path()).is_none());
}

#[test]
fn an_evicted_tab_can_cache_again_once_it_is_active() {
    let first = sample("first");
    let second = sample("second");
    let core = core_keeping_caches_for(1);
    core.activate_tab(first.path()).expect("activate first");
    core.store_cache(first.path(), CacheKind::Graph, vec![1u32]);
    core.activate_tab(second.path()).expect("activate second");

    core.activate_tab(first.path())
        .expect("activate first again");

    assert!(graph(&core, first.path()).is_none(), "rebuilt, not revived");
    assert!(core.store_cache(first.path(), CacheKind::Graph, vec![9u32]));
}

#[test]
fn only_the_active_tab_caches_by_default() {
    let first = sample("first");
    let second = sample("second");
    let core = Core::new(|_| {});
    core.activate_tab(first.path()).expect("activate first");
    core.store_cache(first.path(), CacheKind::Graph, vec![1u32]);

    core.activate_tab(second.path()).expect("activate second");

    assert!(graph(&core, first.path()).is_none());
}
