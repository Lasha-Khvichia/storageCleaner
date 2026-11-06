import type { SafetyLevel } from "../api";
import { currentLang, locale, t } from "../i18n";

/** Binary units, matching Windows Explorer and the Rust core. */
export function formatBytes(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  if (bytes < 1024) return `${bytes} B`;
  let v = bytes;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  const digits = v >= 100 ? 0 : v >= 10 ? 1 : 2;
  return `${v.toFixed(digits)} ${units[u]}`;
}

export function formatCount(n: number): string {
  return n.toLocaleString(locale());
}

export function formatPercent(share: number, digits = 1): string {
  return `${(share * 100).toFixed(digits)}%`;
}

// WebView2 (Chromium) ships without Georgian locale data, so Intl silently
// falls back to English. Format Georgian dates ourselves (24-hour clock).
const KA_MONTHS = ["იან", "თებ", "მარ", "აპრ", "მაი", "ივნ", "ივლ", "აგვ", "სექ", "ოქტ", "ნოე", "დეკ"];
const pad = (n: number) => String(n).padStart(2, "0");
function kaDate(d: Date): string {
  return `${d.getDate()} ${KA_MONTHS[d.getMonth()]}. ${d.getFullYear()}`;
}

export function formatDate(unix: number): string {
  if (!unix) return "—";
  if (currentLang() === "ka") return kaDate(new Date(unix * 1000));
  return new Date(unix * 1000).toLocaleDateString(locale(), {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function formatDateTime(unix: number): string {
  if (!unix) return "—";
  if (currentLang() === "ka") {
    const d = new Date(unix * 1000);
    return `${kaDate(d)}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  return new Date(unix * 1000).toLocaleString(locale(), {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function timeAgo(unix: number): string {
  if (!unix) return t("time.never");
  const s = Math.max(0, Date.now() / 1000 - unix);
  if (s < 60) return t("time.justNow");
  if (s < 3600) return t("time.minutesAgo", { n: Math.floor(s / 60) });
  if (s < 86400) return t("time.hoursAgo", { n: Math.floor(s / 3600) });
  if (s < 86400 * 30) return t("time.daysAgo", { n: Math.floor(s / 86400) });
  if (s < 86400 * 365) return t("time.monthsAgo", { n: Math.floor(s / (86400 * 30)) });
  return t("time.yearsAgo", { n: Math.floor(s / (86400 * 365)) });
}

/** Age in days, e.g. "today", "3d ago", "8mo ago". */
export function formatAgeDays(days: number): string {
  if (days <= 0) return t("time.today");
  if (days < 14) return t("time.daysAgo", { n: days });
  if (days < 60) return t("time.weeksAgo", { n: Math.floor(days / 7) });
  if (days < 730) return t("time.monthsAgo", { n: Math.floor(days / 30) });
  return t("time.yearsAgo", { n: Math.floor(days / 365) });
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return t("duration.ms", { n: ms });
  const s = ms / 1000;
  if (s < 60) return t("duration.s", { n: s.toFixed(1) });
  return t("duration.ms2", { m: Math.floor(s / 60), s: Math.round(s % 60) });
}

export const SAFETY: Record<
  SafetyLevel,
  { readonly label: string; color: string; text: string; bg: string; border: string; dot: string }
> = {
  safe: {
    get label() {
      return t("safety.safe");
    },
    color: "#22c55e",
    text: "text-emerald-400",
    bg: "bg-emerald-500/10",
    border: "border-emerald-500/30",
    dot: "bg-emerald-400",
  },
  review: {
    get label() {
      return t("safety.review");
    },
    color: "#f59e0b",
    text: "text-amber-400",
    bg: "bg-amber-500/10",
    border: "border-amber-500/30",
    dot: "bg-amber-400",
  },
  unknown: {
    get label() {
      return t("safety.unknown");
    },
    color: "#7f6e62",
    text: "text-slate-400",
    bg: "bg-slate-500/10",
    border: "border-slate-500/30",
    dot: "bg-slate-400",
  },
  protected: {
    get label() {
      return t("safety.protected");
    },
    color: "#ef4444",
    text: "text-red-400",
    bg: "bg-red-500/10",
    border: "border-red-500/30",
    dot: "bg-red-400",
  },
};

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}
