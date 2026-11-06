import { useState } from "react";
import { AlertTriangle, Check, Lock, Palette, ShieldCheck, Trash2 } from "lucide-react";
import { cx } from "../lib/format";
import { THEMES } from "../lib/theme";
import { PageHeader } from "../components/Layout";
import { Button, Card, Modal, SafetyBadge, Toggle } from "../components/ui";
import { useStore } from "../store";

export function Settings() {
  const permanent = useStore((s) => s.permanentDelete);
  const setPermanent = useStore((s) => s.setPermanentDelete);
  const pushToast = useStore((s) => s.pushToast);
  const [warnOpen, setWarnOpen] = useState(false);
  const [ack1, setAck1] = useState(false);
  const [ack2, setAck2] = useState(false);

  const request = (on: boolean) => {
    if (!on) {
      setPermanent(false);
      pushToast({ kind: "success", title: "Permanent delete turned off", body: "Deleted items go to the Recycle Bin again." });
      return;
    }
    setAck1(false);
    setAck2(false);
    setWarnOpen(true);
  };

  return (
    <div className="max-w-3xl">
      <PageHeader title="Settings" />

      <ThemePicker />

      <Card title="Deleting" icon={<Trash2 className="h-4 w-4 text-indigo-300" />} className="mb-5">
        <div className="flex items-start gap-4">
          <div className="flex-1">
            <div className="flex items-center gap-2 font-semibold">
              Permanent delete
              {permanent && (
                <span className="rounded-full bg-red-600 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">On</span>
              )}
            </div>
            <p className="mt-1 text-sm text-muted">
              When off (recommended), everything you delete goes to the Recycle Bin and can be restored from History. When on,
              files are erased immediately and cannot be recovered.
            </p>
          </div>
          <Toggle checked={permanent} onChange={request} danger />
        </div>
        {permanent && (
          <div className="mt-4 flex items-center gap-2 rounded-card border border-red-500/50 bg-red-950/40 px-4 py-3 text-sm text-red-200">
            <AlertTriangle className="h-4 w-4 shrink-0 text-red-400" />
            Permanent delete is active. Every delete will ask you to type a confirmation phrase.
          </div>
        )}
      </Card>

      <Card title="How safety ratings work" icon={<ShieldCheck className="h-4 w-4 text-indigo-300" />}>
        <div className="space-y-3 text-sm">
          <Row level="safe" text="Caches, temp files, crash dumps, build output. Rebuilt automatically or never needed again." />
          <Row level="review" text="Probably removable but it's your data: Downloads, installers, logs, old leftovers. Look first." />
          <Row level="unknown" text="No rule matched. Could be anything — only delete if you know what it is." />
          <Row level="protected" text="Windows, installed programs, profile folders, system files. Always blocked." />
          <p className="flex items-start gap-2 pt-2 text-xs text-muted">
            <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Safety checks run in the Rust core and are re-checked right before each deletion, so the UI cannot bypass them.
            Links and junctions are never followed.
          </p>
        </div>
      </Card>

      <Modal
        open={warnOpen}
        onClose={() => setWarnOpen(false)}
        danger
        title={
          <span className="flex items-center gap-2 text-red-300">
            <AlertTriangle className="h-5 w-5" /> Turn on permanent delete?
          </span>
        }
        footer={
          <>
            <Button variant="ghost" onClick={() => setWarnOpen(false)}>
              Keep Recycle Bin (safer)
            </Button>
            <Button
              variant="danger"
              disabled={!ack1 || !ack2}
              onClick={() => {
                setPermanent(true);
                setWarnOpen(false);
                pushToast({ kind: "info", title: "Permanent delete is ON", body: "Be careful — deletions can no longer be undone." });
              }}
            >
              Turn on permanent delete
            </Button>
          </>
        }
      >
        <div className="space-y-4 text-sm">
          <div className="rounded-xl border-2 border-red-500 bg-red-950/60 p-4 text-red-200">
            Files deleted while this is on <b>skip the Recycle Bin</b>. They cannot be restored from History, Windows or this app.
          </div>
          <label className="flex cursor-pointer items-start gap-3">
            <input type="checkbox" checked={ack1} onChange={(e) => setAck1(e.target.checked)} className="mt-0.5 h-4 w-4 accent-red-500" />
            I understand deleted files will be gone forever.
          </label>
          <label className="flex cursor-pointer items-start gap-3">
            <input type="checkbox" checked={ack2} onChange={(e) => setAck2(e.target.checked)} className="mt-0.5 h-4 w-4 accent-red-500" />
            I have a backup of anything important.
          </label>
        </div>
      </Modal>
    </div>
  );
}

function Row({ level, text }: { level: "safe" | "review" | "unknown" | "protected"; text: string }) {
  return (
    <div className="flex items-start gap-3">
      <div className="w-24 shrink-0">
        <SafetyBadge level={level} />
      </div>
      <p className="text-slate-300">{text}</p>
    </div>
  );
}

/** Appearance: every theme is a set of design tokens (see index.css). */
function ThemePicker() {
  const theme = useStore((s) => s.theme);
  const setTheme = useStore((s) => s.setTheme);
  return (
    <Card title="Appearance" icon={<Palette className="h-4 w-4 text-indigo-300" />} className="mb-5">
      <div className="grid grid-cols-3 gap-3">
        {THEMES.map((t) => {
          const active = t.id === theme;
          const [bg, surface, accent, positive] = t.swatches;
          return (
            <button
              key={t.id}
              onClick={() => setTheme(t.id)}
              className={cx(
                "rounded-card border p-2 text-left transition-all",
                active ? "border-indigo-400/70 ring-2 ring-indigo-500/40" : "border-white/[0.08] hover:border-white/20",
              )}
            >
              {/* Mini preview of the theme */}
              <div className="relative h-20 overflow-hidden rounded-[14px]" style={{ background: bg }}>
                <div className="absolute inset-y-2 left-2 w-5 rounded-lg" style={{ background: surface }}>
                  <div className="mx-auto mt-2 h-2.5 w-2.5 rounded" style={{ background: accent }} />
                </div>
                <div className="absolute left-9 right-2 top-2 h-7 rounded-lg" style={{ background: surface }}>
                  <div className="ml-2 mt-2.5 h-1.5 w-10 rounded-full" style={{ background: accent }} />
                </div>
                <div className="absolute bottom-2 left-9 right-2 flex h-8 items-end gap-1 rounded-lg px-2 pb-1.5" style={{ background: surface }}>
                  {[40, 65, 50, 90, 70].map((h, i) => (
                    <div key={i} className="flex-1 rounded-sm" style={{ height: `${h}%`, background: i === 3 ? positive : accent, opacity: i === 3 ? 1 : 0.55 }} />
                  ))}
                </div>
              </div>
              <div className="mt-2 flex items-center gap-2 px-1">
                <span className="font-semibold">{t.name}</span>
                {active && <Check className="h-4 w-4 text-indigo-300" />}
              </div>
              <p className="px-1 pb-1 text-xs text-muted">{t.description}</p>
            </button>
          );
        })}
      </div>
    </Card>
  );
}
