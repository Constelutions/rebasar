use std::collections::hash_map::DefaultHasher;
use std::collections::HashMap;
use std::hash::{Hash, Hasher};

use gix::refs::Category;
use gix::ObjectId;

use super::{RefKind, RefLabel};
use crate::ApiError;

/// Every ref the graph shows, read once per page request so a moved ref is noticed.
pub(crate) struct Snapshot {
    pub labels: HashMap<ObjectId, Vec<RefLabel>>,
    pub fingerprint: u64,
}

impl Snapshot {
    pub fn read(repo: &gix::Repository) -> Result<Self, ApiError> {
        let mut tagged: Vec<(ObjectId, RefLabel)> = Vec::new();

        let head = repo.head().map_err(ApiError::unexpected)?;
        if !head.is_unborn() {
            let id = head.into_peeled_id().map_err(ApiError::unexpected)?;
            tagged.push((id.detach(), label(RefKind::Head, "HEAD")));
        }

        for reference in repo
            .references()
            .map_err(ApiError::unexpected)?
            .all()
            .map_err(ApiError::unexpected)?
        {
            let mut reference = reference.map_err(ApiError::unexpected)?;
            let Some((category, short_name)) = reference.name().category_and_short_name() else {
                continue;
            };
            let kind = match category {
                Category::LocalBranch => RefKind::LocalBranch,
                Category::RemoteBranch if !short_name.ends_with(b"/HEAD") => RefKind::RemoteBranch,
                Category::Tag => RefKind::Tag,
                _ => continue,
            };
            let name = short_name.to_string();
            let id = reference.peel_to_id().map_err(ApiError::unexpected)?;
            tagged.push((id.detach(), label(kind, &name)));
        }

        tagged.sort_unstable();
        let mut hasher = DefaultHasher::new();
        tagged.hash(&mut hasher);

        let mut labels: HashMap<ObjectId, Vec<RefLabel>> = HashMap::new();
        for (id, label) in tagged {
            labels.entry(id).or_default().push(label);
        }
        Ok(Self {
            labels,
            fingerprint: hasher.finish(),
        })
    }
}

fn label(kind: RefKind, name: &str) -> RefLabel {
    RefLabel {
        kind,
        name: name.to_owned(),
    }
}
