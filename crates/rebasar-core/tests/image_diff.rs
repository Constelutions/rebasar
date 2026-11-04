use rebasar_core::{
    ChangeKind, ChangeList, CommitDiffRequest, Core, DiffContent, DiffRequest, FileDiff, ImageSide,
    WhitespaceMode, WorktreeDiffRequest,
};
use rebasar_testkit::TempRepo;

const PNG_SIGNATURE: [u8; 8] = [0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];
const PNG_SIGNATURE_BASE64: &str = "iVBORw0KGgo=";
const IMAGE_CAP: usize = 5 * 1024 * 1024;

fn png(extra: &[u8]) -> Vec<u8> {
    [PNG_SIGNATURE.as_slice(), extra].concat()
}

fn commit_bytes(repo: &TempRepo, path: &str, bytes: &[u8]) -> String {
    repo.write_file(path, bytes).stage(path);
    repo.git(&["commit", "--message", &format!("Change {path}")]);
    repo.head_commit()
}

fn worktree_diff(repo: &TempRepo, path: &str, load_large: bool) -> FileDiff {
    Core::new(|_| {})
        .file_diff(
            repo.path(),
            &DiffRequest {
                path: path.to_owned(),
                original_path: None,
                list: ChangeList::Unstaged,
                load_large,
                whitespace: WhitespaceMode::Show,
            },
        )
        .expect("file diff")
}

fn commit_diff(repo: &TempRepo, commit: &str, path: &str, load_large: bool) -> FileDiff {
    Core::new(|_| {})
        .commit_file_diff(
            repo.path(),
            &CommitDiffRequest {
                commit: commit.to_owned(),
                parent: 0,
                path: path.to_owned(),
                original_path: None,
                load_large,
            },
        )
        .expect("commit file diff")
}

fn image_sides(diff: &FileDiff) -> (&Option<ImageSide>, &Option<ImageSide>) {
    match &diff.content {
        DiffContent::Image { old, new } => (old, new),
        other => panic!("expected an image diff, got {other:?}"),
    }
}

fn side(mime: &str, bytes: u64, data: Option<&str>) -> Option<ImageSide> {
    Some(ImageSide {
        mime: mime.to_owned(),
        bytes,
        data: data.map(str::to_owned),
    })
}

fn repo_with_readme() -> TempRepo {
    let repo = TempRepo::init("sample");
    repo.commit_file("README.md", "one\n", "Initial commit");
    repo
}

#[test]
fn a_modified_image_carries_both_sides_with_mime_size_and_base64_data() {
    let repo = repo_with_readme();
    commit_bytes(&repo, "logo.png", &PNG_SIGNATURE);
    repo.write_file("logo.png", png(&[0, 1, 2]));

    let diff = worktree_diff(&repo, "logo.png", false);

    assert_eq!(
        image_sides(&diff),
        (
            &side("image/png", 8, Some(PNG_SIGNATURE_BASE64)),
            &side("image/png", 11, Some("iVBORw0KGgoAAQI=")),
        )
    );
}

#[test]
fn an_added_image_has_only_an_after_side() {
    let repo = repo_with_readme();
    let commit = commit_bytes(&repo, "logo.png", &PNG_SIGNATURE);

    let diff = commit_diff(&repo, &commit, "logo.png", false);

    assert_eq!(
        image_sides(&diff),
        (&None, &side("image/png", 8, Some(PNG_SIGNATURE_BASE64)))
    );
}

#[test]
fn a_deleted_image_has_only_a_before_side() {
    let repo = repo_with_readme();
    commit_bytes(&repo, "logo.png", &PNG_SIGNATURE);
    repo.git(&["rm", "--quiet", "logo.png"]);
    repo.git(&["commit", "--message", "Remove logo"]);

    let diff = commit_diff(&repo, &repo.head_commit(), "logo.png", false);

    assert_eq!(
        image_sides(&diff),
        (&side("image/png", 8, Some(PNG_SIGNATURE_BASE64)), &None)
    );
}

#[test]
fn an_image_in_a_comparison_with_the_worktree_is_an_image_diff() {
    let repo = repo_with_readme();
    let commit = commit_bytes(&repo, "logo.png", &PNG_SIGNATURE);
    repo.write_file("logo.png", png(&[9]));

    let diff = Core::new(|_| {})
        .compare_file_diff(
            repo.path(),
            &WorktreeDiffRequest {
                commit,
                path: "logo.png".to_owned(),
                load_large: false,
            },
        )
        .expect("compare file diff");

    let (old, new) = image_sides(&diff);
    assert_eq!(old.as_ref().map(|side| side.bytes), Some(8));
    assert_eq!(new.as_ref().map(|side| side.bytes), Some(9));
}

#[test]
fn every_supported_format_is_recognised_by_extension_and_leading_bytes() {
    let formats: [(&str, &[u8], &str); 7] = [
        ("a.png", &PNG_SIGNATURE, "image/png"),
        ("a.jpg", &[0xFF, 0xD8, 0xFF, 0xE0, 0, 16], "image/jpeg"),
        ("a.jpeg", &[0xFF, 0xD8, 0xFF, 0xE1], "image/jpeg"),
        ("a.gif", b"GIF89a\x01\x00", "image/gif"),
        ("a.webp", b"RIFF\x04\x00\x00\x00WEBPVP8 ", "image/webp"),
        ("a.bmp", b"BM\x1e\x00\x00\x00\x00\x00", "image/bmp"),
        ("a.ico", &[0, 0, 1, 0, 1, 0, 16, 16], "image/x-icon"),
    ];
    let repo = repo_with_readme();

    for (path, bytes, mime) in formats {
        let commit = commit_bytes(&repo, path, bytes);
        let diff = commit_diff(&repo, &commit, path, false);
        let (_, new) = image_sides(&diff);
        assert_eq!(new.as_ref().map(|side| side.mime.as_str()), Some(mime), "{path}");
    }
}

