use std::io::{self, Write};
use std::path::Path;

use super::git;

const MAX_OPEN_BRANCHES: usize = 20;
const AUTHORS: usize = 40;
const FIRST_COMMIT_TIME: u64 = 1_500_000_000;

/// A deterministic xorshift generator, so every machine builds the same history.
struct Rng(u64);

impl Rng {
    fn below(&mut self, bound: usize) -> usize {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        (self.0 % bound as u64) as usize
    }
}

struct Branch {
    name: String,
    tip: usize,
}

/// Builds `commits` commits on `main` and short-lived topic branches that fork and merge back,
/// leaving the surviving branches as refs and `main` checked out.
pub fn generate(repo: &Path, commits: usize) -> io::Result<()> {
    let mut merged_branches = Vec::new();

    git::fast_import(repo, |out| {
        let mut rng = Rng(0x9E37_79B9_7F4A_7C15);
        let mut open = vec![Branch {
            name: "main".to_owned(),
            tip: 1,
        }];
        let mut topics = 0;
        write_commit(out, 1, "main", &mut rng, None, None)?;

        for mark in 2..=commits {
            let roll = rng.below(100);
            if roll < 8 && open.len() < MAX_OPEN_BRANCHES {
                topics += 1;
                let parent = open[rng.below(open.len())].tip;
                let name = format!("topic-{topics}");
                write_commit(out, mark, &name, &mut rng, Some(parent), None)?;
                open.push(Branch { name, tip: mark });
            } else if roll < 16 && open.len() > 1 {
                // `main` stays open for the whole history; only topics are merged away.
                let source = 1 + rng.below(open.len() - 1);
                let merged = open.remove(source);
                let target = rng.below(open.len());
                let into = &mut open[target];
                write_commit(
                    out,
                    mark,
                    &into.name,
                    &mut rng,
                    Some(into.tip),
                    Some(merged.tip),
                )?;
                into.tip = mark;
                merged_branches.push(merged.name);
            } else {
                let chosen = rng.below(open.len());
                let branch = &mut open[chosen];
                write_commit(out, mark, &branch.name, &mut rng, Some(branch.tip), None)?;
                branch.tip = mark;
            }
        }
        Ok(())
    })?;

    // A merged topic is reachable from the branch that took it. Keeping its ref would leave
    // tens of thousands of dead branches in a history that should look like a real one.
    let deletions: String = merged_branches
        .iter()
        .map(|name| format!("delete refs/heads/{name}\n"))
        .collect();
    git::update_refs(repo, &deletions)?;
    git::run(repo, &["reset", "--hard", "--quiet"])
}

fn write_commit(
    out: &mut impl Write,
    mark: usize,
    branch: &str,
    rng: &mut Rng,
    parent: Option<usize>,
    merged: Option<usize>,
) -> io::Result<()> {
    let author = rng.below(AUTHORS);
    let timestamp = FIRST_COMMIT_TIME + mark as u64 * 60;
    let message = format!("Commit {mark} on {branch}\n");
    let file = format!("src/d{}/f{}.txt", rng.below(40), rng.below(25));
    let contents = format!("commit {mark}\n");
    let identity = format!("Author {author} <author{author}@example.com> {timestamp} +0000");

    writeln!(out, "commit refs/heads/{branch}")?;
    writeln!(out, "mark :{mark}")?;
    writeln!(out, "author {identity}")?;
    writeln!(out, "committer {identity}")?;
    writeln!(out, "data {}", message.len())?;
    out.write_all(message.as_bytes())?;
    if let Some(parent) = parent {
        writeln!(out, "from :{parent}")?;
    }
    if let Some(merged) = merged {
        writeln!(out, "merge :{merged}")?;
    }
    writeln!(out, "M 100644 inline {file}")?;
    writeln!(out, "data {}", contents.len())?;
    out.write_all(contents.as_bytes())?;
    writeln!(out)
}
