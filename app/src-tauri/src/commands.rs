use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use serde::Serialize;
use storage_cleaner_core::delete::{
    self, DeleteMode, DeletePlan, DeleteReport, DeleteRequestItem, PERMANENT_CONFIRM_PHRASE,
};
use storage_cleaner_core::disks::{self, DiskInfo};
use storage_cleaner_core::history::{
    self, CleanupItemRecord, CleanupRunRecord, HistoryTotals, ScanSummary, SpaceSnapshot,
};
use storage_cleaner_core::model::{NodeId, NodeKind, NodeView, ROOT, Tree};
use storage_cleaner_core::report::{self, SuggestionGroup, TypeGroup};
use storage_cleaner_core::safety::SafetyLevel;
use storage_cleaner_core::scan::{self, ScanControl, ScanOptions};
use storage_cleaner_core::util::now_unix;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::state::AppState;

type CmdResult<T> = Result<T, String>;

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

fn with_tree<T>(state: &AppState, f: impl FnOnce(&Tree) -> T) -> CmdResult<T> {
    let guard = state.tree.read().map_err(err)?;
    let tree = guard.as_ref().ok_or("No scan results yet. Run a scan first.")?;
    Ok(f(tree))
}

// ── Disks ───────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn get_disks() -> Vec<DiskInfo> {
    tauri::async_runtime::spawn_blocking(disks::list_disks)
        .await
        .unwrap_or_default()
}

