//! Persistent history in SQLite: cleanup runs (with every item), free-space
//! snapshots for the analytics graph, and scan summaries.

use std::path::{Path, PathBuf};

use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};

use crate::delete::DeleteMode;
use crate::error::{Error, Result};
use crate::safety::SafetyLevel;
use crate::util::now_unix;

const SCHEMA_VERSION: i32 = 1;

/// `%APPDATA%\storageCleaner` on Windows, `~/.local/share/storageCleaner` on Linux.
/// Overridable with the `STORAGE_CLEANER_DATA_DIR` env var (used in Docker).
pub fn default_data_dir() -> Option<PathBuf> {
    if let Ok(d) = std::env::var("STORAGE_CLEANER_DATA_DIR")
        && !d.is_empty()
    {
        return Some(PathBuf::from(d));
    }
    dirs::data_dir().map(|d| d.join("storageCleaner"))
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ItemStatus {
    Trashed,
    Deleted,
    Failed,
    Skipped,
    Restored,
    /// Folder only partly cleaned: some files inside were in use.
    Partial,
    /// Emptied from the Recycle Bin: space freed, no longer restorable.
    Purged,
}

impl ItemStatus {
    fn as_str(self) -> &'static str {
        match self {
            ItemStatus::Trashed => "trashed",
            ItemStatus::Deleted => "deleted",
            ItemStatus::Failed => "failed",
            ItemStatus::Skipped => "skipped",
            ItemStatus::Restored => "restored",
            ItemStatus::Partial => "partial",
            ItemStatus::Purged => "purged",
        }
    }
    fn parse(s: &str) -> Self {
        match s {
            "trashed" => ItemStatus::Trashed,
            "deleted" => ItemStatus::Deleted,
            "skipped" => ItemStatus::Skipped,
            "restored" => ItemStatus::Restored,
            "partial" => ItemStatus::Partial,
            "purged" => ItemStatus::Purged,
            _ => ItemStatus::Failed,
        }
    }
}

