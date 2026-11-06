import { useState } from "react";
import { ask } from "@tauri-apps/plugin-dialog";
import { ChevronDown, ChevronRight, Eraser, History as HistoryIcon, ScanSearch, Trash2, Undo2 } from "lucide-react";
import { api, errorMessage, type CleanupRun, type ItemStatus } from "../api";
import { PageHeader } from "../components/Layout";
import { Button, Card, Empty, Modal, SafetyBadge, Spinner, Stat, useAsync } from "../components/ui";
import { cx, formatBytes, formatCount, formatDateTime, formatDuration, timeAgo } from "../lib/format";
import { useStore } from "../store";
import { trBackend } from "../i18n/backend";
import { useT } from "../i18n/useT";
import type { MessageKey } from "../i18n";

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
  const { t } = useT();
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
      pushToast({ kind: "success", title: t("hist.cleared") });
      bumpData();
    } catch (e) {
      pushToast({ kind: "error", title: t("hist.clearFailed"), body: trBackend(errorMessage(e)) });
    }
    setConfirmClear(false);
  };

  return (
    <div>
      <PageHeader
        title={t("page.history")}
        subtitle={t("hist.subtitle")}
        actions={
          <Button size="sm" variant="ghost" onClick={() => setConfirmClear(true)} disabled={!runs.data?.length}>
            <Trash2 className="h-3.5 w-3.5" /> {t("hist.clear")}
          </Button>
        }
      />
      <div className="mb-6 grid grid-cols-3 gap-4">
        <Stat label={t("hist.totalFreed")} value={formatBytes(totals.data?.freedBytes ?? 0)} accent="var(--sc-positive-300)" />
        <Stat label={t("hist.cleanups")} value={totals.data?.runs ?? 0} />
        <Stat label={t("hist.itemsRemoved")} value={formatCount(totals.data?.itemsDeleted ?? 0)} />
      </div>

      <Card title={t("hist.cleanups")} icon={<HistoryIcon className="h-4 w-4 text-indigo-300" />} bodyClassName="p-0" className="mb-5">
        {runs.loading && !runs.data ? (
          <Spinner />
        ) : (runs.data ?? []).length === 0 ? (
          <Empty icon={<HistoryIcon className="h-6 w-6" />} title={t("hist.noCleanups")} />
        ) : (
          <div>
            {(runs.data ?? []).map((r) => (
              <RunRow key={r.id} run={r} />
            ))}
          </div>
        )}
      </Card>

      <Card title={t("hist.pastScans")} icon={<ScanSearch className="h-4 w-4 text-indigo-300" />} bodyClassName="p-0">
        {(scans.data ?? []).length === 0 ? (
          <div className="py-8 text-center text-sm text-muted">{t("hist.noScans")}</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-panel-2 text-left text-xs uppercase tracking-wider text-muted">
              <tr>
                <th className="px-5 py-2.5 font-medium">{t("hist.col.scanned")}</th>
                <th className="px-3 py-2.5 font-medium">{t("hist.col.location")}</th>
                <th className="px-3 py-2.5 text-right font-medium">{t("hist.col.size")}</th>
                <th className="px-3 py-2.5 text-right font-medium">{t("hist.col.files")}</th>
                <th className="px-5 py-2.5 text-right font-medium">{t("hist.col.duration")}</th>
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
        title={t("hist.clearTitle")}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmClear(false)}>
              {t("common.cancel")}
            </Button>
            <Button variant="danger" onClick={clear}>
              {t("hist.clear")}
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-300">{t("hist.clearBody")}</p>
      </Modal>
    </div>
  );
}

function RunRow({ run }: { run: CleanupRun }) {
  const { t, tn } = useT();
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
        title: tn("hist.restored", r.restored),
        body: r.missing ? t("hist.missing", { n: r.missing }) : undefined,
      });
      bumpData();
      items.reload();
    } catch (err) {
      pushToast({ kind: "error", title: t("hist.restoreFailed"), body: trBackend(errorMessage(err)) });
    } finally {
      setRestoring(false);
    }
  };

  const purge = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const ok = await ask(
      t("hist.purgeConfirm"),
      { title: t("hist.purgeTitle"), kind: "warning", okLabel: t("hist.purgeOk"), cancelLabel: t("common.cancel") },
    );
    if (!ok) return;
    setPurging(true);
    try {
      const r = await api.purgeRun(run.id);
      pushToast({
        kind: r.purged ? "success" : "info",
        title: r.purged ? t("common.freed", { size: formatBytes(r.bytes) }) : t("hist.nothingLeft"),
        body: r.purged ? t("hist.purged", { n: r.purged }) : t("hist.alreadyGone"),
      });
      bumpData();
      items.reload();
    } catch (err) {
      pushToast({ kind: "error", title: t("hist.purgeFailed"), body: trBackend(errorMessage(err)) });
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
            {t("hist.via", { when: timeAgo(run.finishedAt), source: run.source === "cli" ? t("source.cli") : t("source.app") })}
          </div>
        </div>
        <span
          className={cx(
            "rounded-full border px-2.5 py-0.5 text-xs font-medium",
            permanent ? "border-red-500/40 bg-red-500/10 text-red-300" : "border-indigo-500/30 bg-indigo-500/10 text-indigo-200",
          )}
        >
          {permanent ? t("hist.modePermanent") : t("hist.modeTrash")}
        </span>
        <div className="flex-1 text-sm text-muted">
          {t("hist.deleted", { n: run.deletedCount })}
          {run.failedCount > 0 && <span className="text-red-400">{t("hist.failed", { n: run.failedCount })}</span>}
          {run.skippedCount > 0 && <span>{t("hist.skipped", { n: run.skippedCount })}</span>}
        </div>
        <div className="tabular text-right text-base font-semibold text-emerald-400">{formatBytes(run.freedBytes)}</div>
        {!permanent && run.deletedCount > 0 && (
          <Button size="sm" onClick={restore} loading={restoring}>
            <Undo2 className="h-3.5 w-3.5" /> {t("hist.restore")}
          </Button>
        )}
        {!permanent && run.deletedCount > 0 && (
          <Button size="sm" variant="secondary" onClick={purge} loading={purging} title={t("hist.emptyFromBinTip")}>
            <Eraser className="h-3.5 w-3.5" /> {t("hist.emptyFromBin")}
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
                  <span className={cx("min-w-16 shrink-0 whitespace-nowrap text-xs font-semibold uppercase", STATUS_STYLE[it.status])}>{t(`status.${it.status}` as MessageKey)}</span>
                  <SafetyBadge level={it.safety} compact />
                  <span className="min-w-0 flex-1 truncate" title={it.error ? trBackend(it.error) : it.path}>
                    {it.path}
                    {it.error && <span className="ml-2 text-xs text-red-400">{trBackend(it.error)}</span>}
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