// ── Scanning ────────────────────────────────────────────────────────────

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ScanInfo {
    pub root: NodeView,
    pub started_at: i64,
    pub duration_ms: u64,
    pub node_count: usize,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ScanFailed {
    message: String,
    cancelled: bool,
}

fn scan_info(tree: &Tree) -> Option<ScanInfo> {
    Some(ScanInfo {
        root: tree.view(ROOT)?,
        started_at: tree.started_at,
        duration_ms: tree.duration_ms,
        node_count: tree.nodes.len(),
    })
}

/// Start scanning in the background. Emits `scan-progress` every 200 ms,
/// then `scan-finished` (ScanInfo) or `scan-failed`.
#[tauri::command]
pub fn start_scan(app: AppHandle, state: State<'_, AppState>, path: String) -> CmdResult<()> {
    let control = {
        let mut slot = state.scan.lock().map_err(err)?;
        if slot.is_some() {
            return Err("A scan is already running.".into());
        }
        let c = Arc::new(ScanControl::new());
        *slot = Some(c.clone());
        c
    };
    let root = PathBuf::from(&path);
    let classifier = state.classifier.clone();
    let tree_slot = state.tree.clone();

    // Progress ticker.
    let ticker_app = app.clone();
    let ticker_ctrl = control.clone();
    let finished = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let ticker_done = finished.clone();
    std::thread::spawn(move || {
        while !ticker_done.load(std::sync::atomic::Ordering::Relaxed) {
            let _ = ticker_app.emit("scan-progress", ticker_ctrl.progress());
            std::thread::sleep(Duration::from_millis(200));
        }
    });

    std::thread::spawn(move || {
        let result = scan::scan(&root, &classifier, &control, &ScanOptions::default());
        finished.store(true, std::sync::atomic::Ordering::Relaxed);
        let state = app.state::<AppState>();
        match result {
            Ok(tree) => {
                let info = scan_info(&tree);
                if let Ok(h) = state.history.lock() {
                    let _ = h.record_scan(&report::summary(&tree));
                    let _ = disks::record_snapshots(&h, "scan", 15 * 60);
                }
                if let Ok(mut slot) = tree_slot.write() {
                    *slot = Some(tree);
                }
                let _ = app.emit("scan-finished", info);
            }
            Err(e) => {
                let cancelled = matches!(e, storage_cleaner_core::Error::Cancelled);
                let _ = app.emit(
                    "scan-failed",
                    ScanFailed {
                        message: e.to_string(),
                        cancelled,
                    },
                );
            }
        }
        if let Ok(mut slot) = state.scan.lock() {
            *slot = None;
        }
    });
    Ok(())
}

#[tauri::command]
pub fn cancel_scan(state: State<'_, AppState>) -> CmdResult<()> {
    if let Some(c) = state.scan.lock().map_err(err)?.as_ref() {
        c.cancel();
    }
    Ok(())
}

#[tauri::command]
pub fn get_scan_info(state: State<'_, AppState>) -> CmdResult<Option<ScanInfo>> {
    let guard = state.tree.read().map_err(err)?;
    Ok(guard.as_ref().and_then(scan_info))
}

// ── Browsing the tree ───────────────────────────────────────────────────

#[tauri::command]
pub fn get_node(state: State<'_, AppState>, id: NodeId) -> CmdResult<Option<NodeView>> {
    with_tree(&state, |t| t.view(id))
}

#[tauri::command]
pub fn get_children(state: State<'_, AppState>, id: NodeId, offset: usize, limit: usize) -> CmdResult<Vec<NodeView>> {
    with_tree(&state, |t| t.children_views(id, offset, limit.min(5000)))
}

#[derive(Serialize)]
pub struct Crumb {
    id: NodeId,
    name: String,
}

#[tauri::command]
pub fn get_breadcrumbs(state: State<'_, AppState>, id: NodeId) -> CmdResult<Vec<Crumb>> {
    with_tree(&state, |t| {
        if t.get(id).is_none() {
            return Vec::new();
        }
        t.ancestry(id)
            .into_iter()
            .map(|i| Crumb {
                id: i,
                name: if i == ROOT {
                    t.root_path.to_string_lossy().into_owned()
                } else {
                    t.nodes[i as usize].name.to_string()
                },
            })
            .collect()
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TreemapNode {
    id: Option<NodeId>,
    name: String,
    value: u64,
    safety: SafetyLevel,
    is_dir: bool,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    children: Vec<TreemapNode>,
}

fn treemap(t: &Tree, id: NodeId, depth: usize, max_children: usize) -> TreemapNode {
    let n = &t.nodes[id as usize];
    let mut children = Vec::new();
    if depth > 0 && n.kind == NodeKind::Dir {
        let min = n.size / 500; // skip slivers too small to see
        let mut rest = 0u64;
        for (i, &c) in n.children.iter().enumerate() {
            let cn = &t.nodes[c as usize];
            if i < max_children && cn.size > min && cn.size > 0 {
                children.push(treemap(t, c, depth - 1, max_children));
            } else {
                rest += cn.size;
            }
        }
        if rest > 0 && !children.is_empty() {
            children.push(TreemapNode {
                id: None,
                name: "Other".into(),
                value: rest,
                safety: SafetyLevel::Unknown,
                is_dir: false,
                children: Vec::new(),
            });
        }
    }
    TreemapNode {
        id: Some(id),
        name: if id == ROOT {
            t.root_path.to_string_lossy().into_owned()
        } else {
            n.name.to_string()
        },
        value: n.size,
        safety: n.rule.level(),
        is_dir: n.kind == NodeKind::Dir,
        children,
    }
}

#[tauri::command]
pub fn get_treemap(
    state: State<'_, AppState>,
    id: NodeId,
    depth: usize,
    max_children: usize,
) -> CmdResult<Option<TreemapNode>> {
    with_tree(&state, |t| {
        t.get(id)
            .map(|_| treemap(t, id, depth.min(4), max_children.clamp(5, 200)))
    })
}

// ── Reports ─────────────────────────────────────────────────────────────

#[tauri::command]
pub fn get_largest_files(state: State<'_, AppState>, limit: usize) -> CmdResult<Vec<NodeView>> {
    with_tree(&state, |t| report::largest_files(t, limit.min(1000)))
}

#[tauri::command]
pub fn get_type_breakdown(state: State<'_, AppState>) -> CmdResult<Vec<TypeGroup>> {
    with_tree(&state, report::type_breakdown)
}

#[tauri::command]
pub fn get_suggestions(state: State<'_, AppState>, include_review: bool) -> CmdResult<Vec<SuggestionGroup>> {
    with_tree(&state, |t| report::suggestions(t, include_review, 50))
}

#[derive(Serialize)]
pub struct SafetyTotal {
    level: SafetyLevel,
    bytes: u64,
}

#[tauri::command]
pub fn get_safety_totals(state: State<'_, AppState>) -> CmdResult<Vec<SafetyTotal>> {
    with_tree(&state, |t| {
        let m = report::safety_totals(t);
        [
            SafetyLevel::Safe,
            SafetyLevel::Review,
            SafetyLevel::Unknown,
            SafetyLevel::Protected,
        ]
        .into_iter()
        .map(|level| SafetyTotal {
            level,
            bytes: *m.get(&level).unwrap_or(&0),
        })
        .collect()
    })
}

#[tauri::command]
pub fn export_csv(state: State<'_, AppState>, path: String, depth: usize) -> CmdResult<()> {
    with_tree(&state, |t| {
        report::export_csv(t, std::path::Path::new(&path), depth.min(20))
    })?
    .map_err(err)
}

// ── Deleting ────────────────────────────────────────────────────────────

fn mode(permanent: bool) -> DeleteMode {
    if permanent {
        DeleteMode::Permanent
    } else {
        DeleteMode::Trash
    }
}

fn request_items(t: &Tree, ids: &[NodeId]) -> Vec<DeleteRequestItem> {
    ids.iter()
        .filter(|&&id| id != ROOT)
        .filter_map(|&id| {
            t.get(id).map(|n| DeleteRequestItem {
                path: t.path_of(id),
                size: n.size,
            })
        })
        .collect()
}

#[tauri::command]
pub async fn plan_delete(app: AppHandle, ids: Vec<NodeId>, permanent: bool) -> CmdResult<DeletePlan> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let items = with_tree(&state, |t| request_items(t, &ids))?;
        if items.is_empty() {
            return Err("Nothing selected.".to_string());
        }
        Ok(delete::plan(items, mode(permanent), &state.classifier))
    })
    .await
    .map_err(err)?
}

#[tauri::command]
pub async fn execute_delete(
    app: AppHandle,
    ids: Vec<NodeId>,
    permanent: bool,
    confirm_phrase: Option<String>,
) -> CmdResult<DeleteReport> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let items = with_tree(&state, |t| request_items(t, &ids))?;
        let report = {
            let history = state.history.lock().map_err(err)?;
            let r = delete::execute(
                items,
                mode(permanent),
                confirm_phrase.as_deref(),
                &state.classifier,
                &history,
                "app",
            )
            .map_err(err)?;
            let _ = disks::record_snapshots(&history, "cleanup", 0);
            r
        };
        // Drop deleted entries from the in-memory tree so sizes update.
        if let Ok(mut guard) = state.tree.write()
            && let Some(tree) = guard.as_mut()
        {
            for o in &report.items {
                if matches!(o.status, history::ItemStatus::Trashed | history::ItemStatus::Deleted)
                    && let Some(id) = tree.find(&o.path)
                {
                    tree.remove(id);
                } else if o.status == history::ItemStatus::Partial
                    && let Some(id) = tree.find(&o.path)
                {
                    tree.shrink(id, o.size);
                }
            }
        }
        Ok(report)
    })
    .await
    .map_err(err)?
}

