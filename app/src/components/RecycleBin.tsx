import { useEffect, useState } from "react";
import { ask } from "@tauri-apps/plugin-dialog";
import { Recycle, Trash } from "lucide-react";
import { api, errorMessage, type RecycleBinInfo } from "../api";
import { cx, formatBytes, formatCount } from "../lib/format";
import { useStore } from "../store";
import { Button, Card } from "./ui";

/** Recycle Bin size, refreshed after deletes, on focus and every 30 s. */
function useRecycleBin() {
  const dataVersion = useStore((s) => s.dataVersion);
  const [info, setInfo] = useState<RecycleBinInfo | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => api.getRecycleBin().then((i) => alive && setInfo(i)).catch(() => {});
    load();
    const timer = window.setInterval(load, 30_000);
    window.addEventListener("focus", load);
    return () => {
      alive = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", load);
    };
  }, [dataVersion]);
  return info;
}

/** Confirm, empty, toast. `drive` null = every drive. */
function useEmptyBin() {
  const pushToast = useStore((s) => s.pushToast);
  const bumpData = useStore((s) => s.bumpData);
  const [busy, setBusy] = useState(false);
  const empty = async (info: RecycleBinInfo, drive: string | null) => {
    const target = drive ? info.drives.find((d) => d.drive === drive) : info;
    if (!target || target.items === 0) return;
    const ok = await ask(
      `Permanently delete ${formatCount(target.items)} item(s) (${formatBytes(target.bytes)}) from the Recycle Bin` +
        (drive ? ` on ${drive}` : " on all drives") +
        "?\n\nThis frees the disk space, but nothing in the Recycle Bin can be restored afterwards.",
      { title: "Empty Recycle Bin", kind: "warning", okLabel: "Empty Recycle Bin", cancelLabel: "Cancel" },
    );
    if (!ok) return;
    setBusy(true);
    try {
      const r = await api.emptyRecycleBin(drive);
      pushToast({
        kind: "success",
        title: `Freed ${formatBytes(r.freedBytes)}`,
        body: `Recycle Bin emptied (${formatCount(r.items)} items).`,
      });
      bumpData();
    } catch (e) {
      pushToast({ kind: "error", title: "Couldn't empty the Recycle Bin", body: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };
  return { empty, busy };
}

/** Always-visible sidebar widget. */
export function RecycleBinWidget() {
  const info = useRecycleBin();
  const { empty, busy } = useEmptyBin();
  const full = !!info && info.items > 0;
  return (
    <div
      className={cx(
        "mx-3 mb-3 rounded-xl border p-3 transition-colors",
        full ? "border-amber-500/40 bg-gradient-to-br from-amber-500/15 to-orange-500/5" : "border-line bg-panel",
      )}
    >
      <div className="flex items-center gap-2.5">
        <div className={cx("rounded-lg p-2", full ? "bg-amber-500/20 text-amber-300" : "bg-white/5 text-slate-400")}>
          <Recycle className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium text-slate-300">Recycle Bin</div>
          <div className={cx("tabular text-base font-bold leading-tight", full ? "text-amber-200" : "text-slate-400")}>
            {info ? formatBytes(info.bytes) : "…"}
          </div>
        </div>
        {info && <div className="text-[11px] text-muted">{formatCount(info.items)} items</div>}
      </div>
      <Button
        size="sm"
        variant={full ? "danger" : "secondary"}
        className="mt-2.5 w-full"
        disabled={!full}
        loading={busy}
        onClick={() => info && empty(info, null)}
      >
        <Trash className="h-3.5 w-3.5" /> {full ? "Empty Recycle Bin" : "Recycle Bin is empty"}
      </Button>
    </div>
  );
}

/** Dashboard card with a per-drive breakdown. */
export function RecycleBinCard() {
  const info = useRecycleBin();
  const { empty, busy } = useEmptyBin();
  const full = !!info && info.items > 0;
  return (
    <Card
      className={cx("mb-6", full && "border-amber-500/30")}
      title="Recycle Bin"
      icon={<Recycle className={cx("h-4 w-4", full ? "text-amber-300" : "text-muted")} />}
      actions={
        <Button size="sm" variant={full ? "danger" : "secondary"} disabled={!full} loading={busy} onClick={() => info && empty(info, null)}>
          <Trash className="h-3.5 w-3.5" /> Empty all
        </Button>
      }
    >
      {!info ? (
        <div className="text-sm text-muted">Checking…</div>
      ) : !full ? (
        <div className="text-sm text-muted">The Recycle Bin is empty. Nothing is using space there.</div>
      ) : (
        <div className="flex items-center gap-8">
          <div>
            <div className="tabular text-3xl font-bold text-amber-200">{formatBytes(info.bytes)}</div>
            <div className="mt-1 text-sm text-muted">
              {formatCount(info.items)} items still using disk space. Deleted files only free space once the bin is emptied.
            </div>
          </div>
          <div className="ml-auto flex flex-wrap gap-2">
            {info.drives.map((d) => (
              <div key={d.drive} className="flex items-center gap-3 rounded-xl border border-line bg-panel-2 px-3 py-2">
                <div>
                  <div className="text-xs text-muted">{d.drive}</div>
                  <div className="tabular font-semibold">{formatBytes(d.bytes)}</div>
                </div>
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => empty(info, d.drive)} title={`Empty on ${d.drive}`}>
                  <Trash className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}
