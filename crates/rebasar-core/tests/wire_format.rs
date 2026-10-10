use rebasar_core::{ApiError, ChangeKind, CoreEvent, FileChange, Head, Tab, WorktreeStatus};
use serde_json::json;

fn tab() -> Tab {
    Tab {
        repository_name: "sample".to_owned(),
        worktree_path: "/work/sample".to_owned(),
        head: Head::Branch {
            name: "main".to_owned(),
        },
    }
}

#[test]
fn a_tab_serialises_to_the_shape_the_ui_expects() {
    assert_eq!(
        serde_json::to_value(tab()).unwrap(),
        json!({
            "repositoryName": "sample",
            "worktreePath": "/work/sample",
            "head": { "kind": "branch", "name": "main" },
        })
    );
}

#[test]
fn a_detached_head_serialises_to_the_shape_the_ui_expects() {
    let head = Head::Detached {
        commit: "abc1234".to_owned(),
    };

    assert_eq!(
        serde_json::to_value(head).unwrap(),
        json!({ "kind": "detached", "commit": "abc1234" })
    );
}

#[test]
fn an_event_serialises_to_the_shape_the_ui_expects() {
    assert_eq!(
        serde_json::to_value(CoreEvent::TabOpened { tab: tab() }).unwrap(),
        json!({
            "type": "tabOpened",
            "tab": {
                "repositoryName": "sample",
                "worktreePath": "/work/sample",
                "head": { "kind": "branch", "name": "main" },
            },
        })
    );
}

#[test]
fn an_error_serialises_to_the_shape_the_ui_expects() {
    let error = ApiError::NotARepository {
        path: "/work/plain".to_owned(),
    };

    assert_eq!(
        serde_json::to_value(error).unwrap(),
        json!({ "kind": "notARepository", "path": "/work/plain" })
    );
}

#[test]
fn a_worktree_status_serialises_to_the_shape_the_ui_expects() {
    let status = WorktreeStatus {
        conflicts: Vec::new(),
        staged: vec![FileChange {
            path: "src/new.rs".to_owned(),
            original_path: Some("src/old.rs".to_owned()),
            kind: ChangeKind::Renamed,
            added: Some(2),
            removed: Some(1),
        }],
        unstaged: vec![FileChange {
            path: "logo.png".to_owned(),
            original_path: None,
            kind: ChangeKind::Untracked,
            added: None,
            removed: None,
        }],
    };

    assert_eq!(
        serde_json::to_value(status).unwrap(),
        json!({
            "conflicts": [],
            "staged": [{
                "path": "src/new.rs",
                "originalPath": "src/old.rs",
                "kind": "renamed",
                "added": 2,
                "removed": 1,
            }],
            "unstaged": [{
                "path": "logo.png",
                "originalPath": null,
                "kind": "untracked",
                "added": null,
                "removed": null,
            }],
        })
    );
}

#[test]
fn a_worktree_changed_event_serialises_to_the_shape_the_ui_expects() {
    assert_eq!(
        serde_json::to_value(CoreEvent::WorktreeChanged {
            worktree_path: "/work/sample".to_owned()
        })
        .unwrap(),
        json!({ "type": "worktreeChanged", "worktreePath": "/work/sample" })
    );
}
