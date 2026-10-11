use rebasar_core::{
    ChangeList, Core, DiffContent, DiffRequest, FileDiff, Hunk, LineKind, ModeChange,
    WhitespaceMode,
};
use rebasar_testkit::TempRepo;

fn request(path: &str, list: ChangeList) -> DiffRequest {
    DiffRequest {
        path: path.to_owned(),
        original_path: None,
        list,
        load_large: false,
        whitespace: WhitespaceMode::Show,
    }
}

fn ignoring_whitespace(path: &str) -> DiffRequest {
    DiffRequest {
        whitespace: WhitespaceMode::IgnoreAll,
        ..request(path, ChangeList::Unstaged)
    }
}

fn diff_of(repo: &TempRepo, request: &DiffRequest) -> FileDiff {
    Core::new(|_| {})
        .file_diff(repo.path(), request)
        .expect("file diff")
}

fn hunks(diff: &FileDiff) -> &[Hunk] {
    match &diff.content {
        DiffContent::Text { hunks } => hunks,
        other => panic!("expected a text diff, got {other:?}"),
    }
}

fn rendered(hunk: &Hunk) -> Vec<String> {
    hunk.lines
        .iter()
        .map(|line| {
            let sign = match line.kind {
                LineKind::Context => ' ',
                LineKind::Added => '+',
                LineKind::Removed => '-',
            };
            format!("{sign}{}", line.text)
        })
        .collect()
}

fn numbered_lines(count: u32) -> String {
    (1..=count).map(|n| format!("line {n}\n")).collect()
}

fn repo_with_initial_commit() -> TempRepo {
    let repo = TempRepo::init("sample");
    repo.commit_file("README.md", "one\ntwo\nthree\n", "Initial commit");
    repo
}

#[test]
fn an_unstaged_edit_shows_the_changed_lines_with_context_and_line_numbers() {
    let repo = repo_with_initial_commit();
    repo.write_file("README.md", "one\nTWO\nthree\n");

    let diff = diff_of(&repo, &request("README.md", ChangeList::Unstaged));

    let [hunk] = hunks(&diff) else {
        panic!("expected one hunk, got {:?}", hunks(&diff));
    };
    assert_eq!(rendered(hunk), [" one", "-two", "+TWO", " three"]);
    assert_eq!(
        (
            hunk.old_start,
            hunk.old_lines,
            hunk.new_start,
            hunk.new_lines
        ),
        (1, 3, 1, 3)
    );
    let numbers: Vec<_> = hunk
        .lines
        .iter()
        .map(|line| (line.old_number, line.new_number))
        .collect();
    assert_eq!(
        numbers,
        [
            (Some(1), Some(1)),
            (Some(2), None),
            (None, Some(2)),
            (Some(3), Some(3)),
        ]
    );
    assert_eq!(diff.mode_change, None);
}

#[test]
fn a_staged_edit_is_compared_with_the_last_commit_not_the_file_on_disk() {
    let repo = repo_with_initial_commit();
    repo.write_file("README.md", "one\ntwo\nthree\nfour\n")
        .stage("README.md")
        .write_file("README.md", "one\ntwo\nthree\nfour\nfive\n");

    let staged = diff_of(&repo, &request("README.md", ChangeList::Staged));
    let unstaged = diff_of(&repo, &request("README.md", ChangeList::Unstaged));

    assert_eq!(
        rendered(&hunks(&staged)[0]),
        [" one", " two", " three", "+four"]
    );
    assert_eq!(
        rendered(&hunks(&unstaged)[0]),
        [" two", " three", " four", "+five"]
    );
}

#[test]
fn an_untracked_file_is_shown_as_entirely_added() {
    let repo = repo_with_initial_commit();
    repo.write_file("notes.txt", "a\nb\n");

    let diff = diff_of(&repo, &request("notes.txt", ChangeList::Unstaged));

    let [hunk] = hunks(&diff) else {
        panic!("expected one hunk");
    };
    assert_eq!(rendered(hunk), ["+a", "+b"]);
    assert_eq!(
        (
            hunk.old_start,
            hunk.old_lines,
            hunk.new_start,
            hunk.new_lines
        ),
        (0, 0, 1, 2)
    );
}

