use rebasar_core::{
    ApiError, ChangeKind, ChangeList, CheckState, CoreEvent, DiffContent, DiffLine, DiffRequest,
    Edge, EdgeKind, FileChange, FileDiff, GitHubAuthStatus, GitHubRepository, Head, HistoryCount,
    HistoryFilter, HistoryPage, HistoryRow, Hunk, LineKind, ModeChange, PullRequest, RefKind,
    RefLabel, ReviewState, Tab, TokenSource, WorktreeStatus,
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

#[test]
fn a_diff_request_deserialises_from_the_shape_the_ui_sends() {
    let request: DiffRequest = serde_json::from_value(json!({
        "path": "src/new.rs",
        "originalPath": "src/old.rs",
        "list": "staged",
        "loadLarge": true,
    }))
    .unwrap();

    assert_eq!(
        request,
        DiffRequest {
            path: "src/new.rs".to_owned(),
            original_path: Some("src/old.rs".to_owned()),
            list: ChangeList::Staged,
            load_large: true,
        }
    );
}

#[test]
fn a_diff_request_may_leave_out_the_optional_fields() {
    let request: DiffRequest =
        serde_json::from_value(json!({ "path": "a.txt", "list": "unstaged" })).unwrap();

    assert_eq!(request.original_path, None);
    assert!(!request.load_large);
}

#[test]
fn a_text_diff_serialises_to_the_shape_the_ui_expects() {
    let diff = FileDiff {
        path: "run.sh".to_owned(),
        original_path: None,
        mode_change: Some(ModeChange {
            old: "100644".to_owned(),
            new: "100755".to_owned(),
        }),
        content: DiffContent::Text {
            hunks: vec![Hunk {
                old_start: 1,
                old_lines: 1,
                new_start: 1,
                new_lines: 1,
                lines: vec![DiffLine {
                    kind: LineKind::Added,
                    old_number: None,
                    new_number: Some(1),
                    text: "echo".to_owned(),
                }],
            }],
        },
    };

    assert_eq!(
        serde_json::to_value(diff).unwrap(),
        json!({
            "path": "run.sh",
            "originalPath": null,
            "modeChange": { "old": "100644", "new": "100755" },
            "content": {
                "kind": "text",
                "hunks": [{
                    "oldStart": 1,
                    "oldLines": 1,
                    "newStart": 1,
                    "newLines": 1,
                    "lines": [{
                        "kind": "added",
                        "oldNumber": null,
                        "newNumber": 1,
                        "text": "echo",
                    }],
                }],
            },
        })
    );
}

#[test]
fn binary_and_collapsed_diffs_serialise_to_the_shape_the_ui_expects() {
    assert_eq!(
        serde_json::to_value(DiffContent::Binary {
            old_bytes: None,
            new_bytes: Some(4)
        })
        .unwrap(),
        json!({ "kind": "binary", "oldBytes": null, "newBytes": 4 })
    );
    assert_eq!(
        serde_json::to_value(DiffContent::Collapsed {
            bytes: 2_000_000,
            lines: Some(30_000)
        })
        .unwrap(),
        json!({ "kind": "collapsed", "bytes": 2000000, "lines": 30000 })
    );
}

#[test]
fn a_polling_tabs_changed_event_serialises_to_the_shape_the_ui_expects() {
    assert_eq!(
        serde_json::to_value(CoreEvent::PollingTabsChanged {
            worktree_paths: vec!["/work/sample".to_owned()]
        })
        .unwrap(),
        json!({ "type": "pollingTabsChanged", "worktreePaths": ["/work/sample"] })
    );
}

#[test]
fn a_pull_request_serialises_to_the_shape_the_ui_expects() {
    let pull_request = PullRequest {
        number: 42,
        title: "Add the widget cache".to_owned(),
        url: "https://github.com/acme/widgets/pull/42".to_owned(),
        author: "octocat".to_owned(),
        head_branch: "feature/cache".to_owned(),
        base_branch: "main".to_owned(),
        is_draft: true,
        checks: CheckState::Failure,
        review: ReviewState::ChangesRequested,
    };

    assert_eq!(
        serde_json::to_value(pull_request).unwrap(),
        json!({
            "number": 42,
            "title": "Add the widget cache",
            "url": "https://github.com/acme/widgets/pull/42",
            "author": "octocat",
            "headBranch": "feature/cache",
            "baseBranch": "main",
            "isDraft": true,
            "checks": "failure",
            "review": "changesRequested",
        })
    );
}

#[test]
fn github_auth_and_remote_serialise_to_the_shape_the_ui_expects() {
    assert_eq!(
        serde_json::to_value(GitHubAuthStatus {
            source: Some(TokenSource::PersonalAccessToken)
        })
        .unwrap(),
        json!({ "source": "personalAccessToken" })
    );
    assert_eq!(
        serde_json::to_value(GitHubAuthStatus { source: None }).unwrap(),
        json!({ "source": null })
    );
    assert_eq!(
        serde_json::to_value(GitHubRepository {
            owner: "acme".to_owned(),
            name: "widgets".to_owned()
        })
        .unwrap(),
        json!({ "owner": "acme", "name": "widgets" })
    );
}

#[test]
fn github_errors_serialise_to_the_shape_the_ui_expects() {
    let serialised = |error: ApiError| serde_json::to_value(error).unwrap();

    assert_eq!(
        serialised(ApiError::NotGithub {
            path: "/work/sample".to_owned()
        }),
        json!({ "kind": "notGithub", "path": "/work/sample" })
    );
    assert_eq!(
        serialised(ApiError::GithubNotSignedIn),
        json!({ "kind": "githubNotSignedIn" })
    );
    assert_eq!(
        serialised(ApiError::GithubTokenRejected),
        json!({ "kind": "githubTokenRejected" })
    );
    assert_eq!(
        serialised(ApiError::GithubRequestFailed {
            message: "rate limited".to_owned()
        }),
        json!({ "kind": "githubRequestFailed", "message": "rate limited" })
    );
}
