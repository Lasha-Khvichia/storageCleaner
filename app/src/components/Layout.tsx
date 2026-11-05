import {
  AlertTriangle,
  CheckCircle2,
  Files,
  History,
  HardDrive,
  LayoutDashboard,
  Info,
  Settings,
  Sparkles,
  Target,
  Trash2,
  X,
  XCircle,
} from "lucide-react";
import type { ReactNode } from "react";
import { cx, formatBytes } from "../lib/format";
import { useStore, type Page } from "../store";
import { Button } from "./ui";
import { RecycleBinWidget } from "./RecycleBin";

const NAV: { page: Page; label: string; icon: ReactNode }[] = [
  { page: "dashboard", label: "Dashboard", icon: <LayoutDashboard className="h-4 w-4" /> },
  { page: "explorer", label: "Scan & Explore", icon: <HardDrive className="h-4 w-4" /> },
  { page: "recommended", label: "Recommended Cleanups", icon: <Target className="h-4 w-4" /> },
  { page: "suggestions", label: "Suggestions", icon: <Sparkles className="h-4 w-4" /> },
  { page: "files", label: "Files & Types", icon: <Files className="h-4 w-4" /> },
  { page: "history", label: "History", icon: <History className="h-4 w-4" /> },
  { page: "settings", label: "Settings", icon: <Settings className="h-4 w-4" /> },
];

export function Sidebar() {
  const page = useStore((s) => s.page);
  const setPage = useStore((s) => s.setPage);
  const scan = useStore((s) => s.scan);
  const permanent = useStore((s) => s.permanentDelete);

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-line bg-[#0d1220]">
      <div className="h-4" />
      <nav className="flex flex-1 flex-col gap-1 px-3">
        {NAV.map((n) => (
          <button
            key={n.page}
            onClick={() => setPage(n.page)}
            className={cx(
              "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
              page === n.page ? "bg-indigo-500/15 text-indigo-200" : "text-slate-400 hover:bg-white/5 hover:text-slate-200",
            )}
          >
            {n.icon}
            {n.label}
            {n.page === "explorer" && scan.running && (
              <span className="ml-auto h-2 w-2 animate-pulse rounded-full bg-cyan-400" />
            )}
          </button>
        ))}
      </nav>
      <RecycleBinWidget />
      <div className="m-3 rounded-xl border border-line bg-panel px-3 py-3 text-xs">
        <div className="mb-1 font-medium text-slate-300">Delete mode</div>
        {permanent ? (
          <div className="flex items-center gap-1.5 font-semibold text-red-400">
            <AlertTriangle className="h-3.5 w-3.5" /> Permanent
          </div>
        ) : (
          <div className="flex items-center gap-1.5 text-emerald-400">
            <Trash2 className="h-3.5 w-3.5" /> Recycle Bin (undoable)
          </div>
        )}
      </div>
    </aside>
  );
}

export function PermanentBanner() {
  const permanent = useStore((s) => s.permanentDelete);
  const setPage = useStore((s) => s.setPage);
  if (!permanent) return null;
  return (
    <div className="flex items-center gap-3 border-b border-red-500/50 bg-gradient-to-r from-red-700 to-red-600 px-6 py-2 text-sm text-white">
      <AlertTriangle className="h-4 w-4 shrink-0" />
      <span className="font-semibold">Permanent delete is ON.</span>
      <span className="text-red-100">Deleted files skip the Recycle Bin and cannot be recovered.</span>
      <button onClick={() => setPage("settings")} className="ml-auto rounded-md bg-white/15 px-2.5 py-1 text-xs font-medium hover:bg-white/25">
        Change
      </button>
    </div>
  );
}

export function SelectionTray() {
  const selection = useStore((s) => s.selection);
  const clear = useStore((s) => s.clearSelection);
  const open = useStore((s) => s.setDeleteModalOpen);
  const permanent = useStore((s) => s.permanentDelete);
  if (selection.size === 0) return null;
  const items = [...selection.values()];
  const total = items.reduce((s, i) => s + i.size, 0);
  const risky = items.filter((i) => i.safety !== "safe").length;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-5 z-40 flex justify-center pl-60">
      <div
        className={cx(
          "pointer-events-auto flex items-center gap-5 rounded-2xl border px-5 py-3 shadow-2xl backdrop-blur",
          permanent ? "border-red-500/60 bg-red-950/90 shadow-red-900/40" : "border-line bg-panel/95 shadow-black/50",
        )}
      >
        <div>
          <div className="text-sm font-semibold">
            {items.length} item{items.length === 1 ? "" : "s"} selected
          </div>
          <div className="text-xs text-muted">
            <span className="tabular font-medium text-slate-200">{formatBytes(total)}</span>
            {risky > 0 && <span className="ml-2 text-amber-400">· {risky} need review</span>}
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={clear}>
          <X className="h-3.5 w-3.5" /> Clear
        </Button>
        <Button variant={permanent ? "danger" : "primary"} onClick={() => open(true)}>
          <Trash2 className="h-4 w-4" />
          {permanent ? "Review & delete permanently" : "Review & delete"}
        </Button>
      </div>
    </div>
  );
}

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  const dismiss = useStore((s) => s.dismissToast);
  return (
    <div className="fixed right-5 top-5 z-[60] flex w-96 flex-col gap-3">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={cx(
            "flex gap-3 rounded-xl border bg-panel p-4 shadow-2xl shadow-black/40",
            t.kind === "success" && "border-emerald-500/40",
            t.kind === "error" && "border-red-500/50",
            t.kind === "info" && "border-line",
          )}
        >
          {t.kind === "success" && <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-400" />}
          {t.kind === "error" && <XCircle className="h-5 w-5 shrink-0 text-red-400" />}
          {t.kind === "info" && <Info className="h-5 w-5 shrink-0 text-indigo-300" />}
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold">{t.title}</div>
            {t.body && <div className="mt-1 whitespace-pre-line break-words text-xs text-muted">{t.body}</div>}
          </div>
          <button onClick={() => dismiss(t.id)} className="self-start text-slate-500 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>
      ))}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