#[tauri::command]
pub fn get_confirm_phrase() -> &'static str {
    PERMANENT_CONFIRM_PHRASE
}

// ── History ─────────────────────────────────────────────────────────────

#[tauri::command]
pub fn get_cleanup_runs(state: State<'_, AppState>, limit: usize) -> CmdResult<Vec<CleanupRunRecord>> {
    state.history.lock().map_err(err)?.cleanup_runs(limit).map_err(err)
}

#[tauri::command]
pub fn get_cleanup_items(state: State<'_, AppState>, run_id: i64) -> CmdResult<Vec<CleanupItemRecord>> {
    state.history.lock().map_err(err)?.cleanup_items(run_id).map_err(err)
}

#[tauri::command]
pub fn get_history_totals(state: State<'_, AppState>) -> CmdResult<HistoryTotals> {
    state.history.lock().map_err(err)?.totals().map_err(err)
}

#[derive(Serialize)]
pub struct RestoreResult {
    restored: usize,
    missing: usize,
}

#[tauri::command]
pub async fn restore_run(app: AppHandle, run_id: i64) -> CmdResult<RestoreResult> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let h = state.history.lock().map_err(err)?;
        let (restored, missing) = history::restore_run(&h, run_id).map_err(err)?;
        let _ = disks::record_snapshots(&h, "restore", 0);
        Ok(RestoreResult { restored, missing })
    })
    .await
    .map_err(err)?
}