#[test]
fn a_deleted_file_is_shown_as_entirely_removed() {
    let repo = repo_with_initial_commit();
    repo.delete_file("README.md");

    let diff = diff_of(&repo, &request("README.md", ChangeList::Unstaged));

    assert_eq!(rendered(&hunks(&diff)[0]), ["-one", "-two", "-three"]);
}

#[test]
fn distant_edits_become_separate_hunks_and_near_ones_share_a_hunk() {
    let repo = TempRepo::init("sample");
    repo.commit_file("big.txt", &numbered_lines(40), "Initial commit");
    let edited = numbered_lines(40)
        .replace("line 5\n", "FIVE\n")
        .replace("line 9\n", "NINE\n")
        .replace("line 30\n", "THIRTY\n");
    repo.write_file("big.txt", edited);

    let diff = diff_of(&repo, &request("big.txt", ChangeList::Unstaged));

    let found = hunks(&diff);
    assert_eq!(found.len(), 2);
    assert_eq!(found[0].lines.len(), 13);
    assert_eq!((found[0].old_start, found[0].old_lines), (2, 11));
    assert_eq!((found[1].old_start, found[1].old_lines), (27, 7));
}

#[test]
fn the_end_of_the_file_limits_the_trailing_context() {
    let repo = TempRepo::init("sample");
    repo.commit_file("short.txt", "a\nb\nc\n", "Initial commit");
    repo.write_file("short.txt", "a\nb\nC\n");

    let diff = diff_of(&repo, &request("short.txt", ChangeList::Unstaged));

    assert_eq!(rendered(&hunks(&diff)[0]), [" a", " b", "-c", "+C"]);
}

#[test]
fn a_file_with_only_crlf_line_endings_changed_shows_just_the_edited_line() {
    let repo = repo_with_initial_commit();
    repo.write_file("README.md", "one\r\nTWO\r\nthree\r\n");

    let diff = diff_of(&repo, &request("README.md", ChangeList::Unstaged));

    assert_eq!(
        rendered(&hunks(&diff)[0]),
        [" one", "-two", "+TWO", " three"]
    );
}

#[test]
fn a_binary_file_reports_only_its_sizes() {
    let repo = repo_with_initial_commit();
    repo.commit_file("logo.png", "\u{0}old", "Add logo");
    repo.write_file("logo.png", [0u8, 1, 2, 3, 4, 5, 6]);

    let diff = diff_of(&repo, &request("logo.png", ChangeList::Unstaged));

    assert_eq!(
        diff.content,
        DiffContent::Binary {
            old_bytes: Some(4),
            new_bytes: Some(7),
        }
    );
}

#[test]
fn a_new_binary_file_has_no_old_size() {
    let repo = repo_with_initial_commit();
    repo.write_file("logo.png", [0x89, b'P', 0, 1]);

    let diff = diff_of(&repo, &request("logo.png", ChangeList::Unstaged));

    assert_eq!(
        diff.content,
        DiffContent::Binary {
            old_bytes: None,
            new_bytes: Some(4),
        }
    );
}

#[test]
fn a_file_over_a_megabyte_is_collapsed_until_it_is_asked_for() {
    let repo = repo_with_initial_commit();
    let long_lines = "x".repeat(1000);
    let big: String = (0..1200).map(|n| format!("{long_lines}{n}\n")).collect();
    repo.write_file("big.txt", &big);

    let collapsed = diff_of(&repo, &request("big.txt", ChangeList::Unstaged));

    assert_eq!(
        collapsed.content,
        DiffContent::Collapsed {
            bytes: big.len() as u64,
            lines: None,
        }
    );

    let loaded = diff_of(
        &repo,
        &DiffRequest {
            load_large: true,
            ..request("big.txt", ChangeList::Unstaged)
        },
    );

    assert_eq!(hunks(&loaded)[0].lines.len(), 1200);
}

#[test]
fn a_file_over_twenty_thousand_lines_is_collapsed_until_it_is_asked_for() {
    let repo = repo_with_initial_commit();
    repo.write_file("long.txt", "a\n".repeat(20_001));

    let collapsed = diff_of(&repo, &request("long.txt", ChangeList::Unstaged));

    assert_eq!(
        collapsed.content,
        DiffContent::Collapsed {
            bytes: 40_002,
            lines: Some(20_001),
        }
    );

    let loaded = diff_of(
        &repo,
        &DiffRequest {
            load_large: true,
            ..request("long.txt", ChangeList::Unstaged)
        },
    );

    assert_eq!(hunks(&loaded)[0].lines.len(), 20_001);
}

