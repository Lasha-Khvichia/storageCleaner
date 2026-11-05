//! Parallel, read-only disk scanner.
//!
//! * Never follows symlinks or junctions (they are recorded as `Link` with
//!   size 0), so a scan can't loop or escape the chosen root.
//! * Cloud-only placeholder files (OneDrive "online-only") count as 0 bytes
//!   because they don't use local disk space.
//! * Directories are walked in parallel with rayon; progress counters are
//!   atomics that a UI thread can poll at any time.
//! * Cancellable through [`ScanControl::cancel`].

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::Instant;

use rayon::prelude::*;
use serde::Serialize;

use crate::error::{Error, Result};
use crate::model::{Node, NodeId, NodeKind, Tree};
use crate::safety::{Classifier, Entry, Markers, Rule};
use crate::util::{now_unix, to_unix};

/// Shared between the scanning threads and whoever watches the scan.
#[derive(Default)]
pub struct ScanControl {
    cancelled: AtomicBool,
    files: AtomicU64,
    dirs: AtomicU64,
    bytes: AtomicU64,
    errors: AtomicU64,
    current: Mutex<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanProgress {
    pub files: u64,
    pub dirs: u64,
    pub bytes: u64,
    pub errors: u64,
    pub current_path: String,
}

impl ScanControl {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn cancel(&self) {
        self.cancelled.store(true, Ordering::Relaxed);
    }

    pub fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::Relaxed)
    }

    pub fn progress(&self) -> ScanProgress {
        ScanProgress {
            files: self.files.load(Ordering::Relaxed),
            dirs: self.dirs.load(Ordering::Relaxed),
            bytes: self.bytes.load(Ordering::Relaxed),
            errors: self.errors.load(Ordering::Relaxed),
            current_path: self.current.lock().map(|s| s.clone()).unwrap_or_default(),
        }
    }

    fn set_current(&self, p: &Path) {
        // Never block a worker thread just to update a status line.
        if let Ok(mut cur) = self.current.try_lock() {
            cur.clear();
            cur.push_str(&p.to_string_lossy());
        }
    }
}

#[derive(Debug, Clone)]
pub struct ScanOptions {
    /// On Unix, don't cross into other mounted file systems.
    pub same_filesystem: bool,
}

impl Default for ScanOptions {
    fn default() -> Self {
        Self { same_filesystem: true }
    }
}

/// Temporary owned tree produced by the parallel walk, flattened afterwards.
struct Temp {
    name: Box<str>,
    kind: NodeKind,
    size: u64,
    files: u64,
    dirs: u64,
    modified: i64,
    rule: Rule,
    errors: u32,
    children: Vec<Temp>,
}

struct Ctx<'a> {
    classifier: &'a Classifier,
    control: &'a ScanControl,
    root_dev: Option<u64>,
    sep: char,
}

/// Scan `root` and build an in-memory tree.
pub fn scan(root: &Path, classifier: &Classifier, control: &ScanControl, opts: &ScanOptions) -> Result<Tree> {
    let started_at = now_unix();
    let t0 = Instant::now();
    let meta = fs::symlink_metadata(root).map_err(|e| Error::io(root, e))?;
    if !meta.is_dir() {
        return Err(Error::Invalid(format!("{} is not a folder", root.display())));
    }
    let root_path: PathBuf = root.to_path_buf();

    let ctx = Ctx {
        classifier,
        control,
        root_dev: if opts.same_filesystem { device_id(&meta) } else { None },
        sep: classifier.sep(),
    };

    // Classify the root (and its ancestors, so inherited rules apply when the
    // user scans a sub-folder such as C:\Windows\Temp).
    let root_rule = classifier.classify_path(&root_path);
    let root_norm = classifier.normalize(&root_path.to_string_lossy());
    let parent_is_root = root_rule == Rule::DriveRoot;
    let temp = walk_dir(
        &root_path,
        &root_norm,
        "".into(),
        modified(&meta),
        Some(root_rule),
        parent_is_root,
        Markers::default(),
        &ctx,
        true,
    );

    if control.is_cancelled() {
        return Err(Error::Cancelled);
    }

    let mut nodes = Vec::with_capacity((temp.files + temp.dirs + 1) as usize);
    flatten(temp, None, &mut nodes);
    Ok(Tree {
        nodes,
        root_path,
        started_at,
        duration_ms: t0.elapsed().as_millis() as u64,
    })
}