fn parse_level(s: &str) -> SafetyLevel {
    match s {
        "safe" => SafetyLevel::Safe,
        "review" => SafetyLevel::Review,
        "protected" => SafetyLevel::Protected,
        _ => SafetyLevel::Unknown,
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanupRunRecord {
    pub id: i64,
    pub started_at: i64,
    pub finished_at: i64,
    pub mode: DeleteMode,
    pub source: String,
    pub freed_bytes: u64,
    pub deleted_count: i64,
    pub failed_count: i64,
    pub skipped_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanupItemRecord {
    pub id: i64,
    pub path: String,
    pub kind: String,
    pub size: u64,
    pub rule: String,
    pub safety: SafetyLevel,
    pub status: ItemStatus,
    pub error: Option<String>,
    pub restored_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpaceSnapshot {
    pub taken_at: i64,
    pub mount: String,
    pub label: String,
    pub total_bytes: u64,
    pub free_bytes: u64,
    pub trigger: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanSummary {
    pub id: i64,
    pub root: String,
    pub started_at: i64,
    pub duration_ms: u64,
    pub total_bytes: u64,
    pub files: u64,
    pub dirs: u64,
    pub errors: u64,
    /// Largest top-level entries: (name, bytes).
    pub top: Vec<(String, u64)>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryTotals {
    pub runs: i64,
    pub freed_bytes: u64,
    pub items_deleted: i64,
    pub last_cleanup_at: Option<i64>,
}

pub struct History {
    conn: Connection,
}

impl History {
    /// Open (or create) the database in the default data dir.
    pub fn open_default() -> Result<Self> {
        let dir = default_data_dir().ok_or_else(|| Error::Invalid("cannot determine data directory".into()))?;
        std::fs::create_dir_all(&dir).map_err(|e| Error::io(&dir, e))?;
        Self::open(&dir.join("history.db"))
    }

    pub fn open(path: &Path) -> Result<Self> {
        let conn = Connection::open(path)?;
        Self::init(conn)
    }

    pub fn open_in_memory() -> Result<Self> {
        Self::init(Connection::open_in_memory()?)
    }

    fn init(conn: Connection) -> Result<Self> {
        // journal_mode returns a row, so run it as a batch.
        conn.execute_batch("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;")?;
        let version: i32 = conn.pragma_query_value(None, "user_version", |r| r.get(0))?;
        if version < 1 {
            conn.execute_batch(
                r#"
                CREATE TABLE IF NOT EXISTS cleanup_runs (
                    id            INTEGER PRIMARY KEY,
                    started_at    INTEGER NOT NULL,
                    finished_at   INTEGER NOT NULL,
                    mode          TEXT NOT NULL,
                    source        TEXT NOT NULL,
                    freed_bytes   INTEGER NOT NULL,
                    deleted_count INTEGER NOT NULL,
                    failed_count  INTEGER NOT NULL,
                    skipped_count INTEGER NOT NULL
                );
                CREATE TABLE IF NOT EXISTS cleanup_items (
                    id          INTEGER PRIMARY KEY,
                    run_id      INTEGER NOT NULL REFERENCES cleanup_runs(id) ON DELETE CASCADE,
                    path        TEXT NOT NULL,
                    kind        TEXT NOT NULL,
                    size        INTEGER NOT NULL,
                    rule        TEXT NOT NULL,
                    safety      TEXT NOT NULL,
                    status      TEXT NOT NULL,
                    error       TEXT,
                    restored_at INTEGER
                );
                CREATE INDEX IF NOT EXISTS idx_items_run ON cleanup_items(run_id);
                CREATE TABLE IF NOT EXISTS space_snapshots (
                    id          INTEGER PRIMARY KEY,
                    taken_at    INTEGER NOT NULL,
                    mount       TEXT NOT NULL,
                    label       TEXT NOT NULL,
                    total_bytes INTEGER NOT NULL,
                    free_bytes  INTEGER NOT NULL,
                    trigger     TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_snapshots ON space_snapshots(mount, taken_at);
                CREATE TABLE IF NOT EXISTS scan_runs (
                    id          INTEGER PRIMARY KEY,
                    root        TEXT NOT NULL,
                    started_at  INTEGER NOT NULL,
                    duration_ms INTEGER NOT NULL,
                    total_bytes INTEGER NOT NULL,
                    files       INTEGER NOT NULL,
                    dirs        INTEGER NOT NULL,
                    errors      INTEGER NOT NULL,
                    top_json    TEXT NOT NULL
                );
                "#,
            )?;
            conn.pragma_update(None, "user_version", SCHEMA_VERSION)?;
        }
        Ok(History { conn })
    }

    // ── Cleanups ─────────────────────────────────────────────────────────

    pub fn record_cleanup(&self, run: &CleanupRunRecord, items: &[CleanupItemRecord]) -> Result<i64> {
        let tx = self.conn.unchecked_transaction()?;
        tx.execute(
            "INSERT INTO cleanup_runs (started_at, finished_at, mode, source, freed_bytes, deleted_count, failed_count, skipped_count)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                run.started_at,
                run.finished_at,
                run.mode.as_str(),
                run.source,
                run.freed_bytes as i64,
                run.deleted_count,
                run.failed_count,
                run.skipped_count
            ],
        )?;
        let run_id = tx.last_insert_rowid();
        {
            let mut stmt = tx.prepare(
                "INSERT INTO cleanup_items (run_id, path, kind, size, rule, safety, status, error)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            )?;
            for it in items {
                stmt.execute(params![
                    run_id,
                    it.path,
                    it.kind,
                    it.size as i64,
                    it.rule,
                    it.safety.as_str(),
                    it.status.as_str(),
                    it.error
                ])?;
            }
        }
        tx.commit()?;
        Ok(run_id)
    }

    pub fn cleanup_runs(&self, limit: usize) -> Result<Vec<CleanupRunRecord>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, started_at, finished_at, mode, source, freed_bytes, deleted_count, failed_count, skipped_count
             FROM cleanup_runs ORDER BY started_at DESC, id DESC LIMIT ?1",
        )?;
        let rows = stmt.query_map([limit as i64], |r| {
            let mode: String = r.get(3)?;
            Ok(CleanupRunRecord {
                id: r.get(0)?,
                started_at: r.get(1)?,
                finished_at: r.get(2)?,
                mode: if mode == "permanent" {
                    DeleteMode::Permanent
                } else {
                    DeleteMode::Trash
                },
                source: r.get(4)?,
                freed_bytes: r.get::<_, i64>(5)? as u64,
                deleted_count: r.get(6)?,
                failed_count: r.get(7)?,
                skipped_count: r.get(8)?,
            })
        })?;
        Ok(rows.collect::<std::result::Result<_, _>>()?)
    }

    pub fn cleanup_items(&self, run_id: i64) -> Result<Vec<CleanupItemRecord>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, path, kind, size, rule, safety, status, error, restored_at
             FROM cleanup_items WHERE run_id = ?1 ORDER BY size DESC",
        )?;
        let rows = stmt.query_map([run_id], |r| {
            Ok(CleanupItemRecord {
                id: r.get(0)?,
                path: r.get(1)?,
                kind: r.get(2)?,
                size: r.get::<_, i64>(3)? as u64,
                rule: r.get(4)?,
                safety: parse_level(&r.get::<_, String>(5)?),
                status: ItemStatus::parse(&r.get::<_, String>(6)?),
                error: r.get(7)?,
                restored_at: r.get(8)?,
            })
        })?;
        Ok(rows.collect::<std::result::Result<_, _>>()?)
    }

    pub fn set_status(&self, item_ids: &[i64], status: ItemStatus) -> Result<()> {
        let now = now_unix();
        let mut stmt = self
            .conn
            .prepare("UPDATE cleanup_items SET status = ?1, restored_at = ?2 WHERE id = ?3")?;
        for id in item_ids {
            stmt.execute(params![status.as_str(), now, id])?;
        }
        Ok(())
    }

    /// After the Recycle Bin was emptied, items we had moved there (on one
    /// drive, or all) can no longer be restored.
    pub fn mark_trashed_as_purged(&self, drive: Option<&str>) -> Result<usize> {
        let pattern = drive.map(|d| format!("{}%", d.to_lowercase()));
        Ok(self.conn.execute(
            "UPDATE cleanup_items SET status = 'purged'
             WHERE status IN ('trashed', 'partial') AND (?1 IS NULL OR lower(path) LIKE ?1)",
            [pattern],
        )?)
    }

    pub fn totals(&self) -> Result<HistoryTotals> {
        Ok(self.conn.query_row(
            "SELECT COUNT(*), COALESCE(SUM(freed_bytes), 0), COALESCE(SUM(deleted_count), 0), MAX(finished_at) FROM cleanup_runs",
            [],
            |r| {
                Ok(HistoryTotals {
                    runs: r.get(0)?,
                    freed_bytes: r.get::<_, i64>(1)? as u64,
                    items_deleted: r.get(2)?,
                    last_cleanup_at: r.get(3)?,
                })
            },
        )?)
    }

    pub fn clear_cleanup_history(&self) -> Result<()> {
        self.conn
            .execute_batch("DELETE FROM cleanup_items; DELETE FROM cleanup_runs;")?;
        Ok(())
    }

    // ── Free-space snapshots ─────────────────────────────────────────────

    pub fn record_snapshot(&self, s: &SpaceSnapshot) -> Result<()> {
        self.conn.execute(
            "INSERT INTO space_snapshots (taken_at, mount, label, total_bytes, free_bytes, trigger) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![s.taken_at, s.mount, s.label, s.total_bytes as i64, s.free_bytes as i64, s.trigger],
        )?;
        Ok(())
    }

    /// Latest snapshot time for a mount, to avoid recording too often.
    pub fn last_snapshot_at(&self, mount: &str) -> Result<Option<i64>> {
        Ok(self
            .conn
            .query_row(
                "SELECT MAX(taken_at) FROM space_snapshots WHERE mount = ?1",
                [mount],
                |r| r.get(0),
            )
            .optional()?
            .flatten())
    }

    pub fn snapshots_since(&self, since: i64) -> Result<Vec<SpaceSnapshot>> {
        let mut stmt = self.conn.prepare(
            "SELECT taken_at, mount, label, total_bytes, free_bytes, trigger FROM space_snapshots
             WHERE taken_at >= ?1 ORDER BY taken_at ASC",
        )?;
        let rows = stmt.query_map([since], |r| {
            Ok(SpaceSnapshot {
                taken_at: r.get(0)?,
                mount: r.get(1)?,
                label: r.get(2)?,
                total_bytes: r.get::<_, i64>(3)? as u64,
                free_bytes: r.get::<_, i64>(4)? as u64,
                trigger: r.get(5)?,
            })
        })?;
        Ok(rows.collect::<std::result::Result<_, _>>()?)
    }

    // ── Scan summaries ───────────────────────────────────────────────────

    pub fn record_scan(&self, s: &ScanSummary) -> Result<i64> {
        self.conn.execute(
            "INSERT INTO scan_runs (root, started_at, duration_ms, total_bytes, files, dirs, errors, top_json)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                s.root,
                s.started_at,
                s.duration_ms as i64,
                s.total_bytes as i64,
                s.files as i64,
                s.dirs as i64,
                s.errors as i64,
                serde_json::to_string(&s.top).unwrap_or_else(|_| "[]".into())
            ],
        )?;
        Ok(self.conn.last_insert_rowid())
    }

    pub fn scans(&self, limit: usize) -> Result<Vec<ScanSummary>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, root, started_at, duration_ms, total_bytes, files, dirs, errors, top_json
             FROM scan_runs ORDER BY started_at DESC LIMIT ?1",
        )?;
        let rows = stmt.query_map([limit as i64], |r| {
            let top: String = r.get(8)?;
            Ok(ScanSummary {
                id: r.get(0)?,
                root: r.get(1)?,
                started_at: r.get(2)?,
                duration_ms: r.get::<_, i64>(3)? as u64,
                total_bytes: r.get::<_, i64>(4)? as u64,
                files: r.get::<_, i64>(5)? as u64,
                dirs: r.get::<_, i64>(6)? as u64,
                errors: r.get::<_, i64>(7)? as u64,
                top: serde_json::from_str(&top).unwrap_or_default(),
            })
        })?;
        Ok(rows.collect::<std::result::Result<_, _>>()?)
    }
}

