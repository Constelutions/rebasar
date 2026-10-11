//! Runs every Git mutation through the system `git`, one at a time per Repository.
//!
//! Reads never come through here, so they stay concurrent with a running mutation.

use std::collections::{HashMap, VecDeque};
use std::ffi::OsString;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Condvar, Mutex, MutexGuard};

use serde::{Deserialize, Serialize};

use crate::{open_worktree, platform, ApiError, CoreEvent};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct MutationId(u64);

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MutationInfo {
    pub id: MutationId,
    pub worktree_path: String,
    pub title: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum OutputStream {
    Stdout,
    Stderr,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum MutationOutcome {
    Succeeded,
    /// `exit_code` is `None` when `git` could not be started or was ended by a signal.
    Failed {
        exit_code: Option<i32>,
    },
    Cancelled,
}

pub(crate) struct Mutation {
    title: String,
    args: Vec<OsString>,
    stdin: Option<Vec<u8>>,
}

impl Mutation {
    pub(crate) fn new<I, A>(title: impl Into<String>, args: I) -> Self
    where
        I: IntoIterator<Item = A>,
        A: Into<OsString>,
    {
        Self {
            title: title.into(),
            args: args.into_iter().map(Into::into).collect(),
            stdin: None,
        }
    }

    pub(crate) fn with_stdin(mut self, input: Vec<u8>) -> Self {
        self.stdin = Some(input);
        self
    }
}

type EventSink = Arc<dyn Fn(CoreEvent) + Send + Sync>;

pub(crate) struct MutationRunner {
    on_event: EventSink,
    next_id: AtomicU64,
    queues: Mutex<HashMap<PathBuf, Arc<RepositoryQueue>>>,
    controls: Mutex<HashMap<MutationId, Arc<Control>>>,
}

impl MutationRunner {
    pub(crate) fn new(on_event: EventSink) -> Self {
        Self {
            on_event,
            next_id: AtomicU64::new(1),
            queues: Mutex::new(HashMap::new()),
            controls: Mutex::new(HashMap::new()),
        }
    }

    /// Blocks until the mutation has finished, waiting first for every earlier mutation on
    /// the same Repository. Progress is reported through events as it happens.
    pub(crate) fn run(
        &self,
        worktree: &Path,
        mutation: Mutation,
    ) -> Result<MutationOutcome, ApiError> {
        let (worktree_path, repo) = open_worktree(worktree)?;
        let common_dir = platform::canonical(repo.common_dir()).map_err(ApiError::unexpected)?;
        drop(repo);

        let id = MutationId(self.next_id.fetch_add(1, Ordering::Relaxed));
        let queue = Arc::clone(
            lock(&self.queues)
                .entry(common_dir)
                .or_insert_with(|| Arc::new(RepositoryQueue::default())),
        );
        let control = Arc::new(Control::new(Arc::clone(&queue)));
        lock(&self.controls).insert(id, Arc::clone(&control));

        let reported_path = worktree_path.to_string_lossy().into_owned();
        self.emit(CoreEvent::MutationQueued {
            mutation: MutationInfo {
                id,
                worktree_path: reported_path.clone(),
                title: mutation.title.clone(),
            },
        });

        let outcome = match queue.enter(id, &control) {
            Some(turn) => {
                self.emit(CoreEvent::MutationStarted { mutation_id: id });
                let outcome = self.execute(id, &worktree_path, &mutation, &control);
                lock(&self.controls).remove(&id);
                // Everything is reported before the turn is released so that the next
                // mutation's events can never overtake this one's.
                self.emit(CoreEvent::MutationFinished {
                    mutation_id: id,
                    outcome,
                });
                // Also reported by the file watcher, but only after its quiet period; this
                // makes the view current the moment the mutation ends.
                self.emit(CoreEvent::WorktreeChanged {
                    worktree_path: reported_path,
                });
                drop(turn);
                outcome
            }
            None => {
                lock(&self.controls).remove(&id);
                self.emit(CoreEvent::MutationFinished {
                    mutation_id: id,
                    outcome: MutationOutcome::Cancelled,
                });
                MutationOutcome::Cancelled
            }
        };
        Ok(outcome)
    }

    /// Does nothing for a mutation that has already finished.
    pub(crate) fn cancel(&self, id: MutationId) {
        let control = lock(&self.controls).get(&id).cloned();
        if let Some(control) = control {
            control.cancel();
        }
    }

    fn execute(
        &self,
        id: MutationId,
        worktree_path: &Path,
        mutation: &Mutation,
        control: &Control,
    ) -> MutationOutcome {
        let mut command = platform::non_interactive_git_command();
        command
            .current_dir(worktree_path)
            .args(&mutation.args)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        if mutation.stdin.is_some() {
            command.stdin(Stdio::piped());
        }
        let spawned = command.spawn();
        let mut child = match spawned {
            Ok(child) => child,
            Err(error) => {
                self.emit_output(
                    id,
                    OutputStream::Stderr,
                    format!("could not start git: {error}"),
                    false,
                );
                return MutationOutcome::Failed { exit_code: None };
            }
        };

        // Cancel can only reach the process once it is registered, so a cancel that arrived
        // earlier is honoured here.
        if let Ok(tree) = platform::ProcessTree::adopt(&child) {
            let mut registered = lock(&control.tree);
            if control.is_cancelled() {
                tree.kill();
            }
            *registered = Some(tree);
        }

        let stdout = child.stdout.take().expect("piped stdout");
        let stderr = child.stderr.take().expect("piped stderr");
        let stdin = child.stdin.take();
        let status = std::thread::scope(|scope| {
            if let (Some(mut stdin), Some(input)) = (stdin, mutation.stdin.as_deref()) {
                // Written beside the readers so a full pipe in either direction cannot stall
                // git; a failed write surfaces as git's own exit status.
                scope.spawn(move || stdin.write_all(input));
            }
            scope.spawn(|| self.stream_output(id, OutputStream::Stdout, stdout));
            scope.spawn(|| self.stream_output(id, OutputStream::Stderr, stderr));
            child.wait()
        });
        lock(&control.tree).take();

        match status {
            Ok(status) if status.success() => MutationOutcome::Succeeded,
            _ if control.is_cancelled() => MutationOutcome::Cancelled,
            Ok(status) => MutationOutcome::Failed {
                exit_code: status.code(),
            },
            Err(_) => MutationOutcome::Failed { exit_code: None },
        }
    }

    fn stream_output(&self, id: MutationId, stream: OutputStream, mut source: impl Read) {
        let mut lines = LineSplitter::default();
        let mut buffer = [0u8; 8192];
        loop {
            match source.read(&mut buffer) {
                Ok(0) | Err(_) => break,
                Ok(read) => lines.push(&buffer[..read], &mut |text, transient| {
                    self.emit_output(id, stream, text, transient);
                }),
            }
        }
        lines.finish(&mut |text, transient| self.emit_output(id, stream, text, transient));
    }

    fn emit_output(&self, id: MutationId, stream: OutputStream, text: String, transient: bool) {
        self.emit(CoreEvent::MutationOutput {
            mutation_id: id,
            stream,
            text,
            transient,
        });
    }

    fn emit(&self, event: CoreEvent) {
        (self.on_event)(event);
    }
}

/// Fair: mutations take their turn in the order they arrived.
#[derive(Default)]
struct RepositoryQueue {
    state: Mutex<QueueState>,
    changed: Condvar,
}

#[derive(Default)]
struct QueueState {
    waiting: VecDeque<MutationId>,
    busy: bool,
}

struct Turn<'a>(&'a RepositoryQueue);

impl Drop for Turn<'_> {
    fn drop(&mut self) {
        lock(&self.0.state).busy = false;
        self.0.changed.notify_all();
    }
}

