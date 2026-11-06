import { useMemo, useState } from "react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import {
  ChevronDown,
  ChevronRight,
  Clock,
  FolderOpen,
  HelpCircle,
  ScanSearch,
  Target,
  Wand2,
} from "lucide-react";
import { api, type CleanupPlan, type Recommendation } from "../api";
import { PageHeader } from "../components/Layout";
import { Button, Card, Checkbox, Empty, SafetyBadge, Spinner, useAsync } from "../components/ui";
import { SAFETY, cx, formatBytes } from "../lib/format";
import { toSelected, useStore } from "../store";
import { trBackend, trPlan } from "../i18n/backend";
import { useT } from "../i18n/useT";
import { t, tn } from "../i18n";

type SortKey = "score" | "size" | "age";

/** Plan title/description in the active language (they come from the Rust core). */
const planText = (p: CleanupPlan) => trPlan(p.id, p.title, p.description);
const planTitle = (p?: CleanupPlan) => (p ? planText(p).title : "");

export function Recommended() {
  useT(); // re-render on language switch
  const info = useStore((s) => s.scan.info);
  const dataVersion = useStore((s) => s.dataVersion);
  const setPage = useStore((s) => s.setPage);
  const report = useAsync(
    () => (info ? api.getRecommendations() : Promise.resolve(null)),
    [info?.startedAt, dataVersion],
  );
  const [planFilter, setPlanFilter] = useState<string | null>(null);
  const [sort, setSort] = useState<SortKey>("score");

  const items = useMemo(() => {
    const all = report.data?.items ?? [];
    const filtered = planFilter ? all.filter((r) => r.plans.includes(planFilter)) : all;
    const sorted = [...filtered];
    if (sort === "size") sorted.sort((a, b) => b.node.size - a.node.size);
    if (sort === "age") sorted.sort((a, b) => b.ageDays - a.ageDays);
    return sorted;
  }, [report.data, planFilter, sort]);

  if (!info) {
    return (
      <div>
        <PageHeader title={t("page.recommended")} />
        <Empty icon={<Target className="h-6 w-6" />} title={t("common.scanFirst")}>
          {t("rec.emptyBody")}
          <div className="mt-4">
            <Button variant="primary" onClick={() => setPage("explorer")}>
              <ScanSearch className="h-4 w-4" /> {t("common.startScan")}
            </Button>
          </div>
        </Empty>
      </div>
    );
  }

  if (report.loading && !report.data) return <Spinner label={t("rec.ranking")} />;
  if (report.error) return <Empty icon={<Target className="h-6 w-6" />} title={t("rec.error")}>{trBackend(report.error)}</Empty>;

  const data = report.data;
  if (!data || data.items.length === 0) {
    return (
      <div>
        <PageHeader title={t("page.recommended")} subtitle={info.root.path} />
        <Empty icon={<Target className="h-6 w-6" />} title={t("rec.nothing")}>
          {t("rec.nothingBody")}
        </Empty>
      </div>
    );
  }

  const recommended = data.plans.find((p) => p.id === "recommended");
  const maxSize = Math.max(...items.map((i) => i.node.size), 1);

  return (
    <div>
      <PageHeader
        title={t("page.recommended")}
        subtitle={t("rec.subtitle", { path: data.root })}
      />

      {recommended && <Hero plan={recommended} items={data.items} />}

      <div className="mb-6 grid grid-cols-2 gap-3 xl:grid-cols-4">
        {data.plans
          .filter((p) => p.id !== "recommended")
          .map((p) => (
            <PlanCard
              key={p.id}
              plan={p}
              items={data.items}
              active={planFilter === p.id}
              onShow={() => setPlanFilter((f) => (f === p.id ? null : p.id))}
            />
          ))}
      </div>

      <HowItWorks />

      <Card
        bodyClassName="p-0"
        title={
          <span>
            {planFilter ? planTitle(data.plans.find((p) => p.id === planFilter)) : t("rec.all")}
            <span className="ml-2 font-normal text-muted">({items.length})</span>
          </span>
        }
        icon={<Wand2 className="h-4 w-4 text-indigo-300" />}
        actions={
          <div className="flex items-center gap-2">
            {planFilter && (
              <Button size="sm" variant="ghost" onClick={() => setPlanFilter(null)}>
                {t("common.showAll")}
              </Button>
            )}
            <div className="flex overflow-hidden rounded-lg border border-line text-xs">
              {(["score", "size", "age"] as SortKey[]).map((k) => (
                <button
                  key={k}
                  onClick={() => setSort(k)}
                  className={cx("px-3 py-1.5", sort === k ? "bg-indigo-500/20 text-indigo-200" : "text-muted hover:bg-white/5")}
                >
                  {t(k === "age" ? "rec.sort.age" : k === "size" ? "rec.sort.size" : "rec.sort.score")}
                </button>
              ))}
            </div>
          </div>
        }
      >
        <div className="divide-y divide-line">
          {items.map((r) => (
            <Row key={r.node.id} rec={r} maxSize={maxSize} />
          ))}
        </div>
      </Card>
    </div>
  );
}

