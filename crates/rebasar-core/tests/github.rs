use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use rebasar_core::github::{
    GhCli, GitHubServices, HttpClient, HttpError, HttpRequest, HttpResponse,
};
use rebasar_core::platform::{CredentialError, CredentialStore};
use rebasar_core::{
    ApiError, CheckState, Core, GitHubAuthStatus, GitHubRepository, PullRequest, ReviewState,
    TokenSource,
};
use rebasar_testkit::TempRepo;

fn core() -> Core {
    Core::new(|_| {})
}

struct FakeGhCli(Option<&'static str>);

impl GhCli for FakeGhCli {
    fn token(&self) -> Option<String> {
        self.0.map(str::to_owned)
    }
}

#[derive(Default)]
struct MemoryCredentials {
    secrets: Mutex<HashMap<String, String>>,
    fail_saving: bool,
}

impl MemoryCredentials {
    fn holding(secret: &str) -> Self {
        let credentials = Self::default();
        credentials.save("github-token", secret).unwrap();
        credentials
    }

    fn secrets(&self) -> Vec<String> {
        self.secrets.lock().unwrap().values().cloned().collect()
    }
}

impl CredentialStore for MemoryCredentials {
    fn read(&self, account: &str) -> Result<Option<String>, CredentialError> {
        Ok(self.secrets.lock().unwrap().get(account).cloned())
    }

    fn save(&self, account: &str, secret: &str) -> Result<(), CredentialError> {
        if self.fail_saving {
            return Err(CredentialError::new("the credential store is locked"));
        }
        self.secrets
            .lock()
            .unwrap()
            .insert(account.to_owned(), secret.to_owned());
        Ok(())
    }

    fn delete(&self, account: &str) -> Result<(), CredentialError> {
        self.secrets.lock().unwrap().remove(account);
        Ok(())
    }
}

type CannedResponse = Result<(u16, String), String>;

#[derive(Clone, Default)]
struct FakeHttp {
    responses: Arc<Mutex<Vec<CannedResponse>>>,
    requests: Arc<Mutex<Vec<(String, String, String)>>>,
}

impl FakeHttp {
    fn replying(responses: Vec<CannedResponse>) -> Self {
        Self {
            responses: Arc::new(Mutex::new(responses)),
            requests: Arc::default(),
        }
    }

    fn requests(&self) -> Vec<(String, String, String)> {
        self.requests.lock().unwrap().clone()
    }
}

impl HttpClient for FakeHttp {
    fn post_json(&self, request: &HttpRequest) -> Result<HttpResponse, HttpError> {
        self.requests.lock().unwrap().push((
            request.url.clone(),
            request.bearer_token.clone(),
            request.body.clone(),
        ));
        let mut responses = self.responses.lock().unwrap();
        assert!(!responses.is_empty(), "an unexpected request to GitHub");
        match responses.remove(0) {
            Ok((status, body)) => Ok(HttpResponse { status, body }),
            Err(message) => Err(HttpError(message)),
        }
    }
}

fn core_with(
    gh_token: Option<&'static str>,
    credentials: Arc<MemoryCredentials>,
    http: FakeHttp,
) -> Core {
    Core::with_github(
        |_| {},
        GitHubServices {
            http: Arc::new(http),
            credentials,
            gh_cli: Arc::new(FakeGhCli(gh_token)),
        },
    )
}

fn signed_out_core() -> Core {
    core_with(None, Arc::default(), FakeHttp::default())
}

fn status(source: Option<TokenSource>) -> GitHubAuthStatus {
    GitHubAuthStatus { source }
}

fn repo_with_remotes(remotes: &[(&str, &str)]) -> TempRepo {
    let repo = TempRepo::init("sample");
    repo.commit_file("README.md", "hello", "Initial commit");
    for (name, url) in remotes {
        repo.git(&["remote", "add", name, url]);
    }
    repo
}

fn github(owner: &str, name: &str) -> Option<GitHubRepository> {
    Some(GitHubRepository {
        owner: owner.to_owned(),
        name: name.to_owned(),
    })
}

#[test]
fn every_common_form_of_a_github_url_is_recognised() {
    let urls = [
        "https://github.com/acme/widgets.git",
        "https://github.com/acme/widgets",
        "https://github.com/acme/widgets/",
        "https://someone@github.com/acme/widgets.git",
        "git@github.com:acme/widgets.git",
        "ssh://git@github.com/acme/widgets.git",
        "ssh://git@github.com:22/acme/widgets.git",
        "https://GitHub.com/acme/widgets.git",
    ];

    for url in urls {
        let repo = repo_with_remotes(&[("origin", url)]);

        let found = core().github_remote(repo.path()).expect("read remotes");

        assert_eq!(found, github("acme", "widgets"), "for {url}");
    }
}

#[test]
fn a_repository_without_remotes_has_no_github_remote() {
    let repo = repo_with_remotes(&[]);

    assert_eq!(core().github_remote(repo.path()), Ok(None));
}

#[test]
fn remotes_on_other_hosts_are_not_github() {
    let urls = [
        "https://gitlab.com/acme/widgets.git",
        "git@bitbucket.org:acme/widgets.git",
        "https://github.com.evil.example/acme/widgets.git",
        "https://github.com/acme",
        "/some/local/folder",
    ];

    for url in urls {
        let repo = repo_with_remotes(&[("origin", url)]);

        assert_eq!(core().github_remote(repo.path()), Ok(None), "for {url}");
    }
}

#[test]
fn origin_wins_over_other_github_remotes() {
    let repo = repo_with_remotes(&[
        ("fork", "https://github.com/me/widgets.git"),
        ("origin", "https://github.com/acme/widgets.git"),
    ]);

    assert_eq!(
        core().github_remote(repo.path()),
        Ok(github("acme", "widgets"))
    );
}

#[test]
fn another_remote_is_used_when_origin_is_not_on_github() {
    let repo = repo_with_remotes(&[
        ("origin", "https://gitlab.com/acme/widgets.git"),
        ("mirror", "https://github.com/acme/widgets.git"),
    ]);

    assert_eq!(
        core().github_remote(repo.path()),
        Ok(github("acme", "widgets"))
    );
}

const VIEWER_OK: &str = r#"{"data":{"viewer":{"login":"octocat"}}}"#;

#[test]
fn nobody_is_signed_in_without_a_gh_token_or_a_stored_token() {
    assert_eq!(signed_out_core().github_auth_status(), Ok(status(None)));
}

#[test]
fn the_gh_cli_token_is_used_when_gh_is_signed_in() {
    let core = core_with(Some("gh-token"), Arc::default(), FakeHttp::default());

    assert_eq!(
        core.github_auth_status(),
        Ok(status(Some(TokenSource::GhCli)))
    );
}

#[test]
fn a_stored_token_is_used_when_gh_is_not_signed_in() {
    let credentials = Arc::new(MemoryCredentials::holding("stored-token"));
    let core = core_with(None, credentials, FakeHttp::default());

    assert_eq!(
        core.github_auth_status(),
        Ok(status(Some(TokenSource::PersonalAccessToken)))
    );
}

#[test]
fn the_gh_cli_token_is_preferred_over_a_stored_token() {
    let credentials = Arc::new(MemoryCredentials::holding("stored-token"));
    let core = core_with(Some("gh-token"), credentials, FakeHttp::default());

    assert_eq!(
        core.github_auth_status(),
        Ok(status(Some(TokenSource::GhCli)))
    );
}

#[test]
fn a_pasted_token_is_checked_with_github_and_then_stored() {
    let credentials = Arc::new(MemoryCredentials::default());
    let http = FakeHttp::replying(vec![Ok((200, VIEWER_OK.to_owned()))]);
    let core = core_with(None, Arc::clone(&credentials), http.clone());

    let signed_in = core.sign_in_to_github("  pasted-token\n").expect("sign in");

    assert_eq!(signed_in, status(Some(TokenSource::PersonalAccessToken)));
    assert_eq!(credentials.secrets(), vec!["pasted-token".to_owned()]);
    let requests = http.requests();
    assert_eq!(requests.len(), 1);
    assert_eq!(requests[0].1, "pasted-token");
    assert_eq!(
        core.github_auth_status(),
        Ok(status(Some(TokenSource::PersonalAccessToken)))
    );
}

#[test]
fn a_token_that_github_rejects_is_not_stored() {
    let credentials = Arc::new(MemoryCredentials::default());
    let http = FakeHttp::replying(vec![Ok((
        401,
        r#"{"message":"Bad credentials"}"#.to_owned(),
    ))]);
    let core = core_with(None, Arc::clone(&credentials), http);

    let error = core.sign_in_to_github("wrong").expect_err("rejected");

    assert_eq!(error, ApiError::GithubTokenRejected);
    assert!(credentials.secrets().is_empty());
}

#[test]
fn a_blank_token_is_rejected_without_asking_github() {
    let http = FakeHttp::default();
    let core = core_with(None, Arc::default(), http.clone());

    assert_eq!(
        core.sign_in_to_github("   "),
        Err(ApiError::GithubTokenRejected)
    );
    assert!(http.requests().is_empty());
}

#[test]
fn a_network_failure_while_signing_in_is_reported_and_nothing_is_stored() {
    let credentials = Arc::new(MemoryCredentials::default());
    let http = FakeHttp::replying(vec![Err("connection refused".to_owned())]);
    let core = core_with(None, Arc::clone(&credentials), http);

    let error = core.sign_in_to_github("token").expect_err("network down");

    assert!(
        matches!(error, ApiError::GithubRequestFailed { ref message } if message.contains("connection refused")),
        "got {error:?}"
    );
    assert!(credentials.secrets().is_empty());
}

#[test]
fn a_credential_store_failure_while_signing_in_is_reported() {
    let credentials = Arc::new(MemoryCredentials {
        fail_saving: true,
        ..MemoryCredentials::default()
    });
    let http = FakeHttp::replying(vec![Ok((200, VIEWER_OK.to_owned()))]);
    let core = core_with(None, credentials, http);

    let error = core.sign_in_to_github("token").expect_err("store locked");

    assert_eq!(
        error,
        ApiError::Unexpected {
            message: "the credential store is locked".to_owned()
        }
    );
}

#[test]
fn signing_out_removes_the_stored_token() {
    let credentials = Arc::new(MemoryCredentials::holding("stored-token"));
    let core = core_with(None, Arc::clone(&credentials), FakeHttp::default());

    let signed_out = core.sign_out_of_github().expect("sign out");

    assert_eq!(signed_out, status(None));
    assert!(credentials.secrets().is_empty());
}

const PULL_REQUESTS: &str = include_str!("fixtures/pull_requests.json");

fn github_repo() -> TempRepo {
    repo_with_remotes(&[("origin", "https://github.com/acme/widgets.git")])
}

fn pull_request(
    number: u64,
    title: &str,
    author: &str,
    is_draft: bool,
    checks: CheckState,
    review: ReviewState,
) -> PullRequest {
    let (head_branch, base_branch) = match number {
        42 => ("feature/cache", "main"),
        41 => ("parser", "main"),
        40 => ("fix-build", "release"),
        _ => ("docs", "main"),
    };
    PullRequest {
        number,
        title: title.to_owned(),
        url: format!("https://github.com/acme/widgets/pull/{number}"),
        author: author.to_owned(),
        head_branch: head_branch.to_owned(),
        base_branch: base_branch.to_owned(),
        is_draft,
        checks,
        review,
    }
}

#[test]
fn pull_requests_carry_draft_check_and_review_state() {
    let repo = github_repo();
    let http = FakeHttp::replying(vec![Ok((200, PULL_REQUESTS.to_owned()))]);
    let core = core_with(Some("gh-token"), Arc::default(), http);

    let pull_requests = core.pull_requests(repo.path()).expect("list");

    assert_eq!(
        pull_requests,
        vec![
            pull_request(
                42,
                "Add the widget cache",
                "octocat",
                false,
                CheckState::Success,
                ReviewState::Approved
            ),
            pull_request(
                41,
                "WIP: rework the parser",
                "hubot",
                true,
                CheckState::Pending,
                ReviewState::None
            ),
            pull_request(
                40,
                "Fix the build",
                "ghost",
                false,
                CheckState::Failure,
                ReviewState::ChangesRequested
            ),
            pull_request(
                39,
                "Docs",
                "octocat",
                false,
                CheckState::None,
                ReviewState::ReviewRequired
            ),
        ]
    );
}

#[test]
fn pull_requests_are_asked_of_the_remote_repository_with_the_signed_in_token() {
    let repo = github_repo();
    let http = FakeHttp::replying(vec![Ok((200, PULL_REQUESTS.to_owned()))]);
    let credentials = Arc::new(MemoryCredentials::holding("stored-token"));
    let core = core_with(None, credentials, http.clone());

    core.pull_requests(repo.path()).expect("list");

    let requests = http.requests();
    assert_eq!(requests.len(), 1);
    let (url, token, body) = &requests[0];
    assert_eq!(url, "https://api.github.com/graphql");
    assert_eq!(token, "stored-token");
    let body: serde_json::Value = serde_json::from_str(body).unwrap();
    assert_eq!(
        body["variables"],
        serde_json::json!({ "owner": "acme", "name": "widgets" })
    );
}

#[test]
fn pull_requests_of_a_repository_without_a_github_remote_are_refused_before_any_request() {
    let repo = repo_with_remotes(&[("origin", "https://gitlab.com/acme/widgets.git")]);
    let http = FakeHttp::default();
    let core = core_with(Some("gh-token"), Arc::default(), http.clone());

    let error = core.pull_requests(repo.path()).expect_err("not GitHub");

    assert!(matches!(error, ApiError::NotGithub { .. }), "got {error:?}");
    assert!(http.requests().is_empty());
}

#[test]
fn pull_requests_need_a_signed_in_user() {
    let repo = github_repo();
    let http = FakeHttp::default();
    let core = core_with(None, Arc::default(), http.clone());

    assert_eq!(
        core.pull_requests(repo.path()),
        Err(ApiError::GithubNotSignedIn)
    );
    assert!(http.requests().is_empty());
}

#[test]
fn a_token_that_stopped_working_is_reported_as_rejected() {
    let repo = github_repo();
    let http = FakeHttp::replying(vec![Ok((401, "{}".to_owned()))]);
    let core = core_with(Some("expired"), Arc::default(), http);

    assert_eq!(
        core.pull_requests(repo.path()),
        Err(ApiError::GithubTokenRejected)
    );
}

#[test]
fn github_errors_are_reported_with_their_message() {
    let repo = github_repo();
    let body = r#"{"data":null,"errors":[{"message":"API rate limit exceeded"}]}"#;
    let http = FakeHttp::replying(vec![Ok((200, body.to_owned()))]);
    let core = core_with(Some("gh-token"), Arc::default(), http);

    assert_eq!(
        core.pull_requests(repo.path()),
        Err(ApiError::GithubRequestFailed {
            message: "API rate limit exceeded".to_owned()
        })
    );
}

#[test]
fn a_repository_the_token_cannot_see_is_reported() {
    let repo = github_repo();
    let http = FakeHttp::replying(vec![Ok((
        200,
        r#"{"data":{"repository":null}}"#.to_owned(),
    ))]);
    let core = core_with(Some("gh-token"), Arc::default(), http);

    let error = core.pull_requests(repo.path()).expect_err("no access");

    assert!(
        matches!(error, ApiError::GithubRequestFailed { ref message } if message.contains("acme/widgets")),
        "got {error:?}"
    );
}

#[test]
fn an_unexpected_http_status_is_reported() {
    let repo = github_repo();
    let http = FakeHttp::replying(vec![Ok((502, "<html>".to_owned()))]);
    let core = core_with(Some("gh-token"), Arc::default(), http);

    assert_eq!(
        core.pull_requests(repo.path()),
        Err(ApiError::GithubRequestFailed {
            message: "GitHub answered HTTP 502".to_owned()
        })
    );
}
