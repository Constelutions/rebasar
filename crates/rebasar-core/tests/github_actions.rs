use std::sync::{Arc, Mutex};

use rebasar_core::github::{
    GhCli, GitHubServices, HttpClient, HttpError, HttpRequest, HttpResponse,
};
use rebasar_core::platform::{CredentialError, CredentialStore};
use rebasar_core::{ApiError, Core};
use rebasar_testkit::TempRepo;
use serde_json::{json, Value};

struct FakeGhCli(Option<&'static str>);

impl GhCli for FakeGhCli {
    fn token(&self) -> Option<String> {
        self.0.map(str::to_owned)
    }
}

struct NoCredentials;

impl CredentialStore for NoCredentials {
    fn read(&self, _: &str) -> Result<Option<String>, CredentialError> {
        Ok(None)
    }
    fn save(&self, _: &str, _: &str) -> Result<(), CredentialError> {
        Ok(())
    }
    fn delete(&self, _: &str) -> Result<(), CredentialError> {
        Ok(())
    }
}

#[derive(Clone, Default)]
struct FakeHttp {
    responses: Arc<Mutex<Vec<Value>>>,
    requests: Arc<Mutex<Vec<Value>>>,
}

impl FakeHttp {
    fn replying(responses: Vec<Value>) -> Self {
        Self {
            responses: Arc::new(Mutex::new(responses)),
            requests: Arc::default(),
        }
    }

    fn variables(&self) -> Vec<Value> {
        self.requests
            .lock()
            .unwrap()
            .iter()
            .map(|request| request["variables"].clone())
            .collect()
    }
}

impl HttpClient for FakeHttp {
    fn post_json(&self, request: &HttpRequest) -> Result<HttpResponse, HttpError> {
        self.requests
            .lock()
            .unwrap()
            .push(serde_json::from_str(&request.body).unwrap());
        let mut responses = self.responses.lock().unwrap();
        assert!(!responses.is_empty(), "an unexpected request to GitHub");
        Ok(HttpResponse {
            status: 200,
            body: json!({ "data": responses.remove(0) }).to_string(),
        })
    }
}

fn core_with(token: Option<&'static str>, http: FakeHttp) -> Core {
    Core::with_github(
        |_| {},
        GitHubServices {
            http: Arc::new(http),
            credentials: Arc::new(NoCredentials),
            gh_cli: Arc::new(FakeGhCli(token)),
        },
    )
}

fn repo_on(branch: &str) -> TempRepo {
    let repo = TempRepo::init("sample");
    repo.commit_file("a.txt", "one\n", "Initial commit");
    repo.git(&["remote", "add", "origin", "https://github.com/acme/widgets.git"]);
    repo.create_branch(branch);
    repo
}

fn pull_request(number: u64, draft: bool) -> Value {
    json!({ "number": number, "title": "Add login", "body": "Details", "url": format!("https://github.com/acme/widgets/pull/{number}"), "isDraft": draft })
}

#[test]
fn the_open_pull_request_of_the_current_branch_is_found_by_its_head() {
    let repo = repo_on("feature/login");
    let http = FakeHttp::replying(vec![
        json!({ "repository": { "pullRequests": { "nodes": [pull_request(12, false)] } } }),
    ]);
    let core = core_with(Some("token"), http.clone());

    let found = core.current_pull_request(repo.path()).unwrap().expect("found");

    assert_eq!((found.number, found.title.as_str(), found.is_draft), (12, "Add login", false));
    assert_eq!(http.variables()[0]["head"], "feature/login");
    assert_eq!(http.variables()[0]["owner"], "acme");
}

#[test]
fn a_branch_without_a_pull_request_has_none() {
    let repo = repo_on("topic");
    let http = FakeHttp::replying(vec![json!({ "repository": { "pullRequests": { "nodes": [] } } })]);

    assert_eq!(core_with(Some("token"), http).current_pull_request(repo.path()).unwrap(), None);
}

#[test]
fn creating_opens_the_branch_against_the_default_branch_with_title_body_and_draft() {
    let repo = repo_on("feature/login");
    let http = FakeHttp::replying(vec![
        json!({ "repository": { "id": "R_1", "defaultBranchRef": { "name": "develop" } } }),
        json!({ "createPullRequest": { "pullRequest": pull_request(7, true) } }),
    ]);
    let core = core_with(Some("token"), http.clone());

    let created = core
        .create_pull_request(repo.path(), "  Add login  ", "Because", true)
        .unwrap();

    assert_eq!((created.number, created.is_draft), (7, true));
    let input = &http.variables()[1]["input"];
    assert_eq!(input["repositoryId"], "R_1");
    assert_eq!(input["baseRefName"], "develop");
    assert_eq!(input["headRefName"], "feature/login");
    assert_eq!(input["title"], "Add login");
    assert_eq!(input["body"], "Because");
    assert_eq!(input["draft"], true);
}

#[test]
fn a_pull_request_needs_a_title_a_branch_and_a_github_remote_and_a_token() {
    let repo = repo_on("topic");
    let core = core_with(Some("token"), FakeHttp::default());
    assert!(matches!(core.create_pull_request(repo.path(), "  ", "", false), Err(ApiError::Unexpected { .. })));

    repo.detach_head();
    assert!(matches!(core.create_pull_request(repo.path(), "Title", "", false), Err(ApiError::Unexpected { .. })));

    let plain = TempRepo::init("plain");
    plain.commit_file("a.txt", "one\n", "Initial commit");
    assert!(matches!(core.create_pull_request(plain.path(), "Title", "", false), Err(ApiError::NotGithub { .. })));

    let signed_out = core_with(None, FakeHttp::default());
    let again = repo_on("topic");
    assert_eq!(signed_out.create_pull_request(again.path(), "Title", "", false), Err(ApiError::GithubNotSignedIn));
}

#[test]
fn updating_looks_the_pull_request_up_by_number_and_changes_its_text() {
    let repo = repo_on("topic");
    let http = FakeHttp::replying(vec![
        json!({ "repository": { "pullRequest": { "id": "PR_9" } } }),
        json!({ "updatePullRequest": { "pullRequest": pull_request(9, false) } }),
    ]);
    let core = core_with(Some("token"), http.clone());

    core.update_pull_request(repo.path(), 9, "New title", "New body").unwrap();

    assert_eq!(http.variables()[0]["number"], 9);
    let input = &http.variables()[1]["input"];
    assert_eq!((input["pullRequestId"].as_str(), input["title"].as_str(), input["body"].as_str()), (Some("PR_9"), Some("New title"), Some("New body")));
}

#[test]
fn updating_a_pull_request_that_is_gone_says_so() {
    let repo = repo_on("topic");
    let http = FakeHttp::replying(vec![json!({ "repository": { "pullRequest": null } })]);

    let error = core_with(Some("token"), http).update_pull_request(repo.path(), 404, "T", "").unwrap_err();

    assert!(matches!(error, ApiError::GithubRequestFailed { message } if message.contains("#404")));
}

#[test]
fn a_draft_is_marked_ready_for_review() {
    let repo = repo_on("topic");
    let http = FakeHttp::replying(vec![
        json!({ "repository": { "pullRequest": { "id": "PR_3" } } }),
        json!({ "markPullRequestReadyForReview": { "pullRequest": pull_request(3, false) } }),
    ]);
    let core = core_with(Some("token"), http.clone());

    let ready = core.mark_pull_request_ready(repo.path(), 3).unwrap();

    assert!(!ready.is_draft);
    assert_eq!(http.variables()[1]["input"]["pullRequestId"], "PR_3");
}

#[test]
fn only_https_addresses_are_opened_in_the_browser() {
    let core = core_with(None, FakeHttp::default());

    for url in ["file:///C:/Windows/System32/calc.exe", "calc.exe", "http://example.com", "https://a b", "javascript:alert(1)"] {
        assert!(core.open_in_browser(url).is_err(), "{url}");
    }
}
