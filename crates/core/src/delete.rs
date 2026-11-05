//! Safe deletion.
//!
//! Two steps, both enforced here (never in the UI):
//! 1. [`plan`] validates every requested path and explains what will happen:
//!    blocked items, warnings, total space to be freed.
//! 2. [`execute`] re-validates each item immediately before deleting it,
//!    sends it to the Recycle Bin (default) or deletes it permanently (only
//!    with the exact confirmation phrase), and records everything in history.

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::{Error, Result};
use crate::history::{CleanupItemRecord, CleanupRunRecord, History, ItemStatus};
use crate::model::NodeKind;
use crate::safety::{Classifier, Rule, SafetyLevel};
use crate::util::{format_bytes, now_unix};

/// The user must type this exact phrase to delete permanently.
pub const PERMANENT_CONFIRM_PHRASE: &str = "DELETE PERMANENTLY";

/// Items bigger than this get an extra warning.
const HUGE_ITEM: u64 = 10 * 1024 * 1024 * 1024;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DeleteMode {
    /// Move to the Recycle Bin. Restorable.
    Trash,
    /// Gone for good.
    Permanent,
}

impl DeleteMode {
    pub fn as_str(self) -> &'static str {
        match self {
            DeleteMode::Trash => "trash",
            DeleteMode::Permanent => "permanent",
        }
    }
}

