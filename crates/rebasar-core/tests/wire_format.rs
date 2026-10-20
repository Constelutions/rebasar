use rebasar_core::{
    ConfirmTabClose, CopySettings, GraphStyle, HistoryOrientation, HistorySettings,
    ApiError, AppearanceSettings, Assessment, ChangeKind, ChangeList, CheckState, CommitDetail,
    CommitDiffRequest, CommitHit, CommitOptions, CommitParent, CoreEvent, DiffContent, DiffLine,
    DiffMode, DiffRequest, DiffSettings, Edge, EdgeKind, FileChange, FileDiff, GitHubAuthStatus,
    GitHubRepository, GitIdentity, GitSetup, Group, Head, HistoryCount, HistoryFilter,
    HistoryPage, HistoryRow, Hunk, LineKind, Loss, ModeChange, MutationId, MutationInfo,
    MutationKind, MutationOutcome, OutgoingCommit, OutputStream, PullRequest, RefKind, RefLabel,
    RepositoryEntry, RepositoryList, ReviewState, Session, Settings, SyncSettings, Tab, TabSettings, TokenSource,
    UnavailableReason, WhitespaceMode, WorktreeEntry, WorktreeStatus,
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
        "merges": false,
    }))
    .unwrap();

    assert_eq!(
        filter,
        HistoryFilter {
            query: "author:ada".to_owned(),
            all_branches: false,
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
        "whitespace": "ignoreAll",
    }))
    .unwrap();

    assert_eq!(
        request,
        DiffRequest {
            path: "src/new.rs".to_owned(),
            original_path: Some("src/old.rs".to_owned()),
            list: ChangeList::Staged,
            load_large: true,
            whitespace: WhitespaceMode::IgnoreAll,
        }
    );
}

