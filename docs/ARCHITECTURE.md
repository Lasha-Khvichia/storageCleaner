# storageCleaner — Architecture

## Goal

A desktop app that scans whole drives, shows a full report of what uses space,
tells the user what is *most likely safe* to delete, and deletes the items they
choose safely, keeping a history of every cleanup and of free space over time.

## Layout

```
storageCleaner/
├── crates/
│   ├── core/            Rust library: all file-system logic (the only code that deletes)
│   │   ├── scan.rs      parallel read-only scanner → in-memory tree
│   │   ├── model.rs     compact arena tree (millions of nodes), views for the UI
│   │   ├── safety.rs    safety classifier: rules → Safe / Review / Unknown / Protected
│   │   ├── delete.rs    plan → validate → Recycle Bin / permanent delete
│   │   ├── history.rs   SQLite: cleanup runs + items, free-space snapshots, scans
│   │   ├── disks.rs     drive list + free-space snapshots
│   │   └── report.rs    largest files, type breakdown, suggestions, CSV
│   └── cli/             `storagecleaner` CLI on top of core
├── app/                 Tauri v2 desktop app
│   ├── src-tauri/       Rust backend: thin command layer over core
│   └── src/             React + TypeScript dashboard UI
├── docker/Dockerfile    dev/CI image + tiny CLI image
├── compose.yaml         test / lint / sandbox / cli / build-linux / dev
└── scripts/             sandbox end-to-end safety tests
```

## Data flow

```
React UI ──invoke(ids, flags)──▶ Tauri commands ──▶ core
   ▲                                                  │
   └──────── events: scan-progress / finished ◀───────┘
```

* The scan result lives **in Rust** (`AppState.tree`). The UI pages through it
  by node id (`get_children`, `get_treemap`...). A full drive never crosses
  the bridge at once.
* The UI sends **only node ids** to delete. Paths, sizes and safety come from
  the Rust tree, and `core::delete` re-validates every path on disk right
  before deleting it.

## Scanner

* `rayon` parallel directory walk; atomics for live progress; cancellable.
* Never follows symlinks/junctions (recorded as `link`, 0 bytes). On Linux it
  doesn't cross file-system boundaries.
* OneDrive online-only placeholders count as 0 bytes (no local space).
* Each entry is classified *during* the scan (marker files like
  `CACHEDIR.TAG` / `pyvenv.cfg` are seen before the folder is rated).

## Safety model

| Level | Meaning | Examples |
|---|---|---|
| 🟢 **Safe** | regenerated automatically / never needed again | `%TEMP%`, browser & app caches, `node_modules`, `__pycache__`, Rust `target/`, crash dumps, Windows Update download cache, npm/pip/cargo caches |
| 🟡 **Review** | probably removable, but it's the user's data | Downloads, installers/archives in Downloads, logs, `.venv`, `Windows.old`, large files untouched for 2+ years |
| ⚪ **Unknown** | no rule matched | everything else |
| 🔴 **Protected** | deleting breaks Windows, programs or the profile: **blocked** | `C:\Windows`, Program Files, ProgramData, the user profile and AppData roots, pagefile/hiberfil, Recycle Bin, System Volume Information, `.git`, VM/WSL/Docker disks, drive roots |

Rules are evaluated most-specific first (see `safety.rs` docs), so
`C:\Windows\Temp\*` is Safe even though `C:\Windows` is Protected. Every rule
carries a human readable *reason* shown in the UI.

## Deletion safety (enforced in core, not the UI)

1. **Plan**: dedupe (drop children of selected parents), validate each item,
   collect warnings and blocked items, compute space to free.
2. **Blocked always**: drive roots, Protected rules, any folder *containing*
   a critical location (Windows, Program Files, profile, AppData, the app's own
   binaries and data).
3. **Recycle Bin by default**, so it can be restored from the History page.
4. **Permanent delete** is opt-in (Settings). It shows a persistent red banner
   while enabled, and `core::delete::execute` refuses to run unless the exact
   phrase `DELETE PERMANENTLY` is passed.
5. **Re-validated right before deletion** (paths can change between plan and execute).
6. Links are removed as links; their targets are never touched.
7. Every item is written to the history DB: status, size, rule, errors.

## History & analytics

SQLite at `%APPDATA%\storageCleaner\history.db`
(override with `STORAGE_CLEANER_DATA_DIR`):

* `cleanup_runs` / `cleanup_items`: every cleanup, restorable via Recycle Bin.
* `space_snapshots`: free/total per drive, recorded on startup, every 30 min
  while the app runs, after each scan, cleanup and restore. Feeds the
  free-space graph.
* `scan_runs`: summary of each scan (top folders), for future comparisons.

## Docker

The desktop app runs natively on Windows (a GUI can't run in a Linux container
and must see real disks). Docker provides a reproducible toolchain for
everything else: tests, lint, Linux builds, a read-only CLI, and the
**sandbox**, which runs end-to-end delete/restore tests on throwaway files in a
tmpfs with no network.

## Roadmap

- [x] v0.1: scan, report, treemap, safety ratings, suggestions, safe delete, restore, history, free-space analytics, CLI, Docker
- [ ] Duplicate finder (size → partial hash → BLAKE3)
- [ ] Scan comparison ("C: grew 8 GB since last week, here's where")
- [ ] NTFS MFT fast scan (seconds for a whole drive, needs admin)
- [ ] HTML report export, scheduled scans, tray icon