/// What the caller wants deleted. `size` is informational (from the scan).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteRequestItem {
    pub path: PathBuf,
    pub size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanItem {
    pub path: PathBuf,
    pub kind: NodeKind,
    pub size: u64,
    pub safety: SafetyLevel,
    pub rule: String,
    pub reason: String,
    pub allowed: bool,
    pub blocked_reason: Option<String>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeletePlan {
    pub mode: DeleteMode,
    pub items: Vec<PlanItem>,
    pub total_bytes: u64,
    pub allowed_bytes: u64,
    pub allowed_count: usize,
    pub blocked_count: usize,
    /// Paths dropped because a parent folder was also selected.
    pub merged_count: usize,
    pub warnings: Vec<String>,
    /// Phrase the user must type when `mode` is permanent.
    pub confirm_phrase: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemOutcome {
    pub path: PathBuf,
    pub size: u64,
    pub status: ItemStatus,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteReport {
    pub run_id: i64,
    pub mode: DeleteMode,
    pub freed_bytes: u64,
    pub deleted_count: usize,
    pub failed_count: usize,
    pub skipped_count: usize,
    pub items: Vec<ItemOutcome>,
}

/// Check a single path. Returns (kind, rule, blocked reason, warnings).
fn validate(
    path: &Path,
    size: u64,
    mode: DeleteMode,
    classifier: &Classifier,
) -> (NodeKind, Rule, Option<String>, Vec<String>) {
    let mut warnings = Vec::new();
    let meta = match fs::symlink_metadata(path) {
        Ok(m) => m,
        Err(e) => {
            return (
                NodeKind::File,
                Rule::Unknown,
                Some(format!("Cannot access: {e}")),
                warnings,
            );
        }
    };
    let kind = if meta.file_type().is_symlink() {
        NodeKind::Link
    } else if meta.is_dir() {
        NodeKind::Dir
    } else {
        NodeKind::File
    };

    if !path.is_absolute() {
        return (kind, Rule::Unknown, Some("Path must be absolute.".into()), warnings);
    }
    if path.parent().is_none() {
        return (kind, Rule::DriveRoot, Some(Rule::DriveRoot.reason().into()), warnings);
    }

    let rule = classifier.classify_path(path);
    if rule.level() == SafetyLevel::Protected {
        return (kind, rule, Some(rule.reason().into()), warnings);
    }
    if let Some(critical) = classifier.contains_critical(path) {
        return (
            kind,
            rule,
            Some(format!("Contains a protected location: {critical}")),
            warnings,
        );
    }

    match rule.level() {
        SafetyLevel::Review => warnings.push(format!("Needs review: {}", rule.reason())),
        SafetyLevel::Unknown => {
            warnings.push("Not recognised by any safety rule. Make sure you know what this is.".into())
        }
        _ => {}
    }
    if kind == NodeKind::Link {
        warnings.push("This is a link/junction. Only the link is removed, not its target.".into());
    }
    if size >= HUGE_ITEM {
        warnings.push(format!("Very large item ({}).", format_bytes(size)));
    }
    if mode == DeleteMode::Permanent {
        warnings.push("Permanent delete: this cannot be undone or restored from the Recycle Bin.".into());
    }
    (kind, rule, None, warnings)
}

/// Remove duplicates and items whose ancestor is also selected.
fn dedupe(mut items: Vec<DeleteRequestItem>, classifier: &Classifier) -> (Vec<DeleteRequestItem>, usize) {
    let before = items.len();
    let sep = classifier.sep();
    let mut keyed: Vec<(String, DeleteRequestItem)> = items
        .drain(..)
        .map(|i| (classifier.normalize(&i.path.to_string_lossy()), i))
        .collect();
    keyed.sort_by(|a, b| a.0.cmp(&b.0));
    keyed.dedup_by(|a, b| a.0 == b.0);
    let mut kept: Vec<(String, DeleteRequestItem)> = Vec::new();
    for (key, item) in keyed {
        let covered = kept.iter().any(|(k, _)| {
            key.len() > k.len() && key.starts_with(k.as_str()) && (k.ends_with(sep) || key[k.len()..].starts_with(sep))
        });
        if !covered {
            kept.push((key, item));
        }
    }
    let after = kept.len();
    (kept.into_iter().map(|(_, i)| i).collect(), before - after)
}

/// Validate a deletion request without touching anything.
pub fn plan(items: Vec<DeleteRequestItem>, mode: DeleteMode, classifier: &Classifier) -> DeletePlan {
    let (items, merged_count) = dedupe(items, classifier);
    let mut out = Vec::with_capacity(items.len());
    let (mut total, mut allowed_bytes, mut allowed_count, mut blocked_count) = (0, 0, 0, 0);
    for it in items {
        let (kind, rule, blocked, warnings) = validate(&it.path, it.size, mode, classifier);
        total += it.size;
        if blocked.is_none() {
            allowed_bytes += it.size;
            allowed_count += 1;
        } else {
            blocked_count += 1;
        }
        out.push(PlanItem {
            path: it.path,
            kind,
            size: it.size,
            safety: rule.level(),
            rule: rule.id().into(),
            reason: rule.reason().into(),
            allowed: blocked.is_none(),
            blocked_reason: blocked,
            warnings,
        });
    }
    let mut warnings = Vec::new();
    if mode == DeleteMode::Permanent {
        warnings.push("PERMANENT DELETE IS ON. Files will NOT go to the Recycle Bin and cannot be recovered.".into());
    }
    let risky = out
        .iter()
        .filter(|i| i.allowed && i.safety != SafetyLevel::Safe)
        .count();
    if risky > 0 {
        warnings.push(format!(
            "{risky} item(s) are not rated Safe. Review them before continuing."
        ));
    }
    if blocked_count > 0 {
        warnings.push(format!("{blocked_count} protected item(s) will be skipped."));
    }
    DeletePlan {
        mode,
        items: out,
        total_bytes: total,
        allowed_bytes,
        allowed_count,
        blocked_count,
        merged_count,
        warnings,
        confirm_phrase: (mode == DeleteMode::Permanent).then(|| PERMANENT_CONFIRM_PHRASE.to_string()),
    }
}

/// Delete the allowed items of a plan. Each item is re-validated first.
pub fn execute(
    items: Vec<DeleteRequestItem>,
    mode: DeleteMode,
    confirm_phrase: Option<&str>,
    classifier: &Classifier,
    history: &History,
    source: &str,
) -> Result<DeleteReport> {
    if mode == DeleteMode::Permanent && confirm_phrase != Some(PERMANENT_CONFIRM_PHRASE) {
        return Err(Error::Blocked(format!(
            "permanent deletion requires typing the confirmation phrase \"{PERMANENT_CONFIRM_PHRASE}\""
        )));
    }
    let started_at = now_unix();
    let (items, _) = dedupe(items, classifier);
    let mut outcomes = Vec::with_capacity(items.len());
    let mut records = Vec::with_capacity(items.len());

    for it in items {
        let (kind, rule, blocked, _) = validate(&it.path, it.size, mode, classifier);
        let mut size = it.size;
        // Safe folders may be partly cleaned (see below); measure them first so
        // the space actually freed can be reported.
        let partial_ok = blocked.is_none() && kind == NodeKind::Dir && rule.level() == SafetyLevel::Safe;
        let before = if partial_ok { dir_size(&it.path) } else { 0 };
        let (status, error) = if let Some(reason) = blocked {
            (ItemStatus::Skipped, Some(reason))
        } else {
            match delete_one(&it.path, kind, mode) {
                Ok(()) => (
                    if mode == DeleteMode::Trash {
                        ItemStatus::Trashed
                    } else {
                        ItemStatus::Deleted
                    },
                    None,
                ),
                // On Windows one locked file makes the whole folder fail. For
                // folders rated Safe (caches, temp), clean everything that
                // isn't in use instead of giving up.
                Err(e) if partial_ok => {
                    // remove_dir_all may already have removed part of it.
                    let (_, locked) = delete_contents(&it.path, mode, 0);
                    let freed = before.saturating_sub(dir_size(&it.path));
                    if freed > 0 {
                        size = freed;
                        (
                            ItemStatus::Partial,
                            Some(format!(
                                "Partly cleaned: {locked} item(s) are in use by other programs and were left."
                            )),
                        )
                    } else {
                        (ItemStatus::Failed, Some(friendly_error(&e)))
                    }
                }
                Err(e) => (ItemStatus::Failed, Some(friendly_error(&e))),
            }
        };
        records.push(CleanupItemRecord {
            id: 0,
            path: it.path.to_string_lossy().into_owned(),
            kind: kind.as_str().into(),
            size,
            rule: rule.id().into(),
            safety: rule.level(),
            status,
            error: error.clone(),
            restored_at: None,
        });
        outcomes.push(ItemOutcome {
            path: it.path,
            size,
            status,
            error,
        });
    }

    let done = |s: ItemStatus| matches!(s, ItemStatus::Trashed | ItemStatus::Deleted | ItemStatus::Partial);
    let freed_bytes = outcomes.iter().filter(|o| done(o.status)).map(|o| o.size).sum();
    let deleted_count = outcomes.iter().filter(|o| done(o.status)).count();
    let failed_count = outcomes.iter().filter(|o| o.status == ItemStatus::Failed).count();
    let skipped_count = outcomes.iter().filter(|o| o.status == ItemStatus::Skipped).count();

    let run_id = history.record_cleanup(
        &CleanupRunRecord {
            id: 0,
            started_at,
            finished_at: now_unix(),
            mode,
            source: source.into(),
            freed_bytes,
            deleted_count: deleted_count as i64,
            failed_count: failed_count as i64,
            skipped_count: skipped_count as i64,
        },
        &records,
    )?;

    Ok(DeleteReport {
        run_id,
        mode,
        freed_bytes,
        deleted_count,
        failed_count,
        skipped_count,
        items: outcomes,
    })
}

fn delete_one(path: &Path, kind: NodeKind, mode: DeleteMode) -> std::result::Result<(), String> {
    match mode {
        DeleteMode::Trash => trash::delete(path).map_err(|e| e.to_string()),
        DeleteMode::Permanent => {
            let res = match kind {
                // Removing a link never touches its target.
                NodeKind::Link => fs::remove_file(path).or_else(|_| fs::remove_dir(path)),
                NodeKind::File => remove_file_force(path),
                // std's remove_dir_all does not follow symlinks/junctions.
                NodeKind::Dir => fs::remove_dir_all(path),
            };
            res.map_err(|e| e.to_string())
        }
    }
}

/// Delete every entry inside `dir` that can be deleted, recursing into
/// sub-folders that fail (because something inside them is locked).
/// Returns (bytes freed, entries left because they are in use).
fn delete_contents(dir: &Path, mode: DeleteMode, depth: u32) -> (u64, usize) {
    let Ok(rd) = fs::read_dir(dir) else { return (0, 1) };
    let (mut freed, mut locked) = (0u64, 0usize);
    for entry in rd.flatten() {
        let path = entry.path();
        let Ok(meta) = fs::symlink_metadata(&path) else {
            continue;
        };
        let kind = if meta.file_type().is_symlink() {
            NodeKind::Link
        } else if meta.is_dir() {
            NodeKind::Dir
        } else {
            NodeKind::File
        };
        let size = match kind {
            NodeKind::File => meta.len(),
            NodeKind::Dir => dir_size(&path),
            NodeKind::Link => 0,
        };
        match delete_one(&path, kind, mode) {
            Ok(()) => freed += size,
            Err(_) if kind == NodeKind::Dir && depth < 6 => {
                let (f, l) = delete_contents(&path, mode, depth + 1);
                freed += f;
                locked += l;
            }
            Err(_) => locked += 1,
        }
    }
    (freed, locked)
}

/// Total size of a folder, never following links.
pub fn dir_size(dir: &Path) -> u64 {
    let mut total = 0;
    let mut stack = vec![dir.to_path_buf()];
    while let Some(d) = stack.pop() {
        let Ok(rd) = fs::read_dir(&d) else { continue };
        for e in rd.flatten() {
            let Ok(m) = e.metadata() else { continue };
            if m.file_type().is_symlink() {
                continue;
            }
            if m.is_dir() {
                stack.push(e.path());
            } else {
                total += m.len();
            }
        }
    }
    total
}

/// Turn raw OS / shell errors into something a person can act on.
fn friendly_error(raw: &str) -> String {
    let l = raw.to_lowercase();
    if l.contains("in use")
        || l.contains("being used by another process")
        || l.contains("os error 32")
        || l.contains("0x80270028")
        || l.contains("0x80070020")
        || l.contains("-2147024864")
        || l.contains("-2144927704")
    {
        "In use by another program. Close that program (or restart) and try again.".into()
    } else if l.contains("access is denied")
        || l.contains("os error 5")
        || l.contains("0x80070005")
        || l.contains("-2147024891")
    {
        "Access denied. This item may need administrator rights.".into()
    } else if l.contains("cannot find") || l.contains("os error 2") || l.contains("os error 3") {
        "Already gone: it was deleted or moved by something else.".into()
    } else {
        raw.to_string()
    }
}

/// Delete a file, clearing the read-only attribute if that's what blocks it.
fn remove_file_force(path: &Path) -> std::io::Result<()> {
    match fs::remove_file(path) {
        Err(e) if e.kind() == std::io::ErrorKind::PermissionDenied => {
            let mut perms = fs::metadata(path)?.permissions();
            if perms.readonly() {
                #[allow(clippy::permissions_set_readonly_false)]
                perms.set_readonly(false);
                fs::set_permissions(path, perms)?;
                fs::remove_file(path)
            } else {
                Err(e)
            }
        }
        other => other,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::safety::SystemPaths;

    fn setup() -> (tempfile::TempDir, Classifier, History) {
        let dir = tempfile::tempdir().unwrap();
        let sp = SystemPaths {
            // Pretend this folder is a protected system folder.
            program_files: vec![dir.path().join("Program Files").to_string_lossy().into_owned()],
            unix: cfg!(unix),
            ..Default::default()
        };
        let history = History::open_in_memory().unwrap();
        (dir, Classifier::new(&sp), history)
    }

    fn req(p: PathBuf, size: u64) -> DeleteRequestItem {
        DeleteRequestItem { path: p, size }
    }

    #[test]
    fn permanent_requires_phrase() {
        let (dir, c, h) = setup();
        let f = dir.path().join("a.tmp");
        fs::write(&f, b"x").unwrap();
        let err = execute(
            vec![req(f.clone(), 1)],
            DeleteMode::Permanent,
            Some("yes"),
            &c,
            &h,
            "test",
        );
        assert!(matches!(err, Err(Error::Blocked(_))));
        assert!(f.exists());
        let ok = execute(
            vec![req(f.clone(), 1)],
            DeleteMode::Permanent,
            Some(PERMANENT_CONFIRM_PHRASE),
            &c,
            &h,
            "test",
        )
        .unwrap();
        assert_eq!(ok.deleted_count, 1);
        assert!(!f.exists());
        assert_eq!(h.cleanup_runs(10).unwrap().len(), 1);
    }

    #[test]
    fn protected_paths_are_blocked_and_kept() {
        let (dir, c, h) = setup();
        let pf = dir.path().join("Program Files").join("App");
        fs::create_dir_all(&pf).unwrap();
        fs::write(pf.join("app.exe"), b"x").unwrap();
        let p = plan(vec![req(pf.clone(), 1)], DeleteMode::Permanent, &c);
        assert_eq!(p.blocked_count, 1);
        assert!(!p.items[0].allowed);
        let r = execute(
            vec![req(pf.clone(), 1)],
            DeleteMode::Permanent,
            Some(PERMANENT_CONFIRM_PHRASE),
            &c,
            &h,
            "test",
        )
        .unwrap();
        assert_eq!(r.skipped_count, 1);
        assert!(pf.join("app.exe").exists());
    }

    #[test]
    fn nested_selections_are_merged() {
        let (dir, c, _) = setup();
        let a = dir.path().join("a");
        fs::create_dir_all(a.join("b")).unwrap();
        let p = plan(vec![req(a.join("b"), 1), req(a.clone(), 2)], DeleteMode::Trash, &c);
        assert_eq!(p.items.len(), 1);
        assert_eq!(p.merged_count, 1);
        assert_eq!(p.items[0].path, a);
    }

    /// A cache folder with one locked file is cleaned except for that file.
    #[cfg(windows)]
    #[test]
    fn locked_file_leaves_partial_cleanup() {
        use std::os::windows::fs::OpenOptionsExt;
        let dir = tempfile::tempdir().unwrap();
        let sp = SystemPaths {
            temp: vec![dir.path().to_string_lossy().into_owned()],
            ..Default::default()
        };
        let c = Classifier::new(&sp);
        let h = History::open_in_memory().unwrap();
        let cache = dir.path().join("cache");
        fs::create_dir_all(cache.join("sub")).unwrap();
        fs::write(cache.join("free.bin"), vec![0u8; 1000]).unwrap();
        fs::write(cache.join("sub").join("free2.bin"), vec![0u8; 500]).unwrap();
        fs::write(cache.join("sub").join("locked.bin"), vec![0u8; 10]).unwrap();
        // share_mode(0): nobody else may read, write or delete it.
        let _lock = fs::OpenOptions::new()
            .read(true)
            .share_mode(0)
            .open(cache.join("sub").join("locked.bin"))
            .unwrap();

        let r = execute(
            vec![req(cache.clone(), 1510)],
            DeleteMode::Permanent,
            Some(PERMANENT_CONFIRM_PHRASE),
            &c,
            &h,
            "test",
        )
        .unwrap();
        assert_eq!(r.items[0].status, ItemStatus::Partial, "{:?}", r.items[0]);
        assert_eq!(r.freed_bytes, 1500);
        assert!(!cache.join("free.bin").exists());
        assert!(!cache.join("sub").join("free2.bin").exists());
        assert!(cache.join("sub").join("locked.bin").exists());
    }

    #[test]
    fn os_errors_are_made_readable() {
        assert!(
            friendly_error(
                "The process cannot access the file because it is being used by another process. (os error 32)"
            )
            .starts_with("In use")
        );
        assert!(friendly_error("Access is denied. (os error 5)").starts_with("Access denied"));
    }

    #[test]
    fn deleting_a_dir_with_a_link_keeps_link_target() {
        let (dir, c, h) = setup();
        let outside = dir.path().join("outside");
        fs::create_dir_all(&outside).unwrap();
        fs::write(outside.join("keep.txt"), b"keep").unwrap();
        let victim = dir.path().join("victim");
        fs::create_dir_all(&victim).unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink(&outside, victim.join("link")).unwrap();
        #[cfg(windows)]
        if std::os::windows::fs::symlink_dir(&outside, victim.join("link")).is_err() {
            // Creating symlinks needs Developer Mode on Windows; skip then.
            return;
        }
        execute(
            vec![req(victim.clone(), 0)],
            DeleteMode::Permanent,
            Some(PERMANENT_CONFIRM_PHRASE),
            &c,
            &h,
            "test",
        )
        .unwrap();
        assert!(!victim.exists());
        assert!(outside.join("keep.txt").exists());
    }
}