function useSelectPlan(plan: CleanupPlan, all: Recommendation[]) {
  const selection = useStore((s) => s.selection);
  const selectMany = useStore((s) => s.selectMany);
  const selected = plan.itemIds.filter((id) => selection.has(id)).length;
  const select = (on: boolean) => {
    const ids = new Set(plan.itemIds);
    const recs = all.filter((r) => ids.has(r.node.id));
    selectMany(recs.map((r) => toSelected(r.node)), on);
  };
  return { selected, all: selected === plan.itemIds.length, select };
}

function Hero({ plan, items }: { plan: CleanupPlan; items: Recommendation[] }) {
  const { selected, all, select } = useSelectPlan(plan, items);
  const s = SAFETY[plan.risk];
  return (
    <div className="mb-5 flex items-center gap-6 rounded-card border border-indigo-500/30 bg-gradient-to-r from-indigo-500/15 via-cyan-500/10 to-transparent p-6">
      <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-card bg-gradient-to-br from-indigo-500 to-cyan-400 shadow-lg shadow-indigo-500/30">
        <Target className="h-7 w-7 text-white" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-xs font-medium uppercase tracking-wider text-indigo-200/80">{t("rec.planLabel")}</div>
        <div className="tabular mt-0.5 text-3xl font-bold">
          {t("rec.free", { size: formatBytes(plan.bytes) })}
          <span className="ml-3 text-base font-medium text-muted">{t("rec.inItems", { n: plan.count })}</span>
        </div>
        <div className="mt-1 text-sm text-slate-300/80">{planText(plan).description}</div>
      </div>
      <div className="flex flex-col items-end gap-2">
        <span className={cx("rounded-full border px-2.5 py-0.5 text-xs", s.border, s.bg, s.text)}>
          {t("rec.highestRisk", { level: s.label })}
        </span>
        <Button variant={all ? "secondary" : "primary"} size="lg" onClick={() => select(!all)}>
          {all ? t("rec.unselectPlan") : selected > 0 ? t("rec.selectAllCount", { selected, total: plan.count }) : t("rec.selectPlan")}
        </Button>
      </div>
    </div>
  );
}

