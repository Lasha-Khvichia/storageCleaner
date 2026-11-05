//! Reports derived from a scanned tree: largest files, file-type breakdown,
//! cleanup suggestions, CSV export and the summary stored in history.

use std::cmp::Reverse;
use std::collections::{BinaryHeap, HashMap};
use std::io::Write;
use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::error::{Error, Result};
use crate::history::ScanSummary;
use crate::model::{NodeId, NodeKind, NodeView, ROOT, Tree};
use crate::safety::{Category, SafetyLevel};

/// The `limit` largest files in the tree.
pub fn largest_files(tree: &Tree, limit: usize) -> Vec<NodeView> {
    let mut heap: BinaryHeap<Reverse<(u64, NodeId)>> = BinaryHeap::with_capacity(limit + 1);
    for (i, n) in tree.nodes.iter().enumerate() {
        if n.deleted || n.kind != NodeKind::File {
            continue;
        }
        heap.push(Reverse((n.size, i as NodeId)));
        if heap.len() > limit {
            heap.pop();
        }
    }
    let mut v: Vec<_> = heap.into_iter().map(|Reverse(x)| x).collect();
    v.sort_by_key(|a| std::cmp::Reverse(a.0));
    v.into_iter().filter_map(|(_, id)| tree.view(id)).collect()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TypeGroup {
    pub group: String,
    pub bytes: u64,
    pub files: u64,
    /// Biggest extensions inside the group: (ext, bytes, files).
    pub extensions: Vec<(String, u64, u64)>,
}

fn group_of(ext: &str) -> &'static str {
    match ext {
        "mp4" | "mkv" | "avi" | "mov" | "wmv" | "webm" | "flv" | "m4v" | "mpg" | "mpeg" | "m2ts" => "Videos",
        "jpg" | "jpeg" | "png" | "gif" | "bmp" | "webp" | "heic" | "tif" | "tiff" | "raw" | "cr2" | "nef" | "psd"
        | "svg" => "Images",
        "mp3" | "wav" | "flac" | "aac" | "ogg" | "m4a" | "wma" | "opus" => "Audio",
        "pdf" | "doc" | "docx" | "xls" | "xlsx" | "ppt" | "pptx" | "txt" | "md" | "odt" | "rtf" | "csv" | "epub" => {
            "Documents"
        }
        "zip" | "7z" | "rar" | "tar" | "gz" | "tgz" | "xz" | "bz2" | "zst" | "cab" => "Archives",
        "exe" | "msi" | "msix" | "appx" | "dll" | "sys" | "so" | "dylib" => "Programs",
        "iso" | "img" | "vhd" | "vhdx" | "vmdk" | "vdi" | "qcow2" | "wim" | "esd" => "Disk images",
        "rs" | "js" | "ts" | "tsx" | "jsx" | "py" | "java" | "c" | "cpp" | "h" | "cs" | "go" | "json" | "html"
        | "css" | "lock" => "Code",
        "log" | "etl" | "tmp" | "dmp" | "cache" | "bak" | "old" => "Temp & logs",
        "db" | "sqlite" | "ldb" | "mdb" | "pak" | "dat" | "bin" => "Data",
        _ => "Other",
    }
}

