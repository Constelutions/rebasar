use std::fmt;

use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Limit {
    Milliseconds(u64),
    Megabytes(u64),
}

impl fmt::Display for Limit {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Limit::Milliseconds(ms) => write!(f, "{ms} ms"),
            Limit::Megabytes(mb) => write!(f, "{mb} MB"),
        }
    }
}

#[derive(Debug, PartialEq, Eq, Serialize)]
pub struct Threshold {
    pub id: &'static str,
    pub description: &'static str,
    pub limit: Limit,
}

pub const COLD_START: Threshold = Threshold {
    id: "cold-start",
    description: "Cold start to interactive",
    limit: Limit::Milliseconds(1_000),
};

pub const GRAPH: Threshold = Threshold {
    id: "graph",
    description: "Linux-kernel-sized commit graph usable, scrolling at 60 fps",
    limit: Limit::Milliseconds(2_000),
};

pub const STATUS: Threshold = Threshold {
    id: "status",
    description: "Status on a 100k-file working tree",
    limit: Limit::Milliseconds(300),
};

pub const TAB_SWITCH: Threshold = Threshold {
    id: "tab-switch",
    description: "Tab switch",
    limit: Limit::Milliseconds(100),
};

pub const FIRST_CHANGESET_FILE: Threshold = Threshold {
    id: "first-changeset-file",
    description: "First file of the 5,000-file / 500k-line changeset",
    limit: Limit::Milliseconds(300),
};

pub const IDLE_MEMORY: Threshold = Threshold {
    id: "idle-memory",
    description: "Idle memory",
    limit: Limit::Megabytes(300),
};

pub const THRESHOLDS: [&Threshold; 6] = [
    &COLD_START,
    &GRAPH,
    &STATUS,
    &TAB_SWITCH,
    &FIRST_CHANGESET_FILE,
    &IDLE_MEMORY,
];