/// Recycle Bin entries that belong to a cleanup run, with the history item
/// ids they came from. Fully trashed items match their exact path; partly
/// cleaned folders match everything trashed from inside them during the run.
#[cfg(any(
    windows,
    all(unix, not(target_os = "macos"), not(target_os = "ios"), not(target_os = "android"))
))]
fn run_trash_entries(history: &History, run_id: i64) -> Result<(Vec<trash::TrashItem>, Vec<i64>, usize)> {
    let started_at: i64 = history
        .conn
        .query_row("SELECT started_at FROM cleanup_runs WHERE id = ?1", [run_id], |r| {
            r.get(0)
        })
        .optional()?
        .ok_or_else(|| Error::Invalid(format!("cleanup run #{run_id} not found")))?;
    let items: Vec<CleanupItemRecord> = history
        .cleanup_items(run_id)?
        .into_iter()
        .filter(|i| matches!(i.status, ItemStatus::Trashed | ItemStatus::Partial))
        .collect();
    if items.is_empty() {
        return Ok((Vec::new(), Vec::new(), 0));
    }
    let sep = std::path::MAIN_SEPARATOR;
    let in_trash = trash::os_limited::list()?;
    let mut entries = Vec::new();
    let mut ids = Vec::new();
    for it in &items {
        let target = crate::util::normalize(&it.path);
        let original = |t: &trash::TrashItem| crate::util::normalize(&t.original_path().to_string_lossy());
        let found: Vec<trash::TrashItem> = if it.status == ItemStatus::Trashed {
            // Newest trash entry for that exact path.
            in_trash
                .iter()
                .filter(|t| original(t) == target)
                .max_by_key(|t| t.time_deleted)
                .cloned()
                .into_iter()
                .collect()
        } else {
            let prefix = format!("{target}{sep}");
            in_trash
                .iter()
                .filter(|t| t.time_deleted >= started_at - 5 && original(t).starts_with(&prefix))
                .cloned()
                .collect()
        };
        if !found.is_empty() {
            entries.extend(found);
            ids.push(it.id);
        }
    }
    let missing = items.len() - ids.len();
    Ok((entries, ids, missing))
}

