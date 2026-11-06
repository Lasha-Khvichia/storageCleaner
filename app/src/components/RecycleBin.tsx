import { useEffect, useState } from "react";
import { ask } from "@tauri-apps/plugin-dialog";
import { Loader2, Recycle, Trash } from "lucide-react";
import { api, errorMessage, type RecycleBinInfo } from "../api";
import { cx, formatBytes, formatCount } from "../lib/format";
import { useStore } from "../store";
import { Button, Card } from "./ui";
import { t } from "../i18n";
import { trBackend } from "../i18n/backend";
import { useT } from "../i18n/useT";

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
    const params = { n: formatCount(target.items), size: formatBytes(target.bytes), drive: drive ?? "" };
    const ok = await ask(drive ? t("bin.confirmDrive", params) : t("bin.confirmAll", params), {
      title: t("bin.confirmTitle"),
      kind: "warning",
      okLabel: t("bin.confirmOk"),
      cancelLabel: t("common.cancel"),
    });
    if (!ok) return;
    setBusy(true);
    try {
      const r = await api.emptyRecycleBin(drive);
      pushToast({
        kind: "success",
        title: t("common.freed", { size: formatBytes(r.freedBytes) }),
        body: t("bin.emptied", { n: formatCount(r.items) }),
      });
      bumpData();
    } catch (e) {
      pushToast({ kind: "error", title: t("bin.failed"), body: trBackend(errorMessage(e)) });
    } finally {
      setBusy(false);
    }
  };
  return { empty, busy };
}

/** Always-visible Recycle Bin pill in the top bar. */
export function RecycleBinPill() {
  const { t } = useT();
  const info = useRecycleBin();
  const { empty, busy } = useEmptyBin();
  const full = !!info && info.items > 0;
  return (
    <div
      title={info ? t("bin.itemsTooltip", { n: formatCount(info.items) }) : t("bin.title")}
      className={cx(
        "flex h-8 items-center gap-2 whitespace-nowrap rounded-full border pl-3 pr-1 text-xs transition-colors",
        full ? "border-indigo-500/40 bg-indigo-500/10" : "border-white/[0.08] bg-white/[0.04]",
      )}
    >
      <Recycle className={cx("h-3.5 w-3.5", full ? "text-indigo-300" : "text-slate-500")} />
      <span className="text-slate-400">{t("bin.title")}</span>
      <span className={cx("tabular font-semibold", full ? "text-indigo-200" : "text-slate-500")}>
        {info ? formatBytes(info.bytes) : "…"}
      </span>
      <button
        disabled={!full || busy}
        onClick={() => info && empty(info, null)}
        className={cx(
          "flex h-6 items-center gap-1 rounded-full px-2.5 text-[11px] font-semibold transition-all",
          full ? "btn-primary text-white" : "cursor-not-allowed text-slate-600",
        )}
      >
        {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash className="h-3 w-3" />}
        {t("bin.empty")}
      </button>
    </div>
  );
}

/** Dashboard card with a per-drive breakdown. */
export function RecycleBinCard() {
  const { t } = useT();
  const info = useRecycleBin();
  const { empty, busy } = useEmptyBin();
  const full = !!info && info.items > 0;
  return (
    <Card
      className={cx("mb-6", full && "border-amber-500/30")}
      title={t("bin.title")}
      icon={<Recycle className={cx("h-4 w-4", full ? "text-amber-300" : "text-muted")} />}
      actions={
        <Button size="sm" variant={full ? "danger" : "secondary"} disabled={!full} loading={busy} onClick={() => info && empty(info, null)}>
          <Trash className="h-3.5 w-3.5" /> {t("bin.emptyAll")}
        </Button>
      }
    >
      {!info ? (
        <div className="text-sm text-muted">{t("bin.checking")}</div>
      ) : !full ? (
        <div className="text-sm text-muted">{t("bin.isEmpty")}</div>
      ) : (
        <div className="flex items-center gap-8">
          <div>
            <div className="tabular text-3xl font-bold text-amber-200">{formatBytes(info.bytes)}</div>
            <div className="mt-1 text-sm text-muted">
              {t("bin.stillUsing", { n: formatCount(info.items) })}
            </div>
          </div>
          <div className="ml-auto flex flex-wrap gap-2">
            {info.drives.map((d) => (
              <div key={d.drive} className="flex items-center gap-3 rounded-[16px] border border-white/[0.06] bg-white/[0.03] px-3 py-2">
                <div>
                  <div className="text-xs text-muted">{d.drive}</div>
                  <div className="tabular font-semibold">{formatBytes(d.bytes)}</div>
                </div>
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => empty(info, d.drive)} title={t("bin.emptyOn", { drive: d.drive })}>
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