#[test]
fn a_diff_request_may_leave_out_the_optional_fields() {
    let request: DiffRequest =
        serde_json::from_value(json!({ "path": "a.txt", "list": "unstaged" })).unwrap();

    assert_eq!(request.original_path, None);
    assert!(!request.load_large);
    assert_eq!(request.whitespace, WhitespaceMode::Show);
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
        serialised(
            UnavailableReason::NotGithub {
                host: "gitlab.com".to_owned()
            }
            .into_error(Some("https://gitlab.com/acme/widgets.git".to_owned()))
        ),
        json!({
            "kind": "pullRequestsUnavailable",
            "reason": { "kind": "notGithub", "host": "gitlab.com" },
            "message": "The remote (gitlab.com) is not on GitHub.",
            "url": "https://gitlab.com/acme/widgets.git",
            "hint": null,
        })
    );
    assert_eq!(
        serialised(UnavailableReason::NoToken.into_error(None)),
        json!({
            "kind": "pullRequestsUnavailable",
            "reason": { "kind": "noToken" },
            "message": "You are not signed in to GitHub.",
            "url": null,
            "hint": "Run `gh auth login`, or paste a personal access token.",
        })
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

#[test]
fn mutation_events_serialise_to_the_shape_the_ui_expects() {
    let id: MutationId = serde_json::from_value(json!(7)).unwrap();

    assert_eq!(
        serde_json::to_value(CoreEvent::MutationQueued {
            mutation: MutationInfo {
                id,
                worktree_path: "/work/sample".to_owned(),
                title: "Commit".to_owned(),
                command: "git commit --message 'Fix'".to_owned(),
            }
        })
        .unwrap(),
        json!({
            "type": "mutationQueued",
            "mutation": {
                "id": 7,
                "worktreePath": "/work/sample",
                "title": "Commit",
                "command": "git commit --message 'Fix'",
            },
        })
    );
    assert_eq!(
        serde_json::to_value(CoreEvent::MutationStarted { mutation_id: id }).unwrap(),
        json!({ "type": "mutationStarted", "mutationId": 7 })
    );
    assert_eq!(
        serde_json::to_value(CoreEvent::MutationOutput {
            mutation_id: id,
            stream: OutputStream::Stderr,
            text: "lint failed".to_owned(),
            transient: false,
        })
        .unwrap(),
        json!({
            "type": "mutationOutput",
            "mutationId": 7,
            "stream": "stderr",
            "text": "lint failed",
            "transient": false,
        })
    );
    assert_eq!(
        serde_json::to_value(CoreEvent::MutationFinished {
            mutation_id: id,
            outcome: MutationOutcome::Failed { exit_code: Some(1) },
        })
        .unwrap(),
        json!({
            "type": "mutationFinished",
            "mutationId": 7,
            "outcome": { "kind": "failed", "exitCode": 1 },
        })
    );
}

#[test]
fn mutation_outcomes_without_details_serialise_to_a_kind() {
    assert_eq!(
        serde_json::to_value(MutationOutcome::Succeeded).unwrap(),
        json!({ "kind": "succeeded" })
    );
    assert_eq!(
        serde_json::to_value(MutationOutcome::Cancelled).unwrap(),
        json!({ "kind": "cancelled" })
    );
}

#[test]
fn the_git_setup_serialises_to_the_shape_the_ui_expects() {
    assert_eq!(
        serde_json::to_value(GitSetup::from_version_output(Some(
            "git version 2.47.1.windows.2"
        )))
        .unwrap(),
        json!({ "kind": "ready", "version": "2.47.1" })
    );
    assert_eq!(
        serde_json::to_value(GitSetup::from_version_output(Some("git version 2.30.0"))).unwrap(),
        json!({ "kind": "tooOld", "version": "2.30.0", "minimum": "2.35.0" })
    );
    assert_eq!(
        serde_json::to_value(GitSetup::from_version_output(None)).unwrap(),
        json!({ "kind": "missing", "minimum": "2.35.0" })
    );
}

#[test]
fn settings_serialise_to_the_shape_the_ui_expects() {
    let settings = Settings {
        diff: DiffSettings {
            whitespace: WhitespaceMode::IgnoreAll,
            default_mode: DiffMode::SideBySide,
        },
        appearance: AppearanceSettings {
            code_font_size: 13,
            sidebar_collapsed: true,
        },
        sync: SyncSettings {
            auto_fetch: false,
            fetch_interval_minutes: 10,
        },
        copy: CopySettings { on_select: false },
        tabs: TabSettings {
            confirm_close: ConfirmTabClose::WhenLost,
            restore_on_launch: false,
        },
        history: HistorySettings {
            mine: true,
            merges: false,
            all_branches: false,
            orientation: HistoryOrientation::Horizontal,
            graph_style: GraphStyle::Tree,
        },
    };

    assert_eq!(
        serde_json::to_value(settings).unwrap(),
        json!({
            "diff": { "whitespace": "ignoreAll", "defaultMode": "sideBySide" },
            "appearance": { "codeFontSize": 13, "sidebarCollapsed": true },
            "sync": { "autoFetch": false, "fetchIntervalMinutes": 10 },
            "copy": { "onSelect": false },
            "tabs": { "confirmClose": "whenLost", "restoreOnLaunch": false },
            "history": {
                "mine": true,
                "merges": false,
                "allBranches": false,
                "orientation": "horizontal",
                "graphStyle": "tree",
            },
        })
    );
}

#[test]
fn a_git_identity_travels_with_null_for_an_unset_value() {
    let identity: GitIdentity =
        serde_json::from_value(json!({ "name": "Ada", "email": null })).unwrap();

    assert_eq!(
        identity,
        GitIdentity {
            name: Some("Ada".to_owned()),
            email: None,
        }
    );
    assert_eq!(
        serde_json::to_value(identity).unwrap(),
        json!({ "name": "Ada", "email": null })
    );
}

#[test]
fn a_commit_detail_serialises_to_the_shape_the_ui_expects() {
    let detail = CommitDetail {
        id: "abc1234def".to_owned(),
        short_id: "abc1234".to_owned(),
        author_name: "Ada".to_owned(),
        author_email: "ada@example.com".to_owned(),
        author_timestamp: 1_700_000_000,
        message: "Fix the thing\n\nBecause.".to_owned(),
        parents: vec![CommitParent {
            id: "def5678abc".to_owned(),
            short_id: "def5678".to_owned(),
            subject: "Before".to_owned(),
        }],
        files: vec![FileChange {
            path: "src/new.rs".to_owned(),
            original_path: Some("src/old.rs".to_owned()),
            kind: ChangeKind::Renamed,
            added: Some(2),
            removed: None,
        }],
    };

    assert_eq!(
        serde_json::to_value(detail).unwrap(),
        json!({
            "id": "abc1234def",
            "shortId": "abc1234",
            "authorName": "Ada",
            "authorEmail": "ada@example.com",
            "authorTimestamp": 1_700_000_000,
            "message": "Fix the thing\n\nBecause.",
            "parents": [{ "id": "def5678abc", "shortId": "def5678", "subject": "Before" }],
            "files": [{
                "path": "src/new.rs",
                "originalPath": "src/old.rs",
                "kind": "renamed",
                "added": 2,
                "removed": null,
            }],
        })
    );
}

#[test]
fn a_commit_diff_request_deserialises_from_the_shape_the_ui_sends() {
    let request: CommitDiffRequest = serde_json::from_value(json!({
        "commit": "abc1234def",
        "parent": 1,
        "path": "src/new.rs",
        "originalPath": "src/old.rs",
        "loadLarge": true,
    }))
    .unwrap();

    assert_eq!(
        request,
        CommitDiffRequest {
            commit: "abc1234def".to_owned(),
            parent: 1,
            path: "src/new.rs".to_owned(),
            original_path: Some("src/old.rs".to_owned()),
            load_large: true,
        }
    );
}

#[test]
fn a_commit_hit_serialises_to_the_shape_the_ui_expects() {
    let hit = CommitHit {
        id: "abc1234def".to_owned(),
        short_id: "abc1234".to_owned(),
        subject: "Fix the thing".to_owned(),
        author_name: "Ada".to_owned(),
        timestamp: 1_700_000_000,
    };

    assert_eq!(
        serde_json::to_value(hit).unwrap(),
        json!({
            "id": "abc1234def",
            "shortId": "abc1234",
            "subject": "Fix the thing",
            "authorName": "Ada",
            "timestamp": 1_700_000_000,
        })
    );
}

#[test]
fn a_tab_closed_event_serialises_to_the_shape_the_ui_expects() {
    assert_eq!(
        serde_json::to_value(CoreEvent::TabClosed {
            worktree_path: "/work/sample".to_owned()
        })
        .unwrap(),
        json!({ "type": "tabClosed", "worktreePath": "/work/sample" })
    );
}

#[test]
fn a_repository_list_serialises_to_the_shape_the_ui_expects() {
    let list = RepositoryList {
        groups: vec![Group {
            id: "group-1".to_owned(),
            name: "Work".to_owned(),
        }],
        repositories: vec![RepositoryEntry {
            path: "/work/sample".to_owned(),
            name: "sample".to_owned(),
            group_id: Some("group-1".to_owned()),
            missing: false,
            worktrees: vec![WorktreeEntry {
                path: "/work/sample".to_owned(),
                main: true,
                head: Head::Branch {
                    name: "main".to_owned(),
                },
            }],
        }],
    };

    assert_eq!(
        serde_json::to_value(list).unwrap(),
        json!({
            "groups": [{ "id": "group-1", "name": "Work" }],
            "repositories": [{
                "path": "/work/sample",
                "name": "sample",
                "groupId": "group-1",
                "missing": false,
                "worktrees": [{
                    "path": "/work/sample",
                    "main": true,
                    "head": { "kind": "branch", "name": "main" },
                }],
            }],
        })
    );
}

#[test]
fn a_session_serialises_to_the_shape_the_ui_expects() {
    let session = Session {
        tabs: vec![tab()],
        active: Some("/work/sample".to_owned()),
        view: None,
    };

    assert_eq!(
        serde_json::to_value(session).unwrap(),
        json!({
            "tabs": [{
                "repositoryName": "sample",
                "worktreePath": "/work/sample",
                "head": { "kind": "branch", "name": "main" },
            }],
            "active": "/work/sample",
            "view": null,
        })
    );
}

#[test]
fn the_errors_of_the_registry_serialise_to_the_shape_the_ui_expects() {
    assert_eq!(
        serde_json::to_value(ApiError::InvalidGroupName).unwrap(),
        json!({ "kind": "invalidGroupName" })
    );
    assert_eq!(
        serde_json::to_value(ApiError::GroupNotFound {
            id: "group-9".to_owned()
        })
        .unwrap(),
        json!({ "kind": "groupNotFound", "id": "group-9" })
    );
    assert_eq!(
        serde_json::to_value(ApiError::RepositoryNotFound {
            path: "/work/gone".to_owned()
        })
        .unwrap(),
        json!({ "kind": "repositoryNotFound", "path": "/work/gone" })
    );
}

#[test]
fn an_outgoing_commit_serialises_to_the_shape_the_ui_expects() {
    let commit = OutgoingCommit {
        id: "abc1234def5678".to_owned(),
        short_id: "abc1234".to_owned(),
        subject: "Add notes".to_owned(),
    };

    assert_eq!(
        serde_json::to_value(commit).unwrap(),
        json!({ "id": "abc1234def5678", "shortId": "abc1234", "subject": "Add notes" })
    );
}

#[test]
fn commit_options_are_read_in_the_shape_the_ui_sends() {
    let options: CommitOptions = serde_json::from_value(json!({ "amend": true })).unwrap();

    assert_eq!(
        options,
        CommitOptions {
            amend: true,
            sign_off: false
        }
    );
    assert_eq!(
        serde_json::from_value::<CommitOptions>(json!({ "signOff": true })).unwrap(),
        CommitOptions {
            amend: false,
            sign_off: true
        }
    );
}

#[test]
fn a_mutation_kind_deserialises_from_the_shape_the_ui_sends() {
    assert_eq!(
        serde_json::from_value::<MutationKind>(json!({ "kind": "commit" })).unwrap(),
        MutationKind::Commit
    );
    assert_eq!(
        serde_json::from_value::<MutationKind>(
            json!({ "kind": "discardChanges", "paths": ["a.txt"] })
        )
        .unwrap(),
        MutationKind::DiscardChanges {
            paths: vec!["a.txt".to_owned()]
        }
    );
}

#[test]
fn an_assessment_serialises_to_the_shape_the_ui_expects() {
    assert_eq!(
        serde_json::to_value(Assessment::Safe).unwrap(),
        json!({ "kind": "safe" })
    );
    assert_eq!(
        serde_json::to_value(Assessment::Destructive {
            loss: Loss {
                files: vec![FileChange {
                    path: "a.txt".to_owned(),
                    original_path: None,
                    kind: ChangeKind::Modified,
                    added: Some(1),
                    removed: Some(2),
                }],
                commits: 3,
                unpushed_commits: 1,
            }
        })
        .unwrap(),
        json!({
            "kind": "destructive",
            "loss": {
                "files": [{
                    "path": "a.txt",
                    "originalPath": null,
                    "kind": "modified",
                    "added": 1,
                    "removed": 2,
                }],
                "commits": 3,
                "unpushedCommits": 1,
            },
        })
    );
}

#[test]
fn a_worktree_diff_request_deserialises_from_the_shape_the_ui_sends() {
    let request: rebasar_core::WorktreeDiffRequest = serde_json::from_value(serde_json::json!({
        "commit": "abc1234def",
        "path": "src/new.rs",
        "loadLarge": true,
    }))
    .unwrap();

    assert_eq!(
        request,
        rebasar_core::WorktreeDiffRequest {
            commit: "abc1234def".to_owned(),
            path: "src/new.rs".to_owned(),
            load_large: true,
        }
    );
}

#[test]
fn an_operation_in_progress_serialises_to_the_shape_the_ui_expects() {
    let operation = rebasar_core::OperationInProgress {
        kind: rebasar_core::OperationKind::CherryPick,
        step: Some(rebasar_core::OperationStep { current: 2, total: 5 }),
        conflicts: 3,
        can_skip: true,
    };

    assert_eq!(
        serde_json::to_value(operation).unwrap(),
        serde_json::json!({
            "kind": "cherryPick",
            "step": { "current": 2, "total": 5 },
            "conflicts": 3,
            "canSkip": true,
        })
    );
}

#[test]
fn aborting_an_operation_deserialises_as_a_mutation_kind() {
    let kind: rebasar_core::MutationKind =
        serde_json::from_value(serde_json::json!({ "kind": "abortOperation" })).unwrap();

    assert_eq!(kind, rebasar_core::MutationKind::AbortOperation);
}

#[test]
fn a_reset_deserialises_as_a_mutation_kind() {
    let kind: rebasar_core::MutationKind = serde_json::from_value(serde_json::json!({
        "kind": "reset",
        "commit": "abc1234def",
        "mode": "hard",
    }))
    .unwrap();

    assert_eq!(
        kind,
        rebasar_core::MutationKind::Reset {
            commit: "abc1234def".to_owned(),
            mode: rebasar_core::ResetMode::Hard,
        }
    );
}
