use std::collections::HashSet;

use gix::ObjectId;

use super::commit::read_commit;
use super::filter::Filter;
use crate::ApiError;

/// How many commits reachable from `tips` the filter lets through.
pub(super) fn count_matching(
    repo: &gix::Repository,
    filter: &Filter,
    tips: Vec<ObjectId>,
) -> Result<usize, ApiError> {
    let mut visited: HashSet<ObjectId> = tips.iter().copied().collect();
    let mut pending = tips;
    let mut matching = 0;
    while let Some(id) = pending.pop() {
        let Some((commit, accepted)) = read_commit(repo, id, filter)? else {
            continue;
        };
        matching += usize::from(accepted);
        for parent in commit.parents {
            if visited.insert(parent) {
                pending.push(parent);
            }
        }
    }
    Ok(matching)
}
