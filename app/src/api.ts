// Typed wrappers around the Tauri commands in src-tauri/src/commands.rs.
// Field names mirror the Rust serde output (camelCase).
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type SafetyLevel = "safe" | "review" | "unknown" | "protected";
export type NodeKind = "dir" | "file" | "link";
export type DeleteMode = "trash" | "permanent";
export type ItemStatus = "trashed" | "deleted" | "failed" | "skipped" | "restored" | "partial" | "purged";

export interface PurgeResult {
  purged: number;
  bytes: number;
}

export interface DiskInfo {
  name: string;
  mount: string;
  fileSystem: string;
  kind: string;
  removable: boolean;
  readOnly: boolean;
  totalBytes: number;
  freeBytes: number;
  usedBytes: number;
}

export interface NodeView {
  id: number;
  name: string;
  path: string;
  kind: NodeKind;
  size: number;
  files: number;
  dirs: number;
  modified: number;
  childCount: number;
  errors: number;
  safety: SafetyLevel;
  category: string;
  rule: string;
  reason: string;
  shareOfParent: number;
}

export interface ScanProgress {
  files: number;
  dirs: number;
  bytes: number;
  errors: number;
  currentPath: string;
}

export interface ScanInfo {
  root: NodeView;
  startedAt: number;
  durationMs: number;
  nodeCount: number;
}

export interface ScanFailed {
  message: string;
  cancelled: boolean;
}

export interface Crumb {
  id: number;
  name: string;
}

export interface TreemapNode {
  id: number | null;
  name: string;
  value: number;
  safety: SafetyLevel;
  isDir: boolean;
  children?: TreemapNode[];
}

export interface TypeGroup {
  group: string;
  bytes: number;
  files: number;
  extensions: [string, number, number][];
}

export interface SuggestionGroup {
  category: string;
  label: string;
  safety: SafetyLevel;
  bytes: number;
  count: number;
  items: NodeView[];
}

export interface Recommendation {
  node: NodeView;
  /** 0–100, higher is a better cleanup. */
  score: number;
  /** 0–1, how sure we are it can be deleted. */
  confidence: number;
  ageDays: number;
  reasons: string[];
  plans: string[];
}

export interface CleanupPlan {
  id: string;
  title: string;
  description: string;
  risk: SafetyLevel;
  bytes: number;
  count: number;
  itemIds: number[];
}

export interface RecommendationReport {
  root: string;
  scannedBytes: number;
  candidates: number;
  plans: CleanupPlan[];
  items: Recommendation[];
}

export interface DriveBin {
  drive: string;
  bytes: number;
  items: number;
}

export interface RecycleBinInfo {
  bytes: number;
  items: number;
  drives: DriveBin[];
}

export interface EmptyResult {
  freedBytes: number;
  items: number;
  runId: number;
}

export interface SafetyTotal {
  level: SafetyLevel;
  bytes: number;
}

export interface PlanItem {
  path: string;
  kind: NodeKind;
  size: number;
  safety: SafetyLevel;
  rule: string;
  reason: string;
  allowed: boolean;
  blockedReason: string | null;
  warnings: string[];
}

export interface DeletePlan {
  mode: DeleteMode;
  items: PlanItem[];
  totalBytes: number;
  allowedBytes: number;
  allowedCount: number;
  blockedCount: number;
  mergedCount: number;
  warnings: string[];
  confirmPhrase: string | null;
}

export interface ItemOutcome {
  path: string;
  size: number;
  status: ItemStatus;
  error: string | null;
}

export interface DeleteReport {
  runId: number;
  mode: DeleteMode;
  freedBytes: number;
  deletedCount: number;
  failedCount: number;
  skippedCount: number;
  items: ItemOutcome[];
}

export interface CleanupRun {
  id: number;
  startedAt: number;
  finishedAt: number;
  mode: DeleteMode;
  source: string;
  freedBytes: number;
  deletedCount: number;
  failedCount: number;
  skippedCount: number;
}

export interface CleanupItem {
  id: number;
  path: string;
  kind: string;
  size: number;
  rule: string;
  safety: SafetyLevel;
  status: ItemStatus;
  error: string | null;
  restoredAt: number | null;
}

