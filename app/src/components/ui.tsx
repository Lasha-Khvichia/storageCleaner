import { useEffect, useState, type ReactNode } from "react";
import { Loader2, Lock, X } from "lucide-react";
import type { SafetyLevel } from "../api";
import { SAFETY, cx } from "../lib/format";

export function Card({
  title,
  icon,
  actions,
  children,
  className,
  bodyClassName,
}: {
  title?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={cx("rounded-2xl border border-line bg-panel shadow-lg shadow-black/20", className)}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
          <h2 className="flex items-center gap-2 text-sm font-semibold tracking-wide text-slate-200">
            {icon}
            {title}
          </h2>
          <div className="flex items-center gap-2">{actions}</div>
        </header>
      )}
      <div className={cx("p-5", bodyClassName)}>{children}</div>
    </section>
  );
}

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "success";

export function Button({
  variant = "secondary",
  size = "md",
  className,
  children,
  loading,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: "sm" | "md" | "lg";
  loading?: boolean;
}) {
  const variants: Record<ButtonVariant, string> = {
    primary: "bg-accent text-white hover:bg-indigo-400 shadow shadow-indigo-500/20",
    secondary: "bg-panel-2 text-slate-200 border border-line hover:bg-[#1f2940]",
    ghost: "text-slate-300 hover:bg-white/5",
    danger: "bg-red-600 text-white hover:bg-red-500 shadow shadow-red-600/30",
    success: "bg-emerald-600 text-white hover:bg-emerald-500",
  };
  const sizes = { sm: "h-8 px-3 text-xs", md: "h-9 px-4 text-sm", lg: "h-11 px-5 text-sm" };
  return (
    <button
      {...rest}
      disabled={rest.disabled || loading}
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors",
        "disabled:cursor-not-allowed disabled:opacity-40",
        variants[variant],
        sizes[size],
        className,
      )}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" />}
      {children}
    </button>
  );
}

export function SafetyBadge({ level, reason, compact }: { level: SafetyLevel; reason?: string; compact?: boolean }) {
  const s = SAFETY[level];
  return (
    <span
      title={reason}
      className={cx(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border font-medium",
        compact ? "px-2 py-0.5 text-[10px]" : "px-2.5 py-0.5 text-xs",
        s.bg,
        s.border,
        s.text,
      )}
    >
      {level === "protected" ? <Lock className="h-3 w-3" /> : <span className={cx("h-1.5 w-1.5 rounded-full", s.dot)} />}
      {s.label}
    </span>
  );
}

export function Checkbox({
  checked,
  indeterminate,
  disabled,
  onChange,
  title,
}: {
  checked: boolean;
  indeterminate?: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
  title?: string;
}) {
  if (disabled) {
    return (
      <span title={title} className="inline-flex h-4 w-4 items-center justify-center text-red-400/70">
        <Lock className="h-3.5 w-3.5" />
      </span>
    );
  }
  return (
    <input
      type="checkbox"
      title={title}
      checked={checked}
      ref={(el) => {
        if (el) el.indeterminate = !!indeterminate && !checked;
      }}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => onChange(e.target.checked)}
      className="h-4 w-4 cursor-pointer rounded accent-indigo-500"
    />
  );
}

export function Toggle({
  checked,
  onChange,
  danger,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cx(
        "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors",
        checked ? (danger ? "bg-red-600" : "bg-accent") : "bg-slate-700",
      )}
    >
      <span
        className={cx(
          "inline-block h-5 w-5 rounded-full bg-white shadow transition-transform",
          checked ? "translate-x-5" : "translate-x-0.5",
        )}
      />
    </button>
  );
}

export function Meter({ share, color, className }: { share: number; color?: string; className?: string }) {
  const pct = Math.max(0, Math.min(1, share)) * 100;
  return (
    <div className={cx("h-1.5 w-full overflow-hidden rounded-full bg-slate-800", className)}>
      <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color ?? "#6d8bff" }} />
    </div>
  );
}

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  danger,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  danger?: boolean;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm" onMouseDown={onClose}>
      <div
        onMouseDown={(e) => e.stopPropagation()}
        className={cx(
          "flex max-h-[90vh] w-full flex-col rounded-2xl border bg-panel shadow-2xl",
          wide ? "max-w-4xl" : "max-w-lg",
          danger ? "border-red-500/60 shadow-red-900/40" : "border-line",
        )}
      >
        <header
          className={cx(
            "flex items-center justify-between gap-3 rounded-t-2xl border-b px-6 py-4",
            danger ? "border-red-500/40 bg-red-950/40" : "border-line",
          )}
        >
          <h3 className="flex items-center gap-2 text-base font-semibold">{title}</h3>
          <button onClick={onClose} className="rounded-md p-1 text-slate-400 hover:bg-white/5 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">{children}</div>
        {footer && <footer className="flex items-center justify-end gap-3 border-t border-line px-6 py-4">{footer}</footer>}
      </div>
    </div>
  );
}

export function Empty({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
      <div className="rounded-2xl bg-panel-2 p-4 text-slate-400">{icon}</div>
      <div className="text-base font-semibold text-slate-200">{title}</div>
      {children && <div className="max-w-md text-sm text-muted">{children}</div>}
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted">
      <Loader2 className="h-4 w-4 animate-spin" /> {label ?? "Loading…"}
    </div>
  );
}

export function Stat({ label, value, sub, accent }: { label: string; value: ReactNode; sub?: ReactNode; accent?: string }) {
  return (
    <div className="rounded-xl border border-line bg-panel-2/60 px-4 py-3">
      <div className="text-[11px] font-medium uppercase tracking-wider text-muted">{label}</div>
      <div className="tabular mt-1 text-xl font-semibold" style={accent ? { color: accent } : undefined}>
        {value}
      </div>
      {sub && <div className="mt-0.5 text-xs text-muted">{sub}</div>}
    </div>
  );
}

/** Small async-data hook: re-runs when deps change. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): { data: T | null; error: string | null; loading: boolean; reload: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    fn()
      .then((d) => {
        if (alive) {
          setData(d);
          setError(null);
        }
      })
      .catch((e) => {
        if (alive) setError(typeof e === "string" ? e : String(e?.message ?? e));
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { data, error, loading, reload: () => setTick((t) => t + 1) };
}