impl RepositoryQueue {
    /// Waits for the turn; `None` when the mutation was cancelled while it was still waiting.
    fn enter(&self, id: MutationId, control: &Control) -> Option<Turn<'_>> {
        let mut state = lock(&self.state);
        state.waiting.push_back(id);
        loop {
            if control.is_cancelled() {
                state.waiting.retain(|waiting| *waiting != id);
                self.changed.notify_all();
                return None;
            }
            if !state.busy && state.waiting.front() == Some(&id) {
                state.waiting.pop_front();
                state.busy = true;
                return Some(Turn(self));
            }
            state = self
                .changed
                .wait(state)
                .unwrap_or_else(|poisoned| poisoned.into_inner());
        }
    }
}

struct Control {
    cancelled: AtomicBool,
    tree: Mutex<Option<platform::ProcessTree>>,
    queue: Arc<RepositoryQueue>,
}

impl Control {
    fn new(queue: Arc<RepositoryQueue>) -> Self {
        Self {
            cancelled: AtomicBool::new(false),
            tree: Mutex::new(None),
            queue,
        }
    }

    fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::SeqCst)
    }

    fn cancel(&self) {
        self.cancelled.store(true, Ordering::SeqCst);
        if let Some(tree) = lock(&self.tree).as_ref() {
            tree.kill();
        }
        // Taking the queue lock first means a waiter is either already asleep or will see the
        // flag before it goes to sleep, so the wake-up cannot be missed.
        drop(lock(&self.queue.state));
        self.queue.changed.notify_all();
    }
}

/// Splits a byte stream into lines. A lone `\r` ends a *transient* line: Git redraws its
/// progress in place that way, so the next line replaces it instead of being added below.
#[derive(Default)]
struct LineSplitter {
    line: Vec<u8>,
    after_carriage_return: bool,
}

impl LineSplitter {
    fn push(&mut self, bytes: &[u8], emit: &mut impl FnMut(String, bool)) {
        for &byte in bytes {
            if self.after_carriage_return {
                self.after_carriage_return = false;
                if byte == b'\n' {
                    self.end_line(false, emit);
                    continue;
                }
                self.end_line(true, emit);
            }
            match byte {
                b'\n' => self.end_line(false, emit),
                b'\r' => self.after_carriage_return = true,
                _ => self.line.push(byte),
            }
        }
    }

    fn finish(&mut self, emit: &mut impl FnMut(String, bool)) {
        self.after_carriage_return = false;
        if !self.line.is_empty() {
            self.end_line(false, emit);
        }
    }

    fn end_line(&mut self, transient: bool, emit: &mut impl FnMut(String, bool)) {
        if transient && self.line.is_empty() {
            return;
        }
        emit(String::from_utf8_lossy(&self.line).into_owned(), transient);
        self.line.clear();
    }
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}
