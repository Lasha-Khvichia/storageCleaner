use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::safety::{Rule, SafetyLevel};

pub type NodeId = u32;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum NodeKind {
    Dir,
    File,
    /// Symlink / junction. Never followed, never counted.
    Link,
}

impl NodeKind {
    pub fn as_str(self) -> &'static str {
        match self {
            NodeKind::Dir => "dir",
            NodeKind::File => "file",
            NodeKind::Link => "link",
        }
    }
}

/// One entry in a scanned tree. Kept compact because a full drive can have
/// millions of them.
#[derive(Debug, Clone)]
pub struct Node {
    pub name: Box<str>,
    pub parent: Option<NodeId>,
    pub kind: NodeKind,
    /// Total bytes (for directories: recursive).
    pub size: u64,
    /// Recursive file count (1 for a file).
    pub files: u64,
    /// Recursive sub-directory count.
    pub dirs: u64,
    /// Unix seconds. For directories: newest modification among descendants.
    pub modified: i64,
    /// Children sorted by size, largest first.
    pub children: Vec<NodeId>,
    pub rule: Rule,
    /// Entries that could not be read inside this subtree.
    pub errors: u32,
    pub deleted: bool,
}

impl Node {
    pub fn level(&self) -> SafetyLevel {
        self.rule.level()
    }
}

/// A completed scan held in memory. Nodes live in an arena; ids are indices.
#[derive(Debug)]
pub struct Tree {
    pub nodes: Vec<Node>,
    pub root_path: PathBuf,
    pub started_at: i64,
    pub duration_ms: u64,
}

pub const ROOT: NodeId = 0;

impl Tree {
    pub fn root(&self) -> &Node {
        &self.nodes[ROOT as usize]
    }

    pub fn get(&self, id: NodeId) -> Option<&Node> {
        self.nodes.get(id as usize).filter(|n| !n.deleted)
    }

    /// Full path of a node, rebuilt from the parent chain.
    pub fn path_of(&self, id: NodeId) -> PathBuf {
        let mut parts = Vec::new();
        let mut cur = Some(id);
        while let Some(i) = cur {
            if i == ROOT {
                break;
            }
            let n = &self.nodes[i as usize];
            parts.push(&*n.name);
            cur = n.parent;
        }
        let mut p = self.root_path.clone();
        for part in parts.into_iter().rev() {
            p.push(part);
        }
        p
    }

    /// Locate a node by absolute path (case-insensitive on Windows).
    pub fn find(&self, path: &Path) -> Option<NodeId> {
        // Component-wise, case-insensitive prefix strip (Windows paths are
        // case-insensitive; on Linux names rarely differ only by case).
        let root: Vec<_> = self.root_path.components().collect();
        let full: Vec<_> = path.components().collect();
        if full.len() < root.len() {
            return None;
        }
        for (a, b) in root.iter().zip(&full) {
            if !a
                .as_os_str()
                .to_string_lossy()
                .eq_ignore_ascii_case(&b.as_os_str().to_string_lossy())
            {
                return None;
            }
        }
        let mut cur = ROOT;
        for comp in &full[root.len()..] {
            let name = comp.as_os_str().to_string_lossy();
            let node = &self.nodes[cur as usize];
            cur = *node.children.iter().find(|&&c| {
                let n = &self.nodes[c as usize];
                !n.deleted && n.name.eq_ignore_ascii_case(&name)
            })?;
        }
        Some(cur)
    }

    /// Ancestors of a node, from the root down to (and including) the node.
    pub fn ancestry(&self, id: NodeId) -> Vec<NodeId> {
        let mut chain = vec![id];
        let mut cur = self.nodes[id as usize].parent;
        while let Some(p) = cur {
            chain.push(p);
            cur = self.nodes[p as usize].parent;
        }
        chain.reverse();
        chain
    }