#[tauri::command]
pub fn clear_cleanup_history(state: State<'_, AppState>) -> CmdResult<()> {
    state.history.lock().map_err(err)?.clear_cleanup_history().map_err(err)
}

#[tauri::command]
pub fn get_space_history(state: State<'_, AppState>, days: i64) -> CmdResult<Vec<SpaceSnapshot>> {
    let since = now_unix() - days.clamp(1, 3650) * 86400;
    state.history.lock().map_err(err)?.snapshots_since(since).map_err(err)
}

#[tauri::command]
pub fn record_space_snapshot(state: State<'_, AppState>) -> CmdResult<usize> {
    let h = state.history.lock().map_err(err)?;
    disks::record_snapshots(&h, "manual", 0).map_err(err)
}

#[tauri::command]
pub fn get_scans(state: State<'_, AppState>, limit: usize) -> CmdResult<Vec<ScanSummary>> {
    state.history.lock().map_err(err)?.scans(limit).map_err(err)
}

// ── Recommendations ─────────────────────────────────────────────────────

#[tauri::command]
pub async fn get_recommendations(app: AppHandle) -> CmdResult<storage_cleaner_core::recommend::RecommendationReport> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        with_tree(&state, storage_cleaner_core::recommend::recommend)
    })
    .await
    .map_err(err)?
}

#[derive(Serialize)]
pub struct PurgeResult {
    purged: usize,
    bytes: u64,
}

/// Empty a cleanup run's items from the Recycle Bin. Moving to the bin does
/// not free space on that drive; this does.
#[tauri::command]
pub async fn purge_run(app: AppHandle, run_id: i64) -> CmdResult<PurgeResult> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let h = state.history.lock().map_err(err)?;
        let (purged, bytes) = history::purge_run(&h, run_id).map_err(err)?;
        let _ = disks::record_snapshots(&h, "purge", 0);
        Ok(PurgeResult { purged, bytes })
    })
    .await
    .map_err(err)?
}

// ── Recycle Bin ─────────────────────────────────────────────────────────

#[tauri::command]
pub async fn get_recycle_bin() -> CmdResult<storage_cleaner_core::recycle_bin::RecycleBinInfo> {
    tauri::async_runtime::spawn_blocking(storage_cleaner_core::recycle_bin::info)
        .await
        .map_err(err)?
        .map_err(err)
}

/// Empty the Recycle Bin on one drive (`drive`) or all drives (`None`).
#[tauri::command]
pub async fn empty_recycle_bin(
    app: AppHandle,
    drive: Option<String>,
) -> CmdResult<storage_cleaner_core::recycle_bin::EmptyResult> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let h = state.history.lock().map_err(err)?;
        let r = storage_cleaner_core::recycle_bin::empty(drive.as_deref(), &h, "app").map_err(err)?;
        let _ = disks::record_snapshots(&h, "recycle_bin", 0);
        Ok(r)
    })
    .await
    .map_err(err)?
}