#[test]
fn a_large_committed_file_is_collapsed_on_the_old_side_too() {
    let repo = repo_with_initial_commit();
    let big = "y".repeat(1024 * 1024 + 1);
    repo.commit_file("big.txt", &big, "Add big file");
    repo.write_file("big.txt", "small\n");

    let diff = diff_of(&repo, &request("big.txt", ChangeList::Unstaged));

    assert_eq!(
        diff.content,
        DiffContent::Collapsed {
            bytes: big.len() as u64,
            lines: None,
        }
    );
}

#[test]
fn a_huge_binary_file_is_reported_as_binary_rather_than_collapsed() {
    let repo = repo_with_initial_commit();
    let mut bytes = vec![0u8; 2 * 1024 * 1024];
    bytes[0] = 1;
    repo.write_file("blob.bin", &bytes);

    let diff = diff_of(&repo, &request("blob.bin", ChangeList::Unstaged));

    assert_eq!(
        diff.content,
        DiffContent::Binary {
            old_bytes: None,
            new_bytes: Some(2 * 1024 * 1024),
        }
    );
}

#[test]
fn a_staged_rename_diffs_against_the_original_path() {
    let repo = repo_with_initial_commit();
    repo.git(&["mv", "README.md", "GUIDE.md"]);
    repo.write_file("GUIDE.md", "one\ntwo\nthree\nfour\n")
        .stage("GUIDE.md");

    let diff = diff_of(
        &repo,
        &DiffRequest {
            original_path: Some("README.md".to_owned()),
            ..request("GUIDE.md", ChangeList::Staged)
        },
    );

    assert_eq!(diff.path, "GUIDE.md");
    assert_eq!(diff.original_path.as_deref(), Some("README.md"));
    assert_eq!(
        rendered(&hunks(&diff)[0]),
        [" one", " two", " three", "+four"]
    );
}

#[test]
fn a_pure_rename_has_no_hunks() {
    let repo = repo_with_initial_commit();
    repo.git(&["mv", "README.md", "GUIDE.md"]);

    let diff = diff_of(
        &repo,
        &DiffRequest {
            original_path: Some("README.md".to_owned()),
            ..request("GUIDE.md", ChangeList::Staged)
        },
    );

    assert_eq!(diff.content, DiffContent::Text { hunks: Vec::new() });
}

#[test]
fn a_staged_mode_change_is_reported_with_the_old_and_new_modes() {
    let repo = repo_with_initial_commit();
    repo.commit_file("run.sh", "echo hi\n", "Add script");
    repo.git(&["update-index", "--chmod=+x", "run.sh"]);

    let diff = diff_of(&repo, &request("run.sh", ChangeList::Staged));

    assert_eq!(
        diff.mode_change,
        Some(ModeChange {
            old: "100644".to_owned(),
            new: "100755".to_owned(),
        })
    );
    assert_eq!(diff.content, DiffContent::Text { hunks: Vec::new() });
}

#[test]
fn editing_an_executable_file_on_disk_does_not_report_a_mode_change() {
    let repo = repo_with_initial_commit();
    repo.commit_file(
        "run.sh",
        "echo hi
",
        "Add script",
    );
    repo.git(&["update-index", "--chmod=+x", "run.sh"]);
    repo.git(&["commit", "--quiet", "--message", "Make it executable"]);
    repo.write_file(
        "run.sh",
        "echo hello
",
    );

    let diff = diff_of(&repo, &request("run.sh", ChangeList::Unstaged));

    assert_eq!(diff.mode_change, None);
    assert_eq!(rendered(&hunks(&diff)[0]), ["-echo hi", "+echo hello"]);
}

