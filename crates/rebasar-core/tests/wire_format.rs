use rebasar_core::{
    ApiError, ChangeKind, CoreEvent, Edge, EdgeKind, FileChange, Head, HistoryCount, HistoryFilter,
    HistoryPage, HistoryRow, RefKind, RefLabel, Tab, WorktreeStatus,
};
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

#[test]
fn a_history_page_serialises_to_the_shape_the_ui_expects() {
    let page = HistoryPage {
        offset: 40,
        has_more: true,
        rows: vec![HistoryRow {
            id: "abc1234def".to_owned(),
            short_id: "abc1234".to_owned(),
            subject: "Fix the thing".to_owned(),
            author_name: "Ada".to_owned(),
            author_email: "ada@example.com".to_owned(),
            timestamp: 1_700_000_000,
            lane: 1,
            lane_count: 2,
            edges: vec![
                Edge {
                    kind: EdgeKind::Through,
                    lane: 0,
                },
                Edge {
                    kind: EdgeKind::Incoming,
                    lane: 1,
                },
                Edge {
                    kind: EdgeKind::Outgoing,
                    lane: 0,
                },
            ],
            refs: vec![
                RefLabel {
                    kind: RefKind::LocalBranch,
                    name: "main".to_owned(),
                },
                RefLabel {
                    kind: RefKind::RemoteBranch,
                    name: "origin/main".to_owned(),
                },
            ],
        }],
    };

    assert_eq!(
        serde_json::to_value(page).unwrap(),
        json!({
            "offset": 40,
            "hasMore": true,
            "rows": [{
                "id": "abc1234def",
                "shortId": "abc1234",
                "subject": "Fix the thing",
                "authorName": "Ada",
                "authorEmail": "ada@example.com",
                "timestamp": 1_700_000_000,
                "lane": 1,
                "laneCount": 2,
                "edges": [
                    { "kind": "through", "lane": 0 },
                    { "kind": "incoming", "lane": 1 },
                    { "kind": "outgoing", "lane": 0 },
                ],
                "refs": [
                    { "kind": "localBranch", "name": "main" },
                    { "kind": "remoteBranch", "name": "origin/main" },
                ],
            }],
        })
    );
}

#[test]
fn an_invalid_query_error_serialises_with_its_position() {
    let error = ApiError::InvalidQuery {
        message: "`author:` needs a value".to_owned(),
        start: 4,
        end: 11,
    };

    assert_eq!(
        serde_json::to_value(error).unwrap(),
        json!({ "kind": "invalidQuery", "message": "`author:` needs a value", "start": 4, "end": 11 })
    );
}

#[test]
fn a_history_filter_deserialises_from_the_shape_the_ui_sends() {
    let filter: HistoryFilter = serde_json::from_value(json!({
        "query": "author:ada",
        "allBranches": false,
        "mine": true,
        "merges": false,
    }))
    .unwrap();

    assert_eq!(
        filter,
        HistoryFilter {
            query: "author:ada".to_owned(),
            all_branches: false,
            mine: true,
            merges: false,
        }
    );
}

#[test]
fn a_history_count_serialises_to_the_shape_the_ui_expects() {
    let count = HistoryCount {
        matching: 13,
        total: 142,
    };

    assert_eq!(
        serde_json::to_value(count).unwrap(),
        json!({ "matching": 13, "total": 142 })
    );
}