#[test]
fn an_extension_is_matched_regardless_of_case() {
    let repo = repo_with_readme();
    let commit = commit_bytes(&repo, "LOGO.PNG", &PNG_SIGNATURE);

    let diff = commit_diff(&repo, &commit, "LOGO.PNG", false);

    image_sides(&diff);
}

#[test]
fn an_svg_stays_a_text_diff() {
    let repo = repo_with_readme();
    let commit = commit_bytes(&repo, "icon.svg", b"<svg xmlns=\"http://www.w3.org/2000/svg\"/>\n");

    let diff = commit_diff(&repo, &commit, "icon.svg", false);

    assert!(matches!(diff.content, DiffContent::Text { .. }));
}

#[test]
fn an_image_extension_without_image_bytes_is_a_plain_binary_file() {
    let repo = repo_with_readme();
    let commit = commit_bytes(&repo, "fake.png", &[0, 1, 2, 3]);

    let diff = commit_diff(&repo, &commit, "fake.png", false);

    assert_eq!(
        diff.content,
        DiffContent::Binary {
            old_bytes: None,
            new_bytes: Some(4)
        }
    );
}

#[test]
fn image_bytes_under_a_non_image_extension_are_a_plain_binary_file() {
    let repo = repo_with_readme();
    let commit = commit_bytes(&repo, "data.bin", &png(&[0]));

    let diff = commit_diff(&repo, &commit, "data.bin", false);

    assert!(matches!(diff.content, DiffContent::Binary { .. }));
}

#[test]
fn an_image_replaced_by_another_kind_of_binary_file_is_a_plain_binary_diff() {
    let repo = repo_with_readme();
    commit_bytes(&repo, "logo.png", &PNG_SIGNATURE);
    repo.write_file("logo.png", [0u8, 1, 2, 3]);

    let diff = worktree_diff(&repo, "logo.png", false);

    assert_eq!(
        diff.content,
        DiffContent::Binary {
            old_bytes: Some(8),
            new_bytes: Some(4)
        }
    );
}

#[test]
fn a_committed_image_over_the_cap_comes_back_without_data_until_it_is_loaded() {
    let repo = repo_with_readme();
    let big = png(&vec![7u8; IMAGE_CAP]);
    let commit = commit_bytes(&repo, "big.png", &big);

    let capped = commit_diff(&repo, &commit, "big.png", false);
    let loaded = commit_diff(&repo, &commit, "big.png", true);

    let (_, capped_new) = image_sides(&capped);
    let (_, loaded_new) = image_sides(&loaded);
    let capped_new = capped_new.as_ref().expect("after side");
    assert_eq!((capped_new.bytes, &capped_new.data), (big.len() as u64, &None));
    assert!(loaded_new.as_ref().expect("after side").data.is_some());
}

#[test]
fn a_worktree_image_over_the_cap_comes_back_without_data_until_it_is_loaded() {
    let repo = repo_with_readme();
    commit_bytes(&repo, "big.png", &PNG_SIGNATURE);
    let big = png(&vec![7u8; IMAGE_CAP]);
    repo.write_file("big.png", &big);

    let capped = worktree_diff(&repo, "big.png", false);
    let loaded = worktree_diff(&repo, "big.png", true);

    let (capped_old, capped_new) = image_sides(&capped);
    assert!(capped_old.as_ref().expect("before side").data.is_some());
    let capped_new = capped_new.as_ref().expect("after side");
    assert_eq!((capped_new.bytes, &capped_new.data), (big.len() as u64, &None));
    let (_, loaded_new) = image_sides(&loaded);
    assert!(loaded_new.as_ref().expect("after side").data.is_some());
}

#[test]
fn an_image_exactly_at_the_cap_loads_directly() {
    let repo = repo_with_readme();
    let at_cap = png(&vec![7u8; IMAGE_CAP - PNG_SIGNATURE.len()]);
    let commit = commit_bytes(&repo, "edge.png", &at_cap);

    let diff = commit_diff(&repo, &commit, "edge.png", false);

    let (_, new) = image_sides(&diff);
    assert!(new.as_ref().expect("after side").data.is_some());
}

#[test]
fn a_comparison_lists_changed_images_without_line_counts() {
    let repo = repo_with_readme();
    commit_bytes(&repo, "gone.png", &PNG_SIGNATURE);
    let commit = commit_bytes(&repo, "logo.png", &PNG_SIGNATURE);
    repo.write_file("logo.png", png(&[1, 2, 3]));
    repo.write_file("big.png", png(&vec![7u8; IMAGE_CAP]));
    repo.git(&["add", "big.png"]);
    repo.delete_file("gone.png");

    let files = Core::new(|_| {})
        .compare_with_worktree(repo.path(), &commit)
        .expect("compare")
        .into_iter()
        .map(|file| (file.path, file.kind, file.added, file.removed))
        .collect::<Vec<_>>();

    assert_eq!(
        files,
        [
            ("big.png".to_owned(), ChangeKind::Added, None, None),
            ("gone.png".to_owned(), ChangeKind::Deleted, None, None),
            ("logo.png".to_owned(), ChangeKind::Modified, None, None),
        ]
    );
}