#[test]
fn a_mode_change_together_with_an_edit_reports_both() {
    let repo = repo_with_initial_commit();
    repo.commit_file("run.sh", "echo hi\n", "Add script");
    repo.write_file("run.sh", "echo hello\n");
    repo.git(&["add", "run.sh"]);
    repo.git(&["update-index", "--chmod=+x", "run.sh"]);

    let diff = diff_of(&repo, &request("run.sh", ChangeList::Staged));

    assert_eq!(
        diff.mode_change,
        Some(ModeChange {
            old: "100644".to_owned(),
            new: "100755".to_owned(),
        })
    );
    assert_eq!(rendered(&hunks(&diff)[0]), ["-echo hi", "+echo hello"]);
}

#[test]
fn a_conflicted_file_is_compared_with_our_side_of_the_merge() {
    let repo = repo_with_initial_commit();
    repo.git(&["checkout", "--quiet", "-b", "topic"]);
    repo.commit_file("README.md", "one\ntopic\nthree\n", "Topic edit");
    repo.git(&["checkout", "--quiet", "main"]);
    repo.commit_file("README.md", "one\nmain\nthree\n", "Main edit");
    repo.git_fails(&["merge", "topic"]);

    let diff = diff_of(&repo, &request("README.md", ChangeList::Conflicts));

    let added: Vec<_> = hunks(&diff)
        .iter()
        .flat_map(|hunk| &hunk.lines)
        .filter(|line| line.kind == LineKind::Added)
        .map(|line| line.text.as_str())
        .collect();
    assert!(added.contains(&"<<<<<<< HEAD"), "{added:?}");
    assert!(added.contains(&"topic"), "{added:?}");
}

#[test]
fn a_repository_without_commits_diffs_staged_files_against_nothing() {
    let repo = TempRepo::init("fresh");
    repo.write_file("a.txt", "a\n").stage("a.txt");

    let diff = diff_of(&repo, &request("a.txt", ChangeList::Staged));

    assert_eq!(rendered(&hunks(&diff)[0]), ["+a"]);
}

#[test]
fn a_path_outside_the_worktree_is_refused() {
    let repo = repo_with_initial_commit();

    let error = Core::new(|_| {})
        .file_diff(repo.path(), &request("../secret.txt", ChangeList::Unstaged))
        .expect_err("outside the Worktree");

    assert!(matches!(error, rebasar_core::ApiError::Unexpected { .. }));
}

#[test]
fn a_diff_request_for_a_plain_folder_reports_it() {
    let folder = tempfile::tempdir().expect("temp dir");

    let error = Core::new(|_| {})
        .file_diff(folder.path(), &request("a.txt", ChangeList::Unstaged))
        .expect_err("not a repository");

    assert!(matches!(
        error,
        rebasar_core::ApiError::NotARepository { .. }
    ));
}

#[test]
fn whitespace_only_edits_are_shown_by_default() {
    let repo = repo_with_initial_commit();
    repo.write_file("README.md", "one\n  two\nthree \n");

    let diff = diff_of(&repo, &request("README.md", ChangeList::Unstaged));

    assert_eq!(
        rendered(&hunks(&diff)[0]),
        [" one", "-two", "-three", "+  two", "+three "]
    );
}

#[test]
fn ignoring_whitespace_hides_edits_that_only_touch_whitespace() {
    let repo = repo_with_initial_commit();
    repo.write_file("README.md", "one\n  two\nthree \n");

    let diff = diff_of(&repo, &ignoring_whitespace("README.md"));

    assert_eq!(diff.content, DiffContent::Text { hunks: Vec::new() });
}

#[test]
fn ignoring_whitespace_still_shows_the_real_edits_next_to_whitespace_ones() {
    let repo = repo_with_initial_commit();
    repo.write_file("README.md", "ONE\n\ttwo\nthree\n");

    let diff = diff_of(&repo, &ignoring_whitespace("README.md"));

    assert_eq!(
        rendered(&hunks(&diff)[0]),
        ["-one", "+ONE", " two", " three"]
    );
}

#[test]
fn ignoring_whitespace_treats_inner_spacing_and_line_endings_alike() {
    let repo = repo_with_initial_commit();
    repo.commit_file("code.txt", "let a = 1;\nlet b = 2;", "Add code");
    repo.write_file("code.txt", "let   a=1;\r\nlet b = 2;\n");

    let diff = diff_of(&repo, &ignoring_whitespace("code.txt"));

    assert_eq!(diff.content, DiffContent::Text { hunks: Vec::new() });
}
