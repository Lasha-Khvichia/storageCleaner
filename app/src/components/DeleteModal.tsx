import { useEffect, useState } from "react";
import { AlertTriangle, Ban, Lock, ShieldAlert, Trash2 } from "lucide-react";
import { api, errorMessage, type DeletePlan } from "../api";
import { cx, formatBytes } from "../lib/format";
import { useStore } from "../store";
import { Button, Modal, SafetyBadge, Spinner } from "./ui";

/**
 * Review-and-confirm dialog. The plan (what is allowed, blocked and why)
 * comes from Rust; this dialog only collects the user's confirmation.
 */
export function DeleteModal() {
  const open = useStore((s) => s.deleteModalOpen);
  const setOpen = useStore((s) => s.setDeleteModalOpen);
  const selection = useStore((s) => s.selection);
  const permanent = useStore((s) => s.permanentDelete);
  const clearSelection = useStore((s) => s.clearSelection);
  const bumpData = useStore((s) => s.bumpData);
  const pushToast = useStore((s) => s.pushToast);

  const [plan, setPlan] = useState<DeletePlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [phrase, setPhrase] = useState("");
  const [requiredPhrase, setRequiredPhrase] = useState("DELETE PERMANENTLY");
  const [understood, setUnderstood] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setPlan(null);
    setError(null);
    setPhrase("");
    setUnderstood(false);
    const ids = [...selection.keys()];
    api.planDelete(ids, permanent).then(setPlan).catch((e) => setError(errorMessage(e)));
    api.getConfirmPhrase().then(setRequiredPhrase).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const close = () => !busy && setOpen(false);
  const allowed = plan?.items.filter((i) => i.allowed) ?? [];
  const blocked = plan?.items.filter((i) => !i.allowed) ?? [];
  const needsUnderstand = allowed.some((i) => i.safety !== "safe");
  const phraseOk = !permanent || phrase === (plan?.confirmPhrase ?? requiredPhrase);
  const canDelete = !!plan && allowed.length > 0 && phraseOk && (!needsUnderstand || understood) && !busy;

  const run = async () => {
    if (!plan) return;
    setBusy(true);
    try {
      const ids = [...selection.keys()];
      const report = await api.executeDelete(ids, permanent, permanent ? phrase : null);
      const failed = report.items.filter((i) => i.status === "failed");
      const partial = report.items.filter((i) => i.status === "partial");
      // Group identical reasons ("In use by another program…") instead of
      // dumping one raw OS error per item.
      const reasons = new Map<string, number>();
      for (const f of failed) reasons.set(f.error ?? "Unknown error", (reasons.get(f.error ?? "Unknown error") ?? 0) + 1);
      const lines: string[] = [
        `${report.deletedCount} ${permanent ? "permanently deleted" : "moved to the Recycle Bin"}` +
          (partial.length ? ` (${partial.length} partly: some files inside were in use)` : "") +
          (report.skippedCount ? `, ${report.skippedCount} skipped` : ""),
      ];
      for (const [why, n] of reasons) lines.push(`${n} not deleted: ${why}`);
      if (!permanent && report.freedBytes > 0)
        lines.push("Recycle Bin items still use disk space. To free it now: History → Empty from bin.");
      pushToast({
        kind: failed.length && report.deletedCount === 0 ? "error" : failed.length ? "info" : "success",
        title: report.deletedCount === 0 ? "Nothing was deleted" : permanent ? `Freed ${formatBytes(report.freedBytes)}` : `Moved ${formatBytes(report.freedBytes)} to the Recycle Bin`,
        body: lines.join("\n"),
      });
      clearSelection();
      bumpData();
      setOpen(false);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={close}
      wide
      danger={permanent}
      title={
        permanent ? (
          <span className="flex items-center gap-2 text-red-300">
            <ShieldAlert className="h-5 w-5" /> Permanently delete — review carefully
          </span>
        ) : (
          <span className="flex items-center gap-2">
            <Trash2 className="h-5 w-5 text-indigo-300" /> Move to Recycle Bin — review
          </span>
        )
      }
      footer={
        <>
          <Button variant="ghost" onClick={close} disabled={busy}>
            Cancel
          </Button>
          <Button variant={permanent ? "danger" : "primary"} disabled={!canDelete} loading={busy} onClick={run}>
            <Trash2 className="h-4 w-4" />
            {permanent ? "Delete permanently" : "Move to Recycle Bin"}
            {plan && ` · ${formatBytes(plan.allowedBytes)}`}
          </Button>
        </>
      }
    >
      {error && (
        <div className="mb-4 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</div>
      )}
      {!plan && !error && <Spinner label="Checking every item against the safety rules…" />}
      {plan && (
        <div className="space-y-5">
          {permanent && (
            <div className="rounded-xl border-2 border-red-500 bg-red-950/60 p-4">
              <div className="flex items-center gap-2 text-base font-bold text-red-300">
                <AlertTriangle className="h-5 w-5" /> These files will NOT go to the Recycle Bin.
              </div>
              <p className="mt-1 text-sm text-red-200/90">
                Permanent deletion cannot be undone. Restore from history will not be possible.
              </p>
            </div>
          )}

          <div className="grid grid-cols-3 gap-3">
            <SummaryBox label="Will be freed" value={formatBytes(plan.allowedBytes)} tone={permanent ? "red" : "green"} />
            <SummaryBox label="Items to delete" value={String(plan.allowedCount)} />
            <SummaryBox
              label="Blocked (protected)"
              value={String(plan.blockedCount)}
              tone={plan.blockedCount ? "red" : undefined}
            />
          </div>

          {plan.warnings.length > 0 && (
            <ul className="space-y-1.5">
              {plan.warnings.map((w) => (
                <li key={w} className="flex items-start gap-2 text-sm text-amber-300">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {w}
                </li>
              ))}
            </ul>
          )}
          {plan.mergedCount > 0 && (
            <p className="text-xs text-muted">
              {plan.mergedCount} selected item(s) are inside another selected folder and were merged into it.
            </p>
          )}

          <div className="max-h-72 overflow-y-auto rounded-xl border border-line">
            {[...allowed, ...blocked].map((it) => (
              <div
                key={it.path}
                className={cx("flex gap-3 border-b border-line/70 px-4 py-2.5 last:border-b-0", !it.allowed && "bg-red-950/20 opacity-70")}
              >
                <div className="mt-0.5">
                  {it.allowed ? <SafetyBadge level={it.safety} reason={it.reason} compact /> : <Ban className="h-4 w-4 text-red-400" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-3">
                    <span className={cx("truncate text-sm", !it.allowed && "line-through")} title={it.path}>
                      {it.path}
                    </span>
                    <span className="tabular ml-auto shrink-0 text-sm font-medium">{formatBytes(it.size)}</span>
                  </div>
                  {!it.allowed && (
                    <div className="mt-0.5 flex items-center gap-1.5 text-xs text-red-300">
                      <Lock className="h-3 w-3" /> Blocked: {it.blockedReason}
                    </div>
                  )}
                  {it.allowed &&
                    it.warnings
                      .filter((w) => !w.startsWith("Permanent delete"))
                      .map((w) => (
                        <div key={w} className="mt-0.5 text-xs text-amber-300/90">
                          ! {w}
                        </div>
                      ))}
                </div>
              </div>
            ))}
          </div>

          {needsUnderstand && allowed.length > 0 && (
            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
              <input
                type="checkbox"
                checked={understood}
                onChange={(e) => setUnderstood(e.target.checked)}
                className="mt-0.5 h-4 w-4 accent-amber-500"
              />
              <span>
                <span className="font-semibold text-amber-200">I understand</span>
                <span className="text-amber-100/80">
                  {" "}
                  — some items are not rated <b>Safe</b>. I have checked them and want to delete them anyway.
                </span>
              </span>
            </label>
          )}

          {permanent && allowed.length > 0 && (
            <div className="rounded-xl border border-red-500/50 bg-red-950/40 p-4">
              <label className="text-sm text-red-200">
                Type <code className="rounded bg-red-900/60 px-1.5 py-0.5 font-mono font-bold text-white">{plan.confirmPhrase ?? requiredPhrase}</code>{" "}
                to confirm:
              </label>
              <input
                autoFocus
                value={phrase}
                onChange={(e) => setPhrase(e.target.value)}
                spellCheck={false}
                className={cx(
                  "mt-2 w-full rounded-lg border bg-black/40 px-3 py-2 font-mono text-sm outline-none select-text",
                  phraseOk ? "border-emerald-500/60" : "border-red-500/50 focus:border-red-400",
                )}
                placeholder={plan.confirmPhrase ?? requiredPhrase}
              />
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

function SummaryBox({ label, value, tone }: { label: string; value: string; tone?: "green" | "red" }) {
  return (
    <div className="rounded-xl border border-line bg-panel-2/60 px-4 py-3">
      <div className="text-[11px] uppercase tracking-wider text-muted">{label}</div>
      <div
        className={cx(
          "tabular mt-1 text-lg font-semibold",
          tone === "green" && "text-emerald-400",
          tone === "red" && "text-red-400",
        )}
      >
        {value}
      </div>
    </div>
  );
}
