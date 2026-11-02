use rebasar_core::Core;

#[test]
fn the_app_reports_its_version_as_a_semantic_version() {
    let version = Core::new(|_| {}).app_info().version;

    let release = version.split(['-', '+']).next().unwrap_or_default();
    let numbers: Vec<_> = release.split('.').collect();

    assert_eq!(numbers.len(), 3, "not major.minor.patch: {version}");
    assert!(
        numbers.iter().all(|part| part.parse::<u32>().is_ok()),
        "not numeric: {version}"
    );
}
