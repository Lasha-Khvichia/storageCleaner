import { useState } from "react";
import { AlertTriangle, Check, Languages, Lock, Palette, ShieldCheck, Trash2 } from "lucide-react";
import { LANGUAGES } from "../i18n";
import { useT } from "../i18n/useT";
import { cx } from "../lib/format";
import { THEMES } from "../lib/theme";
import { PageHeader } from "../components/Layout";
import { Button, Card, Modal, SafetyBadge, Toggle } from "../components/ui";
import { useStore } from "../store";

export function Settings() {
  const { t } = useT();
  const permanent = useStore((s) => s.permanentDelete);
  const setPermanent = useStore((s) => s.setPermanentDelete);
  const pushToast = useStore((s) => s.pushToast);
  const [warnOpen, setWarnOpen] = useState(false);
  const [ack1, setAck1] = useState(false);
  const [ack2, setAck2] = useState(false);

  const request = (on: boolean) => {
    if (!on) {
      setPermanent(false);
      pushToast({ kind: "success", title: t("set.permOffToast"), body: t("set.permOffBody") });
      return;
    }
    setAck1(false);
    setAck2(false);
    setWarnOpen(true);
  };

  return (
    <div className="max-w-3xl">
      <PageHeader title={t("page.settings")} />

      <LanguagePicker />
      <ThemePicker />

      <Card title={t("set.deleting")} icon={<Trash2 className="h-4 w-4 text-indigo-300" />} className="mb-5">
        <div className="flex items-start gap-4">
          <div className="flex-1">
            <div className="flex items-center gap-2 font-semibold">
              {t("set.permanent")}
              {permanent && (
                <span className="rounded-full bg-red-600 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">{t("common.on")}</span>
              )}
            </div>
            <p className="mt-1 text-sm text-muted">
              {t("set.permanentBody")}
            </p>
          </div>
          <Toggle checked={permanent} onChange={request} danger />
        </div>
        {permanent && (
          <div className="mt-4 flex items-center gap-2 rounded-card border border-red-500/50 bg-red-950/40 px-4 py-3 text-sm text-red-200">
            <AlertTriangle className="h-4 w-4 shrink-0 text-red-400" />
            {t("set.permanentActive")}
          </div>
        )}
      </Card>

      <Card title={t("set.howSafety")} icon={<ShieldCheck className="h-4 w-4 text-indigo-300" />}>
        <div className="space-y-3 text-sm">
          <Row level="safe" text={t("set.row.safe")} />
          <Row level="review" text={t("set.row.review")} />
          <Row level="unknown" text={t("set.row.unknown")} />
          <Row level="protected" text={t("set.row.protected")} />
          <p className="flex items-start gap-2 pt-2 text-xs text-muted">
            <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {t("set.coreNote")}
          </p>
        </div>
      </Card>

      <Modal
        open={warnOpen}
        onClose={() => setWarnOpen(false)}
        danger
        title={
          <span className="flex items-center gap-2 text-red-300">
            <AlertTriangle className="h-5 w-5" /> {t("set.turnOnTitle")}
          </span>
        }
        footer={
          <>
            <Button variant="ghost" onClick={() => setWarnOpen(false)}>
              {t("set.keepBin")}
            </Button>
            <Button
              variant="danger"
              disabled={!ack1 || !ack2}
              onClick={() => {
                setPermanent(true);
                setWarnOpen(false);
                pushToast({ kind: "info", title: t("set.onToast"), body: t("set.onToastBody") });
              }}
            >
              {t("set.turnOn")}
            </Button>
          </>
        }
      >
        <div className="space-y-4 text-sm">
          <div className="rounded-xl border-2 border-red-500 bg-red-950/60 p-4 text-red-200">
            {t("set.warnBox")}
          </div>
          <label className="flex cursor-pointer items-start gap-3">
            <input type="checkbox" checked={ack1} onChange={(e) => setAck1(e.target.checked)} className="mt-0.5 h-4 w-4 accent-red-500" />
            {t("set.ack1")}
          </label>
          <label className="flex cursor-pointer items-start gap-3">
            <input type="checkbox" checked={ack2} onChange={(e) => setAck2(e.target.checked)} className="mt-0.5 h-4 w-4 accent-red-500" />
            {t("set.ack2")}
          </label>
        </div>
      </Modal>
    </div>
  );
}

function Row({ level, text }: { level: "safe" | "review" | "unknown" | "protected"; text: string }) {
  return (
    <div className="flex items-start gap-3">
      <div className="w-44 shrink-0">
        <SafetyBadge level={level} />
      </div>
      <p className="text-slate-300">{text}</p>
    </div>
  );
}

/** Appearance: every theme is a set of design tokens (see index.css). */
function ThemePicker() {
  const { t } = useT();
  const theme = useStore((s) => s.theme);
  const setTheme = useStore((s) => s.setTheme);
  return (
    <Card title={t("set.appearance")} icon={<Palette className="h-4 w-4 text-indigo-300" />} className="mb-5">
      <div className="grid grid-cols-3 gap-3">
        {THEMES.map((th) => {
          const active = th.id === theme;
          const [bg, surface, accent, positive] = th.swatches;
          return (
            <button
              key={th.id}
              onClick={() => setTheme(th.id)}
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
                <span className="font-semibold">{th.name}</span>
                {active && <Check className="h-4 w-4 text-indigo-300" />}
              </div>
              <p className="px-1 pb-1 text-xs text-muted">{th.description}</p>
            </button>
          );
        })}
      </div>
    </Card>
  );
}

/** Language: English / Georgian (see src/i18n). */
function LanguagePicker() {
  const { t, lang } = useT();
  const setLang = useStore((s) => s.setLang);
  return (
    <Card title={t("set.language")} icon={<Languages className="h-4 w-4 text-indigo-300" />} className="mb-5">
      <p className="mb-4 text-sm text-muted">{t("set.languageBody")}</p>
      <div className="grid grid-cols-2 gap-3">
        {LANGUAGES.map((l) => {
          const active = l.id === lang;
          return (
            <button
              key={l.id}
              onClick={() => setLang(l.id)}
              className={cx(
                "flex items-center gap-4 rounded-card border px-5 py-4 text-left transition-all",
                active ? "border-indigo-400/70 bg-indigo-500/10 ring-2 ring-indigo-500/40" : "border-white/[0.08] hover:border-white/20",
              )}
            >
              <span
                className={cx(
                  "flex h-11 w-11 shrink-0 items-center justify-center rounded-control text-sm font-bold",
                  active ? "btn-primary text-white" : "bg-white/[0.06] text-slate-300",
                )}
              >
                {l.short}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-base font-semibold">{l.native}</span>
                <span className="block text-xs text-muted">{l.name}</span>
              </span>
              {active && <Check className="h-5 w-5 text-indigo-300" />}
            </button>
          );
        })}
      </div>
    </Card>
  );
}