/// Restore items of a cleanup run from the Recycle Bin.
/// Returns (items restored, items not found in the bin).
#[cfg(any(
    windows,
    all(unix, not(target_os = "macos"), not(target_os = "ios"), not(target_os = "android"))
))]
pub fn restore_run(history: &History, run_id: i64) -> Result<(usize, usize)> {
    let (entries, ids, missing) = run_trash_entries(history, run_id)?;
    if !entries.is_empty() {
        trash::os_limited::restore_all(entries).map_err(|e| Error::Trash(e.to_string()))?;
        history.set_status(&ids, ItemStatus::Restored)?;
    }
    Ok((ids.len(), missing))
}

/// Permanently remove a run's items from the Recycle Bin, which is what
/// actually frees the space on that drive. Returns (items purged, bytes).
#[cfg(any(
    windows,
    all(unix, not(target_os = "macos"), not(target_os = "ios"), not(target_os = "android"))
))]
pub fn purge_run(history: &History, run_id: i64) -> Result<(usize, u64)> {
    let (entries, ids, _) = run_trash_entries(history, run_id)?;
    let bytes = history
        .cleanup_items(run_id)?
        .iter()
        .filter(|i| ids.contains(&i.id))
        .map(|i| i.size)
        .sum();
    if !entries.is_empty() {
        trash::os_limited::purge_all(entries).map_err(|e| Error::Trash(e.to_string()))?;
        history.set_status(&ids, ItemStatus::Purged)?;
    }
    Ok((ids.len(), bytes))
}

