use rebasar_core::{Assessment, Core, MutationKind, MutationOutcome};
use rebasar_testkit::TempRepo;

fn core() -> Core {
    Core::new(|_| {})
}

fn ok(outcome: Result<MutationOutcome, rebasar_core::ApiError>) {
    assert_eq!(outcome.expect("runs"), MutationOutcome::Succeeded);
}

fn repo() -> TempRepo {
    let repo = TempRepo::init("sample");
    repo.commit_file("a.txt", "one\n", "Initial commit");
    repo
}

#[test]
fn tags_are_listed_by_name_with_what_they_point_at() {
    let repo = repo();
    repo.git(&["tag", "v1-light"]);
    repo.git(&["tag", "-a", "v2-annotated", "-m", "Release two"]);

    let tags = core().list_tags(repo.path()).unwrap();

    let summary: Vec<_> = tags.iter().map(|t| (t.name.as_str(), t.annotated, t.subject.as_str())).collect();
    assert_eq!(
        summary,
        [("v1-light", false, "Initial commit"), ("v2-annotated", true, "Initial commit")]
    );
    assert_eq!(tags[0].short_id.len(), 7);
}

#[test]
fn a_lightweight_and_an_annotated_tag_can_be_created_at_head() {
    let repo = repo();

    ok(core().create_tag_here(repo.path(), "light", None));
    ok(core().create_tag_here(repo.path(), "heavy", Some("With a message")));

    let tags = core().list_tags(repo.path()).unwrap();
    assert_eq!(tags.iter().map(|t| (t.name.as_str(), t.annotated)).collect::<Vec<_>>(), [("heavy", true), ("light", false)]);
    assert!(repo.git(&["tag", "-n1", "heavy"]).contains("With a message"));
}

#[test]
fn an_existing_tag_or_a_bad_name_is_not_created() {
    let repo = repo();
    ok(core().create_tag_here(repo.path(), "v1", None));

    let again = core().create_tag_here(repo.path(), "v1", None).unwrap();
    let bad = core().create_tag_here(repo.path(), "bad name", None).unwrap();

    assert!(matches!(again, MutationOutcome::Failed { .. }));
    assert!(matches!(bad, MutationOutcome::Failed { .. }));
    assert!(core().create_tag_here(repo.path(), "--force", None).is_err());
    assert_eq!(core().list_tags(repo.path()).unwrap().len(), 1);
}

#[test]
fn deleting_a_tag_on_a_reachable_commit_loses_nothing_and_removes_it() {
    let repo = repo();
    repo.git(&["tag", "v1"]);
    let kind = MutationKind::DeleteTag { name: "v1".to_owned() };
    assert_eq!(core().assess_mutation(repo.path(), &kind).unwrap(), Assessment::Safe);

    ok(core().delete_tag(repo.path(), "v1"));

    assert!(core().list_tags(repo.path()).unwrap().is_empty());
}

#[test]
fn deleting_the_only_reference_to_a_commit_names_the_commits_lost() {
    let repo = repo();
    repo.create_branch("topic");
    repo.commit_file("t.txt", "t\n", "Only the tag reaches this");
    repo.git(&["tag", "keep-me"]);
    repo.checkout("main");
    repo.git(&["branch", "-D", "topic"]);
    let kind = MutationKind::DeleteTag { name: "keep-me".to_owned() };

    let Assessment::Destructive { loss } = core().assess_mutation(repo.path(), &kind).unwrap() else {
        panic!("a commit would become unreachable");
    };

    assert_eq!(loss.commits, 1);
}

#[test]
fn a_tag_is_pushed_to_a_remote_and_can_be_deleted_there() {
    let repo = repo();
    repo.add_bare_remote("origin");
    repo.git(&["tag", "v1"]);

    ok(core().push_tag(repo.path(), "v1", "origin"));
    assert!(repo.git(&["ls-remote", "--tags", "origin"]).contains("refs/tags/v1"));

    let kind = MutationKind::DeleteRemoteTag { name: "v1".to_owned(), remote: "origin".to_owned() };
    assert_eq!(core().assess_mutation(repo.path(), &kind).unwrap(), Assessment::Safe);
    ok(core().delete_remote_tag(repo.path(), "v1", "origin"));

    assert!(!repo.git(&["ls-remote", "--tags", "origin"]).contains("refs/tags/v1"));
    assert_eq!(core().list_tags(repo.path()).unwrap().len(), 1, "the local tag stays");
}

#[test]
fn pushing_a_tag_that_does_not_exist_fails() {
    let repo = repo();
    repo.add_bare_remote("origin");

    let outcome = core().push_tag(repo.path(), "ghost", "origin").unwrap();

    assert!(matches!(outcome, MutationOutcome::Failed { .. }));
}

#[test]
fn remotes_are_listed_with_their_addresses() {
    let repo = repo();
    repo.git(&["remote", "add", "origin", "https://example.com/team/app.git"]);
    repo.git(&["remote", "add", "mirror", "https://example.com/mirror.git"]);
    repo.git(&["remote", "set-url", "--push", "mirror", "ssh://git@example.com/mirror.git"]);

    let remotes = core().list_remotes(repo.path()).unwrap();

    assert_eq!(remotes.iter().map(|r| r.name.as_str()).collect::<Vec<_>>(), ["mirror", "origin"]);
    assert_eq!(remotes[1].url, "https://example.com/team/app.git");
    assert_eq!(remotes[1].push_url, "");
    assert_eq!(remotes[0].push_url, "ssh://git@example.com/mirror.git");
}

#[test]
fn a_remote_can_be_added_renamed_edited_and_removed() {
    let repo = repo();

    ok(core().add_remote(repo.path(), "origin", "https://example.com/a.git"));
    ok(core().rename_remote(repo.path(), "origin", "upstream"));
    ok(core().set_remote_url(repo.path(), "upstream", "https://example.com/b.git"));

    let remotes = core().list_remotes(repo.path()).unwrap();
    assert_eq!((remotes[0].name.as_str(), remotes[0].url.as_str()), ("upstream", "https://example.com/b.git"));

    ok(core().remove_remote(repo.path(), "upstream"));
    assert!(core().list_remotes(repo.path()).unwrap().is_empty());
}

#[test]
fn a_duplicate_remote_or_an_option_like_name_is_refused() {
    let repo = repo();
    ok(core().add_remote(repo.path(), "origin", "https://example.com/a.git"));

    let duplicate = core().add_remote(repo.path(), "origin", "https://example.com/b.git").unwrap();

    assert!(matches!(duplicate, MutationOutcome::Failed { .. }));
    assert!(core().add_remote(repo.path(), "--mirror", "https://example.com/c.git").is_err());
    assert!(core().add_remote(repo.path(), "x", "--upload-pack=evil").is_err());
    assert!(core().add_remote(repo.path(), "x", "  ").is_err());
}