function PlanCard({
  plan,
  items,
  active,
  onShow,
}: {
  plan: CleanupPlan;
  items: Recommendation[];
  active: boolean;
  onShow: () => void;
}) {
  const { all, select } = useSelectPlan(plan, items);
  const s = SAFETY[plan.risk];
  return (
    <div
      className={cx(
        "flex flex-col rounded-card border bg-panel p-4 transition-colors",
        active ? "border-indigo-400/60 ring-1 ring-indigo-400/40" : "border-line",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="font-semibold">{planText(plan).title}</div>
        <span className={cx("h-2.5 w-2.5 shrink-0 rounded-full mt-1.5", s.dot)} title={t("rec.highestRisk", { level: s.label })} />
      </div>
      <div className="tabular mt-1 text-2xl font-bold">{formatBytes(plan.bytes)}</div>
      <div className="text-xs text-muted">{tn("common.items", plan.count)}</div>
      <p className="mt-2 flex-1 text-xs leading-relaxed text-slate-400">{planText(plan).description}</p>
      <div className="mt-3 flex gap-2">
        <Button size="sm" variant={active ? "primary" : "secondary"} onClick={onShow} className="flex-1">
          {active ? t("common.showing") : t("common.show")}
        </Button>
        <Button size="sm" variant="secondary" onClick={() => select(!all)} className="flex-1">
          {all ? t("common.unselect") : t("common.select")}
        </Button>
      </div>
    </div>
  );
}

function scoreColor(score: number): string {
  if (score >= 75) return "var(--sc-positive-300)";
  if (score >= 55) return "var(--sc-accent-300)";
  if (score >= 40) return "var(--sc-accent-500)";
  return "var(--sc-neutral-500)";
}

function ScoreRing({ score }: { score: number }) {
  const r = 17;
  const c = 2 * Math.PI * r;
  const color = scoreColor(score);
  return (
    <div className="relative h-11 w-11 shrink-0" title={t("rec.score", { n: score })}>
      <svg viewBox="0 0 44 44" className="h-11 w-11 -rotate-90">
        <circle cx="22" cy="22" r={r} fill="none" style={{ stroke: "var(--sc-surface-raised)" }} strokeWidth="4" />
        <circle
          cx="22"
          cy="22"
          r={r}
          fill="none"
          style={{ stroke: color }}
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={`${(score / 100) * c} ${c}`}
        />
      </svg>
      <div className="tabular absolute inset-0 flex items-center justify-center text-[13px] font-bold" style={{ color }}>
        {score}
      </div>
    </div>
  );
}

function formatAge(days: number): string {
  if (days <= 0) return t("time.today");
  if (days < 14) return t("time.daysAgo", { n: days });
  if (days < 60) return t("time.weeksAgo", { n: Math.floor(days / 7) });
  if (days < 730) return t("time.monthsAgo", { n: Math.floor(days / 30) });
  return t("time.yearsAgo", { n: Math.floor(days / 365) });
}

function Row({ rec, maxSize }: { rec: Recommendation; maxSize: number }) {
  const selection = useStore((s) => s.selection);
  const toggleSelect = useStore((s) => s.toggleSelect);
  const n = rec.node;
  const checked = selection.has(n.id);
  const [main, ...extra] = rec.reasons.slice(1).map((r) => trBackend(r));
  return (
    <div
      className={cx("flex items-center gap-4 px-5 py-3 transition-colors hover:bg-white/[0.02]", checked && "bg-indigo-500/[0.06]")}
    >
      <Checkbox checked={checked} onChange={() => toggleSelect(toSelected(n))} />
      <ScoreRing score={rec.score} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium">{n.name}</span>
          <SafetyBadge level={n.safety} reason={n.reason} compact />
          {rec.confidence < 0.5 && (
            <span className="rounded-full bg-slate-500/15 px-2 py-0.5 text-[10px] text-slate-300">{t("rec.checkFirst")}</span>
          )}
        </div>
        <div className="truncate text-xs text-muted" title={n.path}>
          {n.path}
        </div>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {main && <span className="text-xs text-slate-300">{main}</span>}
          {extra.map((e) => (
            <span key={e} className="rounded-full bg-white/5 px-2 py-0.5 text-[11px] text-slate-400">
              {e}
            </span>
          ))}
        </div>
      </div>
      <div className="w-28 shrink-0 text-right">
        <div className="tabular font-semibold">{formatBytes(n.size)}</div>
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/5">
          <div className="h-full rounded-full bg-indigo-400/70" style={{ width: `${Math.max(2, (n.size / maxSize) * 100)}%` }} />
        </div>
        <div className="mt-1 flex items-center justify-end gap-1 text-[11px] text-muted">
          <Clock className="h-3 w-3" /> {formatAge(rec.ageDays)}
        </div>
      </div>
      <button
        className="rounded-lg p-2 text-muted hover:bg-white/5 hover:text-slate-200"
        title={t("common.showInExplorer")}
        onClick={() => revealItemInDir(n.path).catch(() => {})}
      >
        <FolderOpen className="h-4 w-4" />
      </button>
    </div>
  );
}

function HowItWorks() {
  const [open, setOpen] = useState(false);
  return (
    <div className="glass mb-5 rounded-card">
      <button className="flex w-full items-center gap-2 px-5 py-3 text-left text-sm text-slate-300" onClick={() => setOpen((o) => !o)}>
        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        <HelpCircle className="h-4 w-4 text-muted" />
        {t("rec.howTitle")}
      </button>
      {open && (
        <div className="grid grid-cols-3 gap-4 border-t border-line px-5 py-4 text-sm">
          <Factor weight="50%" title={t("rec.factor.space")} color="text-cyan-300">
            {t("rec.factor.spaceBody")}
          </Factor>
          <Factor weight="35%" title={t("rec.factor.confidence")} color="text-indigo-300">
            {t("rec.factor.confidenceBody")}
          </Factor>
          <Factor weight="15%" title={t("rec.factor.stale")} color="text-violet-300">
            {t("rec.factor.staleBody")}
          </Factor>
          <div className="col-span-3 text-xs text-muted">
            {t("rec.footnote")}
          </div>
        </div>
      )}
    </div>
  );
}

function Factor({ weight, title, color, children }: { weight: string; title: string; color: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-baseline gap-2">
        <span className={cx("tabular text-xl font-bold", color)}>{weight}</span>
        <span className="font-medium">{title}</span>
      </div>
      <p className="mt-1 text-xs leading-relaxed text-slate-400">{children}</p>
    </div>
  );
}