    /// Remove a node (after it has been deleted on disk) and fix the
    /// aggregated sizes and counts of all its ancestors.
    pub fn remove(&mut self, id: NodeId) {
        if id == ROOT || self.get(id).is_none() {
            return;
        }
        let (size, files, dirs, parent) = {
            let n = &self.nodes[id as usize];
            let own_dir = u64::from(n.kind == NodeKind::Dir);
            (n.size, n.files, n.dirs + own_dir, n.parent)
        };
        self.mark_deleted(id);
        if let Some(p) = parent {
            self.nodes[p as usize].children.retain(|&c| c != id);
        }
        let mut cur = parent;
        while let Some(p) = cur {
            let n = &mut self.nodes[p as usize];
            n.size = n.size.saturating_sub(size);
            n.files = n.files.saturating_sub(files);
            n.dirs = n.dirs.saturating_sub(dirs);
            cur = n.parent;
        }
        // Keep the parent's children sorted (sizes above changed).
        let mut cur = parent;
        while let Some(p) = cur {
            let mut children = std::mem::take(&mut self.nodes[p as usize].children);
            children.sort_by(|&a, &b| self.nodes[b as usize].size.cmp(&self.nodes[a as usize].size));
            self.nodes[p as usize].children = children;
            cur = self.nodes[p as usize].parent;
        }
    }

    /// A folder was only partly cleaned: subtract what was freed from it and
    /// its ancestors (its children are stale until the next scan).
    pub fn shrink(&mut self, id: NodeId, bytes: u64) {
        let mut cur = Some(id);
        while let Some(i) = cur {
            let n = &mut self.nodes[i as usize];
            n.size = n.size.saturating_sub(bytes);
            cur = n.parent;
        }
    }

    fn mark_deleted(&mut self, id: NodeId) {
        let mut stack = vec![id];
        while let Some(i) = stack.pop() {
            let n = &mut self.nodes[i as usize];
            n.deleted = true;
            stack.extend(n.children.iter().copied());
        }
    }

    /// Number of live nodes.
    pub fn len(&self) -> usize {
        self.nodes.iter().filter(|n| !n.deleted).count()
    }

    pub fn is_empty(&self) -> bool {
        self.root().children.is_empty()
    }
}

/// Serializable view of a node, sent to the UI / printed by the CLI.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeView {
    pub id: NodeId,
    pub name: String,
    pub path: String,
    pub kind: NodeKind,
    pub size: u64,
    pub files: u64,
    pub dirs: u64,
    pub modified: i64,
    pub child_count: usize,
    pub errors: u32,
    pub safety: SafetyLevel,
    pub category: crate::safety::Category,
    pub rule: &'static str,
    pub reason: &'static str,
    /// Share of the parent's size, 0..=1.
    pub share_of_parent: f64,
}

impl Tree {
    pub fn view(&self, id: NodeId) -> Option<NodeView> {
        let n = self.get(id)?;
        let parent_size = n.parent.map(|p| self.nodes[p as usize].size).unwrap_or(n.size);
        Some(NodeView {
            id,
            name: if id == ROOT {
                self.root_path.to_string_lossy().into_owned()
            } else {
                n.name.to_string()
            },
            path: self.path_of(id).to_string_lossy().into_owned(),
            kind: n.kind,
            size: n.size,
            files: n.files,
            dirs: n.dirs,
            modified: n.modified,
            child_count: n.children.len(),
            errors: n.errors,
            safety: n.rule.level(),
            category: n.rule.category(),
            rule: n.rule.id(),
            reason: n.rule.reason(),
            share_of_parent: if parent_size == 0 {
                0.0
            } else {
                n.size as f64 / parent_size as f64
            },
        })
    }

    pub fn children_views(&self, id: NodeId, offset: usize, limit: usize) -> Vec<NodeView> {
        let Some(n) = self.get(id) else { return Vec::new() };
        n.children
            .iter()
            .skip(offset)
            .take(limit)
            .filter_map(|&c| self.view(c))
            .collect()
    }
}
