import { useState } from "react";
import { ask } from "@tauri-apps/plugin-dialog";
import { ChevronDown, ChevronRight, Eraser, History as HistoryIcon, ScanSearch, Trash2, Undo2 } from "lucide-react";
import { api, errorMessage, type CleanupRun, type ItemStatus } from "../api";
import { PageHeader } from "../components/Layout";
import { Button, Card, Empty, Modal, SafetyBadge, Spinner, Stat, useAsync } from "../components/ui";
import { cx, formatBytes, formatCount, formatDateTime, formatDuration, timeAgo } from "../lib/format";
import { useStore } from "../store";

const STATUS_STYLE: Record<ItemStatus, string> = {
  trashed: "text-indigo-300",
  deleted: "text-red-300",
  failed: "text-red-400",
  skipped: "text-slate-400",
  restored: "text-emerald-400",
  partial: "text-amber-300",
  purged: "text-slate-500",
};

export function HistoryPage() {
  const dataVersion = useStore((s) => s.dataVersion);
  const bumpData = useStore((s) => s.bumpData);
  const pushToast = useStore((s) => s.pushToast);
  const runs = useAsync(() => api.getCleanupRuns(200), [dataVersion]);
  const totals = useAsync(() => api.getHistoryTotals(), [dataVersion]);
  const scans = useAsync(() => api.getScans(20), [dataVersion]);
  const [confirmClear, setConfirmClear] = useState(false);

  const clear = async () => {
    try {
      await api.clearCleanupHistory();
      pushToast({ kind: "success", title: "Cleanup history cleared" });
      bumpData();
    } catch (e) {
      pushToast({ kind: "error", title: "Could not clear history", body: errorMessage(e) });
    }
    setConfirmClear(false);
  };

  return (
    <div>
      <PageHeader
        title="History"
        subtitle="Every cleanup is logged. Items moved to the Recycle Bin can be restored from here."
        actions={
          <Button size="sm" variant="ghost" onClick={() => setConfirmClear(true)} disabled={!runs.data?.length}>
            <Trash2 className="h-3.5 w-3.5" /> Clear history
          </Button>
        }
      />
      <div className="mb-6 grid grid-cols-3 gap-4">
        <Stat label="Total freed" value={formatBytes(totals.data?.freedBytes ?? 0)} accent="#22c55e" />
        <Stat label="Cleanups" value={totals.data?.runs ?? 0} />
        <Stat label="Items removed" value={formatCount(totals.data?.itemsDeleted ?? 0)} />
      </div>

      <Card title="Cleanups" icon={<HistoryIcon className="h-4 w-4 text-indigo-300" />} bodyClassName="p-0" className="mb-5">
        {runs.loading && !runs.data ? (
          <Spinner />
        ) : (runs.data ?? []).length === 0 ? (
          <Empty icon={<HistoryIcon className="h-6 w-6" />} title="No cleanups yet" />
        ) : (
          <div>
            {(runs.data ?? []).map((r) => (
              <RunRow key={r.id} run={r} />
            ))}
          </div>
        )}
      </Card>

      <Card title="Past scans" icon={<ScanSearch className="h-4 w-4 text-indigo-300" />} bodyClassName="p-0">
        {(scans.data ?? []).length === 0 ? (
          <div className="py-8 text-center text-sm text-muted">No scans recorded yet.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-panel-2 text-left text-xs uppercase tracking-wider text-muted">
              <tr>
                <th className="px-5 py-2.5 font-medium">Scanned</th>
                <th className="px-3 py-2.5 font-medium">Location</th>
                <th className="px-3 py-2.5 text-right font-medium">Size</th>
                <th className="px-3 py-2.5 text-right font-medium">Files</th>
                <th className="px-5 py-2.5 text-right font-medium">Duration</th>
              </tr>
            </thead>
            <tbody>
              {(scans.data ?? []).map((s) => (
                <tr key={s.id} className="border-t border-line/70" title={s.top.slice(0, 5).map(([n, b]) => `${n}: ${formatBytes(b)}`).join("\n")}>
                  <td className="px-5 py-2 text-muted">{formatDateTime(s.startedAt)}</td>
                  <td className="px-3 py-2 font-medium">{s.root}</td>
                  <td className="tabular px-3 py-2 text-right">{formatBytes(s.totalBytes)}</td>
                  <td className="tabular px-3 py-2 text-right text-muted">{formatCount(s.files)}</td>
                  <td className="px-5 py-2 text-right text-muted">{formatDuration(s.durationMs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Modal
        open={confirmClear}
        onClose={() => setConfirmClear(false)}
        title="Clear cleanup history?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmClear(false)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={clear}>
              Clear history
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-300">
          This removes the log of past cleanups. Files already in the Recycle Bin stay there, but you won't be able to restore
          them from this app anymore. Free-space analytics are kept.
        </p>
      </Modal>
    </div>
  );
}

function RunRow({ run }: { run: CleanupRun }) {
  const [open, setOpen] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [purging, setPurging] = useState(false);
  const bumpData = useStore((s) => s.bumpData);
  const pushToast = useStore((s) => s.pushToast);
  const items = useAsync(() => (open ? api.getCleanupItems(run.id) : Promise.resolve(null)), [open, run.id]);
  const permanent = run.mode === "permanent";

  const restore = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setRestoring(true);
    try {
      const r = await api.restoreRun(run.id);
      pushToast({
        kind: r.missing ? "info" : "success",
        title: `Restored ${r.restored} item${r.restored === 1 ? "" : "s"}`,
        body: r.missing ? `${r.missing} could not be found in the Recycle Bin (maybe already emptied).` : undefined,
      });
      bumpData();
      items.reload();
    } catch (err) {
      pushToast({ kind: "error", title: "Restore failed", body: errorMessage(err) });
    } finally {
      setRestoring(false);
    }
  };

  const purge = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const ok = await ask(
      "Empty this cleanup's items from the Recycle Bin?\n\nThis frees the disk space now, but they can no longer be restored.",
      { title: "Empty from Recycle Bin", kind: "warning", okLabel: "Empty from bin", cancelLabel: "Cancel" },
    );
    if (!ok) return;
    setPurging(true);
    try {
      const r = await api.purgeRun(run.id);
      pushToast({
        kind: r.purged ? "success" : "info",
        title: r.purged ? `Freed ${formatBytes(r.bytes)}` : "Nothing left in the Recycle Bin",
        body: r.purged ? `${r.purged} item(s) emptied from the Recycle Bin.` : "These items were already restored or emptied.",
      });
      bumpData();
      items.reload();
    } catch (err) {
      pushToast({ kind: "error", title: "Couldn't empty from Recycle Bin", body: errorMessage(err) });
    } finally {
      setPurging(false);
    }
  };

  return (
    <div className="border-b border-line/70 last:border-b-0">
      <div className="flex cursor-pointer items-center gap-4 px-5 py-3.5 hover:bg-white/[0.02]" onClick={() => setOpen((o) => !o)}>
        {open ? <ChevronDown className="h-4 w-4 text-muted" /> : <ChevronRight className="h-4 w-4 text-muted" />}
        <div className="w-44">
          <div className="text-sm font-medium">{formatDateTime(run.finishedAt)}</div>
          <div className="text-xs text-muted">
            {timeAgo(run.finishedAt)} · via {run.source}
          </div>
        </div>
        <span
          className={cx(
            "rounded-full border px-2.5 py-0.5 text-xs font-medium",
            permanent ? "border-red-500/40 bg-red-500/10 text-red-300" : "border-indigo-500/30 bg-indigo-500/10 text-indigo-200",
          )}
        >
          {permanent ? "Permanent" : "Recycle Bin"}
        </span>
        <div className="flex-1 text-sm text-muted">
          {run.deletedCount} deleted
          {run.failedCount > 0 && <span className="text-red-400"> · {run.failedCount} failed</span>}
          {run.skippedCount > 0 && <span> · {run.skippedCount} skipped</span>}
        </div>
        <div className="tabular text-right text-base font-semibold text-emerald-400">{formatBytes(run.freedBytes)}</div>
        {!permanent && run.deletedCount > 0 && (
          <Button size="sm" onClick={restore} loading={restoring}>
            <Undo2 className="h-3.5 w-3.5" /> Restore
          </Button>
        )}
        {!permanent && run.deletedCount > 0 && (
          <Button size="sm" variant="secondary" onClick={purge} loading={purging} title="Free the disk space now (can't be undone)">
            <Eraser className="h-3.5 w-3.5" /> Empty from bin
          </Button>
        )}
      </div>
      {open && (
        <div className="bg-black/20 px-5 pb-4 pt-1">
          {!items.data ? (
            <Spinner />
          ) : (
            <div className="max-h-80 overflow-y-auto rounded-lg border border-line">
              {items.data.map((it) => (
                <div key={it.id} className="flex items-center gap-3 border-b border-line/60 px-3 py-2 text-sm last:border-b-0">
                  <span className={cx("w-16 text-xs font-semibold uppercase", STATUS_STYLE[it.status])}>{it.status}</span>
                  <SafetyBadge level={it.safety} compact />
                  <span className="min-w-0 flex-1 truncate" title={it.error ?? it.path}>
                    {it.path}
                    {it.error && <span className="ml-2 text-xs text-red-400">{it.error}</span>}
                  </span>
                  <span className="tabular text-muted">{formatBytes(it.size)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
