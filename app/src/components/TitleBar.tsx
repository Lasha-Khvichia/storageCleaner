import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { AlertTriangle, Minus, Square, X } from "lucide-react";
import { RecycleBinPill } from "./RecycleBin";
import { api, type DiskInfo } from "../api";
import { cx, formatBytes } from "../lib/format";
import { useStore, type Page } from "../store";

const PAGE_TITLES: Record<Page, string> = {
  dashboard: "Dashboard",
  explorer: "Scan & Explore",
  recommended: "Recommended Cleanups",
  suggestions: "Suggestions",
  files: "Files & Types",
  history: "History",
  settings: "Settings",
};

/** The system drive (C:\ on Windows), refreshed every minute and after cleanups. */
function useSystemDrive(): DiskInfo | null {
  const dataVersion = useStore((s) => s.dataVersion);
  const [disk, setDisk] = useState<DiskInfo | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () =>
      api
        .getDisks()
        .then((d) => alive && setDisk(d.find((x) => /^c:\\?$/i.test(x.mount)) ?? d[0] ?? null))
        .catch(() => {});
    load();
    const t = window.setInterval(load, 60_000);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, [dataVersion]);
  return disk;
}

/**
 * Custom window title bar (the native one is disabled in tauri.conf.json).
 * The whole bar is a drag region; double-click toggles maximize.
 */
export function TitleBar() {
  const page = useStore((s) => s.page);
  const scan = useStore((s) => s.scan);
  const permanent = useStore((s) => s.permanentDelete);
  const disk = useSystemDrive();
  const [maximized, setMaximized] = useState(false);
  const win = getCurrentWindow();

  useEffect(() => {
    win.isMaximized().then(setMaximized).catch(() => {});
    const un = win.onResized(() => win.isMaximized().then(setMaximized).catch(() => {}));
    return () => {
      un.then((f) => f());
    };
  }, [win]);

  const freeShare = disk ? disk.freeBytes / disk.totalBytes : 1;
  const tone = freeShare < 0.05 ? "red" : freeShare < 0.15 ? "amber" : "emerald";
  const progress =
    scan.running && scan.progress && scan.targetUsedBytes
      ? Math.min(0.99, scan.progress.bytes / scan.targetUsedBytes)
      : null;

  return (
    <header
      data-tauri-drag-region
      className="relative flex h-12 shrink-0 select-none items-center gap-2.5 pl-5"
    >
      {/* Brand (the logo lives at the top of the rail) */}
      <div data-tauri-drag-region className="flex items-center gap-2.5 pl-2">
        {scan.running && <span className="h-2 w-2 animate-ping rounded-full bg-mint" />}
        <span data-tauri-drag-region className="text-[13px] font-bold tracking-tight">
          storage<span className="bg-gradient-to-r from-indigo-300 to-indigo-500 bg-clip-text text-transparent">Cleaner</span>
        </span>
        <span data-tauri-drag-region className="text-slate-600">/</span>
        <span data-tauri-drag-region className="text-[13px] text-muted">
          {PAGE_TITLES[page]}
        </span>
      </div>

      <div data-tauri-drag-region className="flex-1" />

      {/* Live status chips */}
      <RecycleBinPill />
      {permanent && (
        <span className="flex h-8 items-center gap-1.5 rounded-full border border-red-500/50 bg-red-500/15 px-3 text-[11px] font-semibold text-red-300">
          <AlertTriangle className="h-3 w-3" /> Permanent delete ON
        </span>
      )}
      {scan.running && (
        <span className="tabular flex h-8 items-center rounded-full border border-cyan-500/40 bg-cyan-500/10 px-3 text-[11px] font-medium text-cyan-200">
          Scanning{progress !== null ? ` ${Math.round(progress * 100)}%` : "…"}
        </span>
      )}
      {disk && (
        <span
          title={`${disk.mount} ${formatBytes(disk.freeBytes)} free of ${formatBytes(disk.totalBytes)}`}
          className={cx(
            "tabular flex h-8 items-center gap-2 rounded-full border px-3 text-[11px] font-medium",
            tone === "red" && "border-red-500/40 bg-red-500/10 text-red-300",
            tone === "amber" && "border-amber-500/40 bg-amber-500/10 text-amber-200",
            tone === "emerald" && "border-emerald-500/30 bg-emerald-500/10 text-emerald-200",
          )}
        >
          <span className="relative h-1.5 w-12 overflow-hidden rounded-full bg-white/10">
            <span
              className={cx(
                "absolute inset-y-0 left-0 rounded-full",
                tone === "red" ? "bg-red-400" : tone === "amber" ? "bg-amber-400" : "bg-emerald-400",
              )}
              style={{ width: `${Math.max(3, (1 - freeShare) * 100)}%` }}
            />
          </span>
          {disk.mount.replace(/\\$/, "")} {formatBytes(disk.freeBytes)} free
        </span>
      )}

      {/* Window controls */}
      <div className="ml-2 flex h-full items-stretch">
        <WinButton label="Minimize" onClick={() => win.minimize()}>
          <Minus className="h-3.5 w-3.5" />
        </WinButton>
        <WinButton label={maximized ? "Restore" : "Maximize"} onClick={() => win.toggleMaximize()}>
          {maximized ? <RestoreIcon /> : <Square className="h-3 w-3" />}
        </WinButton>
        <WinButton label="Close" danger onClick={() => win.close()}>
          <X className="h-4 w-4" />
        </WinButton>
      </div>

      {/* Scan progress glow along the bottom edge */}
      {scan.running && (
        <div className="pointer-events-none absolute inset-x-0 -bottom-px h-[2px] overflow-hidden">
          {progress !== null ? (
            <div
              className="h-full bg-gradient-to-r from-indigo-500 via-cyan-400 to-indigo-500 shadow-[0_0_12px_rgba(34,211,238,.8)] transition-[width] duration-300"
              style={{ width: `${progress * 100}%` }}
            />
          ) : (
            <div className="titlebar-sweep h-full w-1/3 bg-gradient-to-r from-transparent via-cyan-400 to-transparent" />
          )}
        </div>
      )}
    </header>
  );
}

function WinButton({
  label,
  danger,
  onClick,
  children,
}: {
  label: string;
  danger?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cx(
        "group flex w-12 items-center justify-center text-slate-400 transition-colors first:ml-1",
        danger ? "hover:bg-red-500 hover:text-white" : "hover:bg-white/[0.07] hover:text-slate-100",
      )}
    >
      <span className="transition-transform group-active:scale-90">{children}</span>
    </button>
  );
}

function RestoreIcon() {
  return (
    <svg viewBox="0 0 12 12" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.2">
      <rect x="1.5" y="3.5" width="7" height="7" rx="1" />
      <path d="M3.5 3.5V2.5a1 1 0 0 1 1-1h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-1" />
    </svg>
  );
}