#[cfg(not(any(
    windows,
    all(unix, not(target_os = "macos"), not(target_os = "ios"), not(target_os = "android"))
)))]
pub fn restore_run(_history: &History, _run_id: i64) -> Result<(usize, usize)> {
    Err(Error::Invalid(
        "restoring from the trash is not supported on this platform".into(),
    ))
}

#[cfg(not(any(
    windows,
    all(unix, not(target_os = "macos"), not(target_os = "ios"), not(target_os = "android"))
)))]
pub fn purge_run(_history: &History, _run_id: i64) -> Result<(usize, u64)> {
    Err(Error::Invalid(
        "emptying the trash is not supported on this platform".into(),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn records_and_reads_back() {
        let h = History::open_in_memory().unwrap();
        let run = CleanupRunRecord {
            id: 0,
            started_at: 100,
            finished_at: 101,
            mode: DeleteMode::Trash,
            source: "test".into(),
            freed_bytes: 42,
            deleted_count: 1,
            failed_count: 0,
            skipped_count: 0,
        };
        let item = CleanupItemRecord {
            id: 0,
            path: "/x".into(),
            kind: "file".into(),
            size: 42,
            rule: "temp_file".into(),
            safety: SafetyLevel::Safe,
            status: ItemStatus::Trashed,
            error: None,
            restored_at: None,
        };
        let id = h.record_cleanup(&run, &[item]).unwrap();
        assert_eq!(h.cleanup_runs(10).unwrap()[0].freed_bytes, 42);
        assert_eq!(h.cleanup_items(id).unwrap()[0].status, ItemStatus::Trashed);
        assert_eq!(h.totals().unwrap().freed_bytes, 42);

        h.record_snapshot(&SpaceSnapshot {
            taken_at: 5,
            mount: "C:\\".into(),
            label: "OS".into(),
            total_bytes: 100,
            free_bytes: 40,
            trigger: "test".into(),
        })
        .unwrap();
        assert_eq!(h.snapshots_since(0).unwrap().len(), 1);
        assert_eq!(h.last_snapshot_at("C:\\").unwrap(), Some(5));
    }
}
