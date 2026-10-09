use rebasar_core::{ApiError, CoreEvent, Head, Tab};
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
