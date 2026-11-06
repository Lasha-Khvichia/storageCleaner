import {
  AlertTriangle,
  CheckCircle2,
  Files,
  History,
  HardDrive,
  LayoutDashboard,
  Info,
  Settings,
  ShieldCheck,
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
import { useT } from "../i18n/useT";
import type { MessageKey } from "../i18n";
import logo from "../assets/logo.png";

const NAV: { page: Page; label: MessageKey; icon: ReactNode }[] = [
  { page: "dashboard", label: "page.dashboard", icon: <LayoutDashboard className="h-[18px] w-[18px]" /> },
  { page: "explorer", label: "page.explorer", icon: <HardDrive className="h-[18px] w-[18px]" /> },
  { page: "recommended", label: "page.recommended", icon: <Target className="h-[18px] w-[18px]" /> },
  { page: "suggestions", label: "page.suggestions", icon: <Sparkles className="h-[18px] w-[18px]" /> },
  { page: "files", label: "page.files", icon: <Files className="h-[18px] w-[18px]" /> },
  { page: "history", label: "page.history", icon: <History className="h-[18px] w-[18px]" /> },
];

/** Slim floating icon rail with tooltips (labels appear on hover). */
export function Sidebar() {
  const { t } = useT();
  const page = useStore((s) => s.page);
  const setPage = useStore((s) => s.setPage);
  const scan = useStore((s) => s.scan);
  const permanent = useStore((s) => s.permanentDelete);

  return (
    <aside className="glass relative z-30 flex w-[72px] shrink-0 flex-col items-center rounded-panel py-4">
      <img src={logo} alt="storageCleaner" draggable={false} className="mb-5 h-10 w-10 drop-shadow-[0_6px_14px_rgba(255,122,47,.35)]" />
      <nav className="flex flex-1 flex-col items-center gap-2">
        {NAV.map((n) => (
          <RailButton
            key={n.page}
            label={t(n.label)}
            active={page === n.page}
            onClick={() => setPage(n.page)}
            badge={n.page === "explorer" && scan.running}
          >
            {n.icon}
          </RailButton>
        ))}
      </nav>
      <div className="flex flex-col items-center gap-2">
        <RailButton
          label={permanent ? t("rail.modePermanent") : t("rail.modeTrash")}
          onClick={() => setPage("settings")}
          tone={permanent ? "danger" : "safe"}
        >
          {permanent ? <AlertTriangle className="h-[18px] w-[18px]" /> : <ShieldCheck className="h-[18px] w-[18px]" />}
        </RailButton>
        <RailButton label={t("page.settings")} active={page === "settings"} onClick={() => setPage("settings")}>
          <Settings className="h-[18px] w-[18px]" />
        </RailButton>
      </div>
    </aside>
  );
}

function RailButton({
  label,
  active,
  onClick,
  badge,
  tone,
  children,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
  badge?: boolean;
  tone?: "danger" | "safe";
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className={cx(
        "group relative flex h-11 w-11 items-center justify-center rounded-control transition-all",
        active
          ? "btn-primary text-white"
          : tone === "danger"
            ? "bg-red-500/15 text-red-400 hover:bg-red-500/25"
            : tone === "safe"
              ? "text-emerald-400/80 hover:bg-white/[0.06] hover:text-emerald-300"
              : "text-slate-400 hover:bg-white/[0.06] hover:text-slate-100",
      )}
    >
      {children}
      {badge && <span className="absolute right-1.5 top-1.5 h-2 w-2 animate-pulse rounded-full bg-mint" />}
      {/* Tooltip */}
      <span className="pointer-events-none absolute left-full z-50 ml-3 whitespace-nowrap rounded-lg border border-white/[0.08] bg-overlay px-2.5 py-1.5 text-xs font-medium text-slate-100 opacity-0 shadow-xl shadow-black/50 transition-opacity group-hover:opacity-100">
        {label}
      </span>
    </button>
  );
}

export function PermanentBanner() {
  const { t } = useT();
  const permanent = useStore((s) => s.permanentDelete);
  const setPage = useStore((s) => s.setPage);
  if (!permanent) return null;
  return (
    <div className="mx-7 mb-1 flex items-center gap-3 rounded-full border border-red-500/50 bg-gradient-to-r from-red-700 to-red-600 px-5 py-2 text-sm text-white shadow-[0_8px_24px_-10px_rgba(239,68,68,.8)]">
      <AlertTriangle className="h-4 w-4 shrink-0" />
      <span className="shrink-0 font-semibold">{t("banner.permanentOn")}</span>
      <span className="truncate text-red-100">{t("banner.permanentBody")}</span>
      <button onClick={() => setPage("settings")} className="ml-auto shrink-0 rounded-md bg-white/15 px-2.5 py-1 text-xs font-medium hover:bg-white/25">
        {t("banner.change")}
      </button>
    </div>
  );
}

export function SelectionTray() {
  const { t, tn } = useT();
  const selection = useStore((s) => s.selection);
  const clear = useStore((s) => s.clearSelection);
  const open = useStore((s) => s.setDeleteModalOpen);
  const permanent = useStore((s) => s.permanentDelete);
  if (selection.size === 0) return null;
  const items = [...selection.values()];
  const total = items.reduce((s, i) => s + i.size, 0);
  const risky = items.filter((i) => i.safety !== "safe").length;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-40 flex justify-center pl-24">
      <div
        className={cx(
          "pointer-events-auto flex items-center gap-5 rounded-full border py-2.5 pl-6 pr-2.5 shadow-2xl backdrop-blur-xl",
          permanent ? "border-red-500/60 bg-red-950/90 shadow-red-900/40" : "border-white/[0.1] bg-overlay/95 shadow-black/60",
        )}
      >
        <div>
          <div className="text-sm font-semibold">
            {tn("tray.selected", items.length)}
          </div>
          <div className="text-xs text-muted">
            <span className="tabular font-medium text-slate-200">{formatBytes(total)}</span>
            {risky > 0 && <span className="ml-2 text-amber-400">{t("tray.needReview", { n: risky })}</span>}
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={clear}>
          <X className="h-3.5 w-3.5" /> {t("common.clear")}
        </Button>
        <Button variant={permanent ? "danger" : "primary"} onClick={() => open(true)}>
          <Trash2 className="h-4 w-4" />
          {permanent ? t("tray.reviewPermanent") : t("tray.review")}
        </Button>
      </div>
    </div>
  );
}

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  const dismiss = useStore((s) => s.dismissToast);
  return (
    <div className="fixed right-5 top-14 z-[60] flex w-96 flex-col gap-3">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={cx(
            "flex gap-3 rounded-[18px] border bg-overlay/95 p-4 shadow-2xl shadow-black/60 backdrop-blur-xl",
            t.kind === "success" && "border-emerald-500/40",
            t.kind === "error" && "border-red-500/50",
            t.kind === "info" && "border-white/[0.08]",
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
        <h1 className="text-[28px] font-bold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