#[allow(clippy::too_many_arguments)]
fn walk_dir(
    path: &Path,
    norm: &str,
    name: Box<str>,
    mtime: i64,
    parent_rule: Option<Rule>,
    parent_is_root: bool,
    parent_markers: Markers,
    ctx: &Ctx,
    is_scan_root: bool,
) -> Temp {
    let control = ctx.control;
    control.dirs.fetch_add(1, Ordering::Relaxed);
    let mut node = Temp {
        name,
        kind: NodeKind::Dir,
        size: 0,
        files: 0,
        dirs: 0,
        modified: mtime,
        rule: Rule::Unknown,
        errors: 0,
        children: Vec::new(),
    };
    if control.is_cancelled() {
        return node;
    }
    control.set_current(path);

    let read = match fs::read_dir(path) {
        Ok(r) => r,
        Err(_) => {
            control.errors.fetch_add(1, Ordering::Relaxed);
            node.errors = 1;
            node.rule = if is_scan_root {
                parent_rule.unwrap_or(Rule::Unknown)
            } else {
                classify_self(
                    norm,
                    &node,
                    parent_rule,
                    parent_is_root,
                    Markers::default(),
                    parent_markers,
                    ctx,
                )
            };
            return node;
        }
    };

    // Read all entries first: marker files (CACHEDIR.TAG, pyvenv.cfg) decide
    // how this directory itself is classified.
    let mut entries = Vec::new();
    let mut markers = Markers::default();
    for entry in read {
        match entry {
            Ok(e) => {
                let fname = e.file_name().to_string_lossy().into_owned();
                markers.observe(&fname);
                entries.push((e, fname));
            }
            Err(_) => {
                control.errors.fetch_add(1, Ordering::Relaxed);
                node.errors += 1;
            }
        }
    }

    node.rule = if is_scan_root {
        parent_rule.unwrap_or(Rule::Unknown)
    } else {
        classify_self(norm, &node, parent_rule, parent_is_root, markers, parent_markers, ctx)
    };
    let my_rule = node.rule;
    let i_am_root = my_rule == Rule::DriveRoot;

    let mut subdirs = Vec::new();
    for (entry, fname) in entries {
        let lname = fname.to_lowercase();
        let child_norm = join_norm(norm, &lname, ctx.sep);
        let meta = match entry.metadata() {
            Ok(m) => m,
            Err(_) => {
                control.errors.fetch_add(1, Ordering::Relaxed);
                node.errors += 1;
                continue;
            }
        };
        let ft = meta.file_type();
        let mtime = modified(&meta);
        if ft.is_symlink() {
            node.children.push(leaf(
                fname,
                NodeKind::Link,
                0,
                mtime,
                &child_norm,
                &lname,
                my_rule,
                i_am_root,
                markers,
                ctx,
            ));
        } else if ft.is_dir() {
            if ctx.root_dev.is_some() && device_id(&meta) != ctx.root_dev {
                node.children.push(leaf(
                    fname,
                    NodeKind::Link,
                    0,
                    mtime,
                    &child_norm,
                    &lname,
                    my_rule,
                    i_am_root,
                    markers,
                    ctx,
                ));
                continue;
            }
            subdirs.push((entry.path(), child_norm, fname, mtime));
        } else {
            let size = if is_cloud_placeholder(&meta) { 0 } else { meta.len() };
            control.files.fetch_add(1, Ordering::Relaxed);
            control.bytes.fetch_add(size, Ordering::Relaxed);
            node.children.push(leaf(
                fname,
                NodeKind::File,
                size,
                mtime,
                &child_norm,
                &lname,
                my_rule,
                i_am_root,
                markers,
                ctx,
            ));
        }
    }

    let dir_children: Vec<Temp> = subdirs
        .into_par_iter()
        .map(|(p, n, fname, mtime)| {
            walk_dir(
                &p,
                &n,
                fname.into_boxed_str(),
                mtime,
                Some(my_rule),
                i_am_root,
                markers,
                ctx,
                false,
            )
        })
        .collect();
    node.children.extend(dir_children);

    for c in &node.children {
        node.size += c.size;
        node.errors = node
            .errors
            .saturating_add(if c.kind == NodeKind::Dir { c.errors } else { 0 });
        node.modified = node.modified.max(c.modified);
        match c.kind {
            NodeKind::File => node.files += 1,
            NodeKind::Dir => {
                node.files += c.files;
                node.dirs += c.dirs + 1;
            }
            NodeKind::Link => {}
        }
    }
    node
}

