use rebasar_core::query::{Date, Query, QueryError, Term};

fn terms(input: &str) -> Vec<Term> {
    Query::parse(input)
        .unwrap_or_else(|error| panic!("`{input}` should parse: {error}"))
        .terms
}

fn error(input: &str) -> QueryError {
    Query::parse(input).expect_err("the query is malformed")
}

fn text(value: &str) -> Term {
    Term::Text(value.to_owned())
}

fn date(year: i32, month: u8, day: u8) -> Date {
    Date { year, month, day }
}

#[test]
fn an_empty_or_blank_query_has_no_terms() {
    assert!(Query::parse("").unwrap().is_empty());
    assert!(Query::parse("  \t ").unwrap().is_empty());
}

#[test]
fn bare_words_and_msg_terms_both_search_the_message() {
    assert_eq!(terms("fix msg:parser"), [text("fix"), text("parser")]);
}

#[test]
fn every_key_is_recognised() {
    assert_eq!(
        terms("author:ada path:src/ui branch:main since:2026-01-02 until:2026-03-04"),
        [
            Term::Author("ada".to_owned()),
            Term::Path("src/ui".to_owned()),
            Term::Branch("main".to_owned()),
            Term::Since(date(2026, 1, 2)),
            Term::Until(date(2026, 3, 4)),
        ]
    );
}

#[test]
fn keys_are_case_insensitive_but_values_keep_their_case() {
    assert_eq!(terms("Author:Ada"), [Term::Author("Ada".to_owned())]);
}

#[test]
fn quotes_group_words_into_one_value() {
    assert_eq!(
        terms(r#"author:"Ada Lovelace" "fix the parser""#),
        [
            Term::Author("Ada Lovelace".to_owned()),
            text("fix the parser"),
        ]
    );
}

#[test]
fn a_quoted_value_may_hold_an_escaped_quote_and_backslash() {
    assert_eq!(
        terms(r#"msg:"say \"hi\" \\ bye""#),
        [text(r#"say "hi" \ bye"#)]
    );
}

#[test]
fn a_quoted_word_is_text_even_when_it_looks_like_a_term() {
    assert_eq!(terms(r#""author:ada""#), [text("author:ada")]);
}

#[test]
fn a_backslash_outside_an_escape_is_kept() {
    assert_eq!(terms(r#"msg:"C:\work""#), [text(r"C:\work")]);
}

#[test]
fn paths_are_normalised_to_forward_slashes_without_edges() {
    assert_eq!(terms(r"path:src\ui\"), [Term::Path("src/ui".to_owned())]);
    assert_eq!(terms("path:./src//ui/"), [Term::Path("src/ui".to_owned())]);
    assert_eq!(
        terms("path:/README.md"),
        [Term::Path("README.md".to_owned())]
    );
}

#[test]
fn a_key_with_nothing_after_it_is_text_when_it_is_not_a_known_key() {
    assert_eq!(
        terms("feat: add parser"),
        [text("feat:"), text("add"), text("parser")]
    );
}

#[test]
fn a_known_key_without_a_value_is_an_error_naming_the_key() {
    let error = error("fix author:");

    assert_eq!(error.message, "`author:` needs a value");
    assert_eq!((error.start, error.end), (4, 11));
}

#[test]
fn an_unknown_key_with_a_value_is_an_error_that_lists_the_known_keys() {
    let error = error("autor:ada");

    assert!(error.message.contains("Unknown key `autor:`"), "{error}");
    assert!(error.message.contains("author:"), "{error}");
    assert_eq!((error.start, error.end), (0, 9));
}

#[test]
fn an_unclosed_quote_is_an_error_pointing_at_the_quote() {
    let error = error(r#"fix "the parser"#);

    assert_eq!(error.message, "This quote is never closed");
    assert_eq!(error.start, 4);
}

#[test]
fn empty_quotes_are_an_error() {
    assert!(error(r#""""#).message.contains("Empty quotes"));
}

#[test]
fn dates_must_be_real_calendar_days_in_year_month_day_form() {
    for input in [
        "since:yesterday",
        "since:2026-13-01",
        "since:2026-02-30",
        "since:2025-02-29",
        "since:2026-1-5",
        "until:2026/01/05",
        "until:2026-01-05-01",
    ] {
        let error = error(input);
        assert!(
            error.message.contains("needs a date like 2026-01-31"),
            "{input}: {error}"
        );
    }
}

#[test]
fn a_leap_day_is_a_valid_date() {
    assert_eq!(terms("since:2024-02-29"), [Term::Since(date(2024, 2, 29))]);
}

#[test]
fn a_day_spans_from_midnight_utc_to_the_next_midnight() {
    let day = date(2023, 11, 14);

    assert_eq!(day.start_of_day(), 1_699_920_000);
    assert_eq!(day.end_of_day(), 1_700_006_400);
    assert_eq!(date(1970, 1, 1).start_of_day(), 0);
}

#[test]
fn a_path_that_leaves_the_repository_or_is_empty_is_an_error() {
    for input in ["path:../secret", "path:src/../../x", "path:/", "path:./"] {
        assert!(
            error(input).message.contains("inside the repository"),
            "{input}"
        );
    }
}

#[test]
fn the_error_offsets_count_characters_not_bytes() {
    let error = error("é author:");

    assert_eq!((error.start, error.end), (2, 9));
}

#[test]
fn a_parse_result_serialises_for_the_ui() {
    let query = Query::parse("author:ada fix since:2026-01-02").unwrap();

    assert_eq!(
        serde_json::to_value(query).unwrap(),
        serde_json::json!({ "terms": [
            { "key": "author", "value": "ada" },
            { "key": "text", "value": "fix" },
            { "key": "since", "value": { "year": 2026, "month": 1, "day": 2 } },
        ]})
    );
}
