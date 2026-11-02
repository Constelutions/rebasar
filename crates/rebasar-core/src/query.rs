//! The filter query language shared by the History filter and the command palette.
//!
//! A query is a list of whitespace-separated terms that must all hold. A term is either
//! `key:value` for one of the keys below or plain text; a value with spaces is double-quoted,
//! and inside quotes `\"` and `\\` stand for a quote and a backslash.
//! Several `author:` terms, like several `branch:` terms, widen the result: a commit by any of
//! those authors holds.
//!
//! | Term              | Meaning                                                              |
//! |-------------------|----------------------------------------------------------------------|
//! | `author:ada`      | the author's name or email contains the text; `author:@me` is you    |
//! | `path:src/ui`     | the commit changed that file, or anything inside that folder         |
//! | `msg:fix`, `fix`  | the commit message contains the text                                 |
//! | `branch:feature`  | selects the branches whose name contains the text                    |
//! | `since:2026-01-31`| committed on or after that day (UTC)                                 |
//! | `until:2026-01-31`| committed on or before that day (UTC)                                |

use std::fmt;

use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize)]
pub struct Query {
    pub terms: Vec<Term>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "key", content = "value", rename_all = "camelCase")]
pub enum Term {
    Text(String),
    Author(String),
    /// Relative to the Worktree root, with `/` separators and no leading or trailing slash.
    Path(String),
    Branch(String),
    Since(Date),
    Until(Date),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct Date {
    pub year: i32,
    pub month: u8,
    pub day: u8,
}

impl Date {
    /// Seconds since the Unix epoch at 00:00 UTC of this day.
    pub fn start_of_day(self) -> i64 {
        days_from_civil(self.year, self.month, self.day) * SECONDS_PER_DAY
    }

    /// Seconds since the Unix epoch at 00:00 UTC of the day after this one.
    pub fn end_of_day(self) -> i64 {
        self.start_of_day() + SECONDS_PER_DAY
    }
}

const SECONDS_PER_DAY: i64 = 86_400;

/// A malformed query. `start..end` are character offsets into the input, for highlighting.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct QueryError {
    pub message: String,
    pub start: usize,
    pub end: usize,
}

impl fmt::Display for QueryError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for QueryError {}

impl Query {
    pub fn parse(input: &str) -> Result<Self, QueryError> {
        let chars: Vec<char> = input.chars().collect();
        let mut terms = Vec::new();
        let mut position = 0;
        loop {
            while chars.get(position).is_some_and(|c| c.is_whitespace()) {
                position += 1;
            }
            if position >= chars.len() {
                return Ok(Self { terms });
            }
            let token = read_token(&chars, position)?;
            position = token.end;
            terms.push(token.into_term()?);
        }
    }

    pub fn is_empty(&self) -> bool {
        self.terms.is_empty()
    }
}

struct Token {
    start: usize,
    end: usize,
    key: Option<String>,
    key_text: String,
    value: String,
}

fn read_token(chars: &[char], start: usize) -> Result<Token, QueryError> {
    let mut position = start;
    while chars.get(position).is_some_and(|c| c.is_ascii_alphabetic()) {
        position += 1;
    }
    let (key, key_text) = if position > start && chars.get(position) == Some(&':') {
        let key_text: String = chars[start..position].iter().collect();
        position += 1;
        (Some(key_text.to_ascii_lowercase()), key_text)
    } else {
        position = start;
        (None, String::new())
    };

    let mut value = String::new();
    let mut quote_start: Option<usize> = None;
    while let Some(&c) = chars.get(position) {
        match (quote_start, c) {
            (None, c) if c.is_whitespace() => break,
            (None, '"') => quote_start = Some(position),
            (Some(_), '"') => quote_start = None,
            (Some(_), '\\') if matches!(chars.get(position + 1), Some('"' | '\\')) => {
                position += 1;
                value.push(chars[position]);
            }
            (_, c) => value.push(c),
        }
        position += 1;
    }
    if let Some(quote) = quote_start {
        return Err(QueryError {
            message: "This quote is never closed".to_owned(),
            start: quote,
            end: position,
        });
    }
    Ok(Token {
        start,
        end: position,
        key,
        key_text,
        value,
    })
}