fn classify_self(
    norm: &str,
    node: &Temp,
    parent: Option<Rule>,
    parent_is_root: bool,
    markers: Markers,
    parent_markers: Markers,
    ctx: &Ctx,
) -> Rule {
    let lname = node.name.to_lowercase();
    ctx.classifier.classify(&Entry {
        path: norm,
        name: &lname,
        kind: NodeKind::Dir,
        parent,
        parent_is_root,
        markers,
        parent_markers,
        size: 0,
        modified: node.modified,
    })
}

#[allow(clippy::too_many_arguments)]
fn leaf(
    name: String,
    kind: NodeKind,
    size: u64,
    mtime: i64,
    norm: &str,
    lname: &str,
    parent: Rule,
    parent_is_root: bool,
    parent_markers: Markers,
    ctx: &Ctx,
) -> Temp {
    let rule = ctx.classifier.classify(&Entry {
        path: norm,
        name: lname,
        kind,
        parent: Some(parent),
        parent_is_root,
        markers: Markers::default(),
        parent_markers,
        size,
        modified: mtime,
    });
    Temp {
        name: name.into_boxed_str(),
        kind,
        size,
        files: 0,
        dirs: 0,
        modified: mtime,
        rule,
        errors: 0,
        children: Vec::new(),
    }
}

fn join_norm(parent: &str, lname: &str, sep: char) -> String {
    let mut s = String::with_capacity(parent.len() + 1 + lname.len());
    s.push_str(parent);
    if !s.ends_with(sep) {
        s.push(sep);
    }
    s.push_str(lname);
    s
}

/// Depth-first flatten into the arena; children sorted largest first.
fn flatten(mut t: Temp, parent: Option<NodeId>, out: &mut Vec<Node>) -> NodeId {
    let id = out.len() as NodeId;
    let children = std::mem::take(&mut t.children);
    out.push(Node {
        name: t.name,
        parent,
        kind: t.kind,
        size: t.size,
        files: t.files,
        dirs: t.dirs,
        modified: t.modified,
        children: Vec::with_capacity(children.len()),
        rule: t.rule,
        errors: t.errors,
        deleted: false,
    });
    let mut ids: Vec<(u64, NodeId)> = children
        .into_iter()
        .map(|c| {
            let size = c.size;
            (size, flatten(c, Some(id), out))
        })
        .collect();
    ids.sort_by_key(|a| std::cmp::Reverse(a.0));
    out[id as usize].children = ids.into_iter().map(|(_, i)| i).collect();
    id
}

fn modified(meta: &fs::Metadata) -> i64 {
    meta.modified().map(to_unix).unwrap_or(0)
}