export interface HistoryTotals {
  runs: number;
  freedBytes: number;
  itemsDeleted: number;
  lastCleanupAt: number | null;
}

export interface RestoreResult {
  restored: number;
  missing: number;
}

export interface SpaceSnapshot {
  takenAt: number;
  mount: string;
  label: string;
  totalBytes: number;
  freeBytes: number;
  trigger: string;
}

export interface ScanSummary {
  id: number;
  root: string;
  startedAt: number;
  durationMs: number;
  totalBytes: number;
  files: number;
  dirs: number;
  errors: number;
  top: [string, number][];
}

export const api = {
  getDisks: () => invoke<DiskInfo[]>("get_disks"),
  startScan: (path: string) => invoke<void>("start_scan", { path }),
  cancelScan: () => invoke<void>("cancel_scan"),
  getScanInfo: () => invoke<ScanInfo | null>("get_scan_info"),
  getNode: (id: number) => invoke<NodeView | null>("get_node", { id }),
  getChildren: (id: number, offset: number, limit: number) =>
    invoke<NodeView[]>("get_children", { id, offset, limit }),
  getBreadcrumbs: (id: number) => invoke<Crumb[]>("get_breadcrumbs", { id }),
  getTreemap: (id: number, depth: number, maxChildren: number) =>
    invoke<TreemapNode | null>("get_treemap", { id, depth, maxChildren }),
  getLargestFiles: (limit: number) => invoke<NodeView[]>("get_largest_files", { limit }),
  getTypeBreakdown: () => invoke<TypeGroup[]>("get_type_breakdown"),
  getSuggestions: (includeReview: boolean) =>
    invoke<SuggestionGroup[]>("get_suggestions", { includeReview }),
  getRecommendations: () => invoke<RecommendationReport>("get_recommendations"),
  getSafetyTotals: () => invoke<SafetyTotal[]>("get_safety_totals"),
  planDelete: (ids: number[], permanent: boolean) =>
    invoke<DeletePlan>("plan_delete", { ids, permanent }),
  executeDelete: (ids: number[], permanent: boolean, confirmPhrase: string | null) =>
    invoke<DeleteReport>("execute_delete", { ids, permanent, confirmPhrase }),
  getConfirmPhrase: () => invoke<string>("get_confirm_phrase"),
  getCleanupRuns: (limit: number) => invoke<CleanupRun[]>("get_cleanup_runs", { limit }),
  getCleanupItems: (runId: number) => invoke<CleanupItem[]>("get_cleanup_items", { runId }),
  getHistoryTotals: () => invoke<HistoryTotals>("get_history_totals"),
  restoreRun: (runId: number) => invoke<RestoreResult>("restore_run", { runId }),
  getRecycleBin: () => invoke<RecycleBinInfo>("get_recycle_bin"),
  emptyRecycleBin: (drive: string | null) => invoke<EmptyResult>("empty_recycle_bin", { drive }),
  purgeRun: (runId: number) => invoke<PurgeResult>("purge_run", { runId }),
  clearCleanupHistory: () => invoke<void>("clear_cleanup_history"),
  getSpaceHistory: (days: number) => invoke<SpaceSnapshot[]>("get_space_history", { days }),
  recordSpaceSnapshot: () => invoke<number>("record_space_snapshot"),
  getScans: (limit: number) => invoke<ScanSummary[]>("get_scans", { limit }),
  exportCsv: (path: string, depth: number) => invoke<void>("export_csv", { path, depth }),
};

export const events = {
  onScanProgress: (cb: (p: ScanProgress) => void): Promise<UnlistenFn> =>
    listen<ScanProgress>("scan-progress", (e) => cb(e.payload)),
  onScanFinished: (cb: (info: ScanInfo | null) => void): Promise<UnlistenFn> =>
    listen<ScanInfo | null>("scan-finished", (e) => cb(e.payload)),
  onScanFailed: (cb: (f: ScanFailed) => void): Promise<UnlistenFn> =>
    listen<ScanFailed>("scan-failed", (e) => cb(e.payload)),
};

/** Tauri rejects with a plain string; normalise to a message. */
export function errorMessage(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  return JSON.stringify(e);
}