pub fn type_breakdown(tree: &Tree) -> Vec<TypeGroup> {
    let mut by_ext: HashMap<String, (u64, u64)> = HashMap::new();
    for n in &tree.nodes {
        if n.deleted || n.kind != NodeKind::File {
            continue;
        }
        let ext = n
            .name
            .rsplit_once('.')
            .map(|(_, e)| e.to_ascii_lowercase())
            .unwrap_or_default();
        let ext = if ext.len() > 10 { String::new() } else { ext };
        let e = by_ext.entry(ext).or_default();
        e.0 += n.size;
        e.1 += 1;
    }
    let mut groups: HashMap<&'static str, TypeGroup> = HashMap::new();
    for (ext, (bytes, files)) in by_ext {
        let g = groups.entry(group_of(&ext)).or_insert_with_key(|k| TypeGroup {
            group: k.to_string(),
            bytes: 0,
            files: 0,
            extensions: Vec::new(),
        });
        g.bytes += bytes;
        g.files += files;
        g.extensions
            .push((if ext.is_empty() { "(none)".into() } else { ext }, bytes, files));
    }
    let mut out: Vec<TypeGroup> = groups.into_values().collect();
    for g in &mut out {
        g.extensions.sort_by_key(|a| std::cmp::Reverse(a.1));
        g.extensions.truncate(8);
    }
    out.sort_by_key(|a| std::cmp::Reverse(a.bytes));
    out
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SuggestionGroup {
    pub category: Category,
    pub label: String,
    pub safety: SafetyLevel,
    pub bytes: u64,
    pub count: usize,
    /// Largest items in the group (capped).
    pub items: Vec<NodeView>,
}

/// Cleanup suggestions: the top-most `Safe` entries (whose parent isn't
/// already suggested), grouped by category. With `include_review`, also the
/// top-most `Review` entries that aren't personal files.
pub fn suggestions(tree: &Tree, include_review: bool, per_group: usize) -> Vec<SuggestionGroup> {
    let mut found: HashMap<(Category, SafetyLevel), Vec<NodeId>> = HashMap::new();
    let mut stack = vec![ROOT];
    while let Some(id) = stack.pop() {
        let n = &tree.nodes[id as usize];
        if n.deleted {
            continue;
        }
        let level = n.rule.level();
        let suggest = id != ROOT
            && n.size > 0
            && (level == SafetyLevel::Safe
                || (include_review && level == SafetyLevel::Review && n.rule.category() != Category::UserData));
        if suggest {
            found.entry((n.rule.category(), level)).or_default().push(id);
            continue;
        }
        stack.extend(n.children.iter().copied());
    }
    let mut out: Vec<SuggestionGroup> = found
        .into_iter()
        .map(|((category, safety), mut ids)| {
            ids.sort_by(|&a, &b| tree.nodes[b as usize].size.cmp(&tree.nodes[a as usize].size));
            let bytes = ids.iter().map(|&i| tree.nodes[i as usize].size).sum();
            SuggestionGroup {
                category,
                label: category.label().into(),
                safety,
                bytes,
                count: ids.len(),
                items: ids.iter().take(per_group).filter_map(|&i| tree.view(i)).collect(),
            }
        })
        .collect();
    out.sort_by(|a, b| a.safety.cmp(&b.safety).then(b.bytes.cmp(&a.bytes)));
    out
}

/// Bytes per safety level, counting each file once (by its own rating).
pub fn safety_totals(tree: &Tree) -> HashMap<SafetyLevel, u64> {
    let mut m = HashMap::new();
    for n in &tree.nodes {
        if !n.deleted && n.kind == NodeKind::File {
            *m.entry(n.rule.level()).or_insert(0) += n.size;
        }
    }
    m
}

/// Export entries down to `max_depth` as CSV.
pub fn export_csv(tree: &Tree, out: &Path, max_depth: usize) -> Result<()> {
    let f = std::fs::File::create(out).map_err(|e| Error::io(out, e))?;
    let mut w = std::io::BufWriter::new(f);
    let io = |e| Error::io(out, e);
    writeln!(w, "path,type,size_bytes,files,folders,modified_unix,safety,reason").map_err(io)?;
    let mut stack = vec![(ROOT, 0usize)];
    while let Some((id, depth)) = stack.pop() {
        let Some(v) = tree.view(id) else { continue };
        writeln!(
            w,
            "{},{},{},{},{},{},{},{}",
            csv_field(&v.path),
            v.kind.as_str(),
            v.size,
            v.files,
            v.dirs,
            v.modified,
            v.safety.as_str(),
            csv_field(v.reason)
        )
        .map_err(io)?;
        if depth < max_depth {
            let n = &tree.nodes[id as usize];
            for &c in n.children.iter().rev() {
                stack.push((c, depth + 1));
            }
        }
    }
    w.flush().map_err(io)
}

fn csv_field(s: &str) -> String {
    // Also neutralise spreadsheet formula injection.
    let s = if s.starts_with(['=', '+', '-', '@']) {
        format!("'{s}")
    } else {
        s.to_string()
    };
    if s.contains([',', '"', '\n']) {
        format!("\"{}\"", s.replace('"', "\"\""))
    } else {
        s
    }
}

pub fn summary(tree: &Tree) -> ScanSummary {
    let r = tree.root();
    ScanSummary {
        id: 0,
        root: tree.root_path.to_string_lossy().into_owned(),
        started_at: tree.started_at,
        duration_ms: tree.duration_ms,
        total_bytes: r.size,
        files: r.files,
        dirs: r.dirs,
        errors: r.errors as u64,
        top: r
            .children
            .iter()
            .take(20)
            .map(|&c| {
                let n = &tree.nodes[c as usize];
                (n.name.to_string(), n.size)
            })
            .collect(),
    }
}