#[cfg(windows)]
fn is_cloud_placeholder(meta: &fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    const FILE_ATTRIBUTE_OFFLINE: u32 = 0x1000;
    const FILE_ATTRIBUTE_RECALL_ON_OPEN: u32 = 0x40000;
    const FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS: u32 = 0x400000;
    meta.file_attributes()
        & (FILE_ATTRIBUTE_OFFLINE | FILE_ATTRIBUTE_RECALL_ON_OPEN | FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS)
        != 0
}

#[cfg(not(windows))]
fn is_cloud_placeholder(_meta: &fs::Metadata) -> bool {
    false
}

#[cfg(unix)]
fn device_id(meta: &fs::Metadata) -> Option<u64> {
    use std::os::unix::fs::MetadataExt;
    Some(meta.dev())
}

#[cfg(not(unix))]
fn device_id(_meta: &fs::Metadata) -> Option<u64> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::safety::SystemPaths;

    fn classifier() -> Classifier {
        Classifier::new(&SystemPaths {
            unix: cfg!(unix),
            ..Default::default()
        })
    }

    #[test]
    fn sizes_and_counts_aggregate() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        fs::create_dir_all(root.join("a/b")).unwrap();
        fs::write(root.join("a/one.bin"), vec![0u8; 1000]).unwrap();
        fs::write(root.join("a/b/two.bin"), vec![0u8; 3000]).unwrap();
        fs::write(root.join("top.txt"), vec![0u8; 10]).unwrap();

        let tree = scan(root, &classifier(), &ScanControl::new(), &ScanOptions::default()).unwrap();
        let r = tree.root();
        assert_eq!(r.size, 4010);
        assert_eq!(r.files, 3);
        assert_eq!(r.dirs, 2);
        // Largest child first.
        let first = &tree.nodes[r.children[0] as usize];
        assert_eq!(&*first.name, "a");
        assert_eq!(first.size, 4000);

        let b = tree.find(&root.join("a").join("b")).unwrap();
        assert_eq!(tree.path_of(b), root.join("a").join("b"));
    }

    #[test]
    fn dev_clutter_is_classified_during_scan() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        fs::create_dir_all(root.join("proj/node_modules/react")).unwrap();
        fs::write(root.join("proj/package.json"), b"{}").unwrap();
        fs::write(root.join("proj/node_modules/react/index.js"), b"x").unwrap();
        fs::create_dir_all(root.join("proj/target/debug")).unwrap();
        fs::write(
            root.join("proj/target/CACHEDIR.TAG"),
            b"Signature: 8a477f597d28d172789f06886806bc55",
        )
        .unwrap();

        let tree = scan(root, &classifier(), &ScanControl::new(), &ScanOptions::default()).unwrap();
        let nm = tree.find(&root.join("proj/node_modules/react/index.js")).unwrap();
        assert_eq!(tree.nodes[nm as usize].rule, Rule::NodeModules);
        let target = tree.find(&root.join("proj/target")).unwrap();
        assert_eq!(tree.nodes[target as usize].rule, Rule::CacheDirTag);
    }

    #[test]
    fn remove_updates_ancestors() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        fs::create_dir_all(root.join("a/b")).unwrap();
        fs::write(root.join("a/b/f.bin"), vec![0u8; 500]).unwrap();
        fs::write(root.join("a/g.bin"), vec![0u8; 100]).unwrap();
        let mut tree = scan(root, &classifier(), &ScanControl::new(), &ScanOptions::default()).unwrap();
        let b = tree.find(&root.join("a/b")).unwrap();
        tree.remove(b);
        assert_eq!(tree.root().size, 100);
        assert_eq!(tree.root().files, 1);
        assert_eq!(tree.root().dirs, 1);
        assert!(tree.find(&root.join("a/b")).is_none());
    }

    #[test]
    fn cancel_stops_scan() {
        let dir = tempfile::tempdir().unwrap();
        let control = ScanControl::new();
        control.cancel();
        assert!(matches!(
            scan(dir.path(), &classifier(), &control, &ScanOptions::default()),
            Err(Error::Cancelled)
        ));
    }
}
