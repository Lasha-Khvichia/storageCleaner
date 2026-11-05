//! Tauri backend: a thin layer exposing the core to the React UI.
//!
//! The UI only ever sends node ids and flags. Paths, sizes and every safety
//! decision come from the Rust side, and deletions are re-validated by the
//! core right before they happen.

mod commands;
mod state;

use std::time::Duration;

use storage_cleaner_core::disks;
use tauri::Manager;

use crate::state::AppState;

/// How often free-space snapshots are recorded while the app is open.
const SNAPSHOT_INTERVAL: Duration = Duration::from_secs(30 * 60);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let state = AppState::new().map_err(|e| e.to_string())?;
            app.manage(state);

            // Free-space history for the analytics graph.
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                loop {
                    let state = handle.state::<AppState>();
                    if let Ok(h) = state.history.lock() {
                        let _ = disks::record_snapshots(&h, "auto", SNAPSHOT_INTERVAL.as_secs() as i64 - 60);
                    }
                    std::thread::sleep(SNAPSHOT_INTERVAL);
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_disks,
            commands::start_scan,
            commands::cancel_scan,
            commands::get_scan_info,
            commands::get_node,
            commands::get_children,
            commands::get_breadcrumbs,
            commands::get_treemap,
            commands::get_largest_files,
            commands::get_type_breakdown,
            commands::get_suggestions,
            commands::get_recommendations,
            commands::get_safety_totals,
            commands::plan_delete,
            commands::execute_delete,
            commands::get_cleanup_runs,
            commands::get_cleanup_items,
            commands::get_history_totals,
            commands::restore_run,
            commands::purge_run,
            commands::get_recycle_bin,
            commands::empty_recycle_bin,
            commands::clear_cleanup_history,
            commands::get_space_history,
            commands::record_space_snapshot,
            commands::get_scans,
            commands::export_csv,
            commands::get_confirm_phrase,
        ])
        .run(tauri::generate_context!())
        .expect("error while running storageCleaner");
}