impl Token {
    fn error(&self, message: impl Into<String>) -> QueryError {
        QueryError {
            message: message.into(),
            start: self.start,
            end: self.end,
        }
    }

    fn into_term(self) -> Result<Term, QueryError> {
        let Some(key) = self.key.as_deref() else {
            return if self.value.is_empty() {
                Err(self.error("Empty quotes match nothing; type some text between them"))
            } else {
                Ok(Term::Text(self.value))
            };
        };

        let known = matches!(
            key,
            "author" | "path" | "msg" | "branch" | "since" | "until"
        );
        if !known {
            // `feat: add` and `http://host` are text people search for, so only a value-carrying
            // unknown key is taken for a typo.
            return if self.value.is_empty() {
                Ok(Term::Text(format!("{}:", self.key_text)))
            } else {
                Err(self.error(format!(
                    "Unknown key `{}:`; use author:, path:, msg:, branch:, since: or until:, or \
                     put the text in quotes to search for it",
                    self.key_text
                )))
            };
        }
        if self.value.is_empty() {
            return Err(self.error(format!("`{key}:` needs a value")));
        }

        match key {
            "author" => Ok(Term::Author(self.value)),
            "msg" => Ok(Term::Text(self.value)),
            "branch" => Ok(Term::Branch(self.value)),
            "path" => normalize_path(&self.value)
                .map(Term::Path)
                .ok_or_else(|| self.error("`path:` needs a file or folder inside the repository")),
            "since" => parse_date(&self.value).map(Term::Since).ok_or_else(|| {
                self.error(format!(
                    "`since:` needs a date like 2026-01-31, got `{}`",
                    self.value
                ))
            }),
            _ => parse_date(&self.value).map(Term::Until).ok_or_else(|| {
                self.error(format!(
                    "`until:` needs a date like 2026-01-31, got `{}`",
                    self.value
                ))
            }),
        }
    }
}

fn normalize_path(raw: &str) -> Option<String> {
    let slashed = raw.replace('\\', "/");
    let segments: Vec<&str> = slashed
        .split('/')
        .filter(|segment| !segment.is_empty() && *segment != ".")
        .collect();
    if segments.is_empty() || segments.contains(&"..") {
        return None;
    }
    Some(segments.join("/"))
}

fn parse_date(raw: &str) -> Option<Date> {
    let mut parts = raw.split('-');
    let (year, month, day) = (parts.next()?, parts.next()?, parts.next()?);
    if parts.next().is_some()
        || year.len() != 4
        || month.len() != 2
        || day.len() != 2
        || ![year, month, day]
            .iter()
            .all(|part| part.bytes().all(|b| b.is_ascii_digit()))
    {
        return None;
    }
    let (year, month, day): (i32, u8, u8) =
        (year.parse().ok()?, month.parse().ok()?, day.parse().ok()?);
    if !(1..=12).contains(&month) || day == 0 || day > days_in_month(year, month) {
        return None;
    }
    Some(Date { year, month, day })
}

fn days_in_month(year: i32, month: u8) -> u8 {
    match month {
        2 if year % 4 == 0 && (year % 100 != 0 || year % 400 == 0) => 29,
        2 => 28,
        4 | 6 | 9 | 11 => 30,
        _ => 31,
    }
}

/// Days since 1970-01-01 of a proleptic Gregorian date (Howard Hinnant's `days_from_civil`).
fn days_from_civil(year: i32, month: u8, day: u8) -> i64 {
    let year = i64::from(year) - i64::from(month <= 2);
    let era = year.div_euclid(400);
    let year_of_era = year.rem_euclid(400);
    let month = i64::from(month);
    let day_of_year = (153 * ((month + 9) % 12) + 2) / 5 + i64::from(day) - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    era * 146_097 + day_of_era - 719_468
}
