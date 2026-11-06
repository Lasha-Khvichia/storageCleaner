import { useMemo, useState } from "react";
import { Activity, ArrowRight, Camera, HardDrive, RefreshCw, ScanSearch, Sparkles, Usb } from "lucide-react";
import { api, type DiskInfo, type SpaceSnapshot } from "../api";
import { Chart, useChartTheme } from "../components/Chart";
import { PageHeader } from "../components/Layout";
import { RecycleBinCard } from "../components/RecycleBin";
import { Button, Card, Empty, Spinner, Stat, useAsync } from "../components/ui";
import { cx, formatBytes, formatDateTime, formatPercent, timeAgo } from "../lib/format";
import { startScan } from "../lib/scan";
import { useStore } from "../store";
import { t, type MessageKey } from "../i18n";
import { useT } from "../i18n/useT";

const RANGES = [7, 30, 90, 365];

export function Dashboard() {
  const { t } = useT();
  const dataVersion = useStore((s) => s.dataVersion);
  const scanInfo = useStore((s) => s.scan.info);
  const setPage = useStore((s) => s.setPage);
  const [days, setDays] = useState(30);

  const disks = useAsync(() => api.getDisks(), [dataVersion]);
  const totals = useAsync(() => api.getHistoryTotals(), [dataVersion]);
  const history = useAsync(() => api.getSpaceHistory(days), [days, dataVersion]);
  const suggestions = useAsync(
    () => (scanInfo ? api.getSuggestions(false) : Promise.resolve([])),
    [scanInfo?.startedAt, dataVersion],
  );

  const safeBytes = (suggestions.data ?? []).filter((g) => g.safety === "safe").reduce((s, g) => s + g.bytes, 0);
  const totalFree = (disks.data ?? []).reduce((s, d) => s + d.freeBytes, 0);
  const totalSize = (disks.data ?? []).reduce((s, d) => s + d.totalBytes, 0);

  return (
    <div>
      <PageHeader
        title={t("page.dashboard")}
        subtitle={t("dash.subtitle")}
        actions={
          <Button
            size="sm"
            onClick={() => {
              disks.reload();
              history.reload();
              totals.reload();
            }}
          >
            <RefreshCw className="h-3.5 w-3.5" /> {t("common.refresh")}
          </Button>
        }
      />

      <div className="mb-6 grid grid-cols-4 gap-4">
        <Stat label={t("dash.freeAll")} value={formatBytes(totalFree)} sub={t("dash.ofTotal", { total: formatBytes(totalSize) })} accent="var(--sc-accent-500)" />
        <Stat
          label={t("dash.freedBy")}
          value={formatBytes(totals.data?.freedBytes ?? 0)}
          sub={t("dash.itemsRemoved", { n: totals.data?.itemsDeleted ?? 0 })}
          accent="var(--sc-positive-300)"
        />
        <Stat
          label={t("dash.cleanups")}
          value={totals.data?.runs ?? 0}
          sub={totals.data?.lastCleanupAt ? t("dash.last", { when: timeAgo(totals.data.lastCleanupAt) }) : t("dash.noneYet")}
        />
        <Stat
          label={t("dash.safeNow")}
          value={scanInfo ? formatBytes(safeBytes) : "—"}
          sub={scanInfo ? t("dash.fromScan", { path: scanInfo.root.path }) : t("dash.runScan")}
          accent="var(--sc-positive-300)"
        />
      </div>

      {scanInfo && safeBytes > 0 && (
        <button
          onClick={() => setPage("suggestions")}
          className="mb-6 flex w-full items-center gap-4 rounded-card border border-emerald-500/30 bg-gradient-to-r from-emerald-500/15 via-emerald-500/5 to-transparent px-6 py-5 text-left transition hover:border-emerald-400/60"
        >
          <div className="rounded-xl bg-emerald-500/20 p-3">
            <Sparkles className="h-6 w-6 text-emerald-300" />
          </div>
          <div className="flex-1">
            <div className="text-lg font-semibold">
              <Highlighted text={t("dash.canFree")} param="{size}" value={formatBytes(safeBytes)} className="text-emerald-300" />
            </div>
            <div className="text-sm text-muted">
              {t("dash.canFreeBody")}
            </div>
          </div>
          <span className="flex items-center gap-1 text-sm font-medium text-emerald-300">
            {t("dash.reviewSuggestions")} <ArrowRight className="h-4 w-4" />
          </span>
        </button>
      )}

      <RecycleBinCard />

      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted">{t("dash.drives")}</h2>
      {disks.loading && !disks.data ? (
        <Spinner />
      ) : (
        <div className="mb-6 grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-4">
          {(disks.data ?? []).map((d) => (
            <DiskCard key={d.mount} disk={d} />
          ))}
        </div>
      )}

      <Card
        title={t("dash.chartTitle")}
        icon={<Activity className="h-4 w-4 text-indigo-300" />}
        actions={
          <>
            <div className="flex rounded-full border border-white/[0.08] bg-white/[0.04] p-0.5">
              {RANGES.map((r) => (
                <button
                  key={r}
                  onClick={() => setDays(r)}
                  className={cx(
                    "rounded-md px-2.5 py-1 text-xs font-medium",
                    days === r ? "bg-indigo-500/25 text-indigo-200" : "text-muted hover:text-slate-200",
                  )}
                >
                  {r === 365 ? t("dash.range.y") : t("dash.range.d", { n: r })}
                </button>
              ))}
            </div>
            <Button
              size="sm"
              variant="ghost"
              title={t("dash.recordNow")}
              onClick={() => api.recordSpaceSnapshot().then(history.reload)}
            >
              <Camera className="h-3.5 w-3.5" />
            </Button>
          </>
        }
      >
        {history.data && history.data.length > 0 ? (
          <SpaceChart snapshots={history.data} />
        ) : (
          <Empty icon={<Activity className="h-6 w-6" />} title={t("dash.noHistory")}>
            {t("dash.noHistoryBody")}
          </Empty>
        )}
      </Card>
    </div>
  );
}

function DiskCard({ disk }: { disk: DiskInfo }) {
  const share = disk.totalBytes ? disk.usedBytes / disk.totalBytes : 0;
  const color = share > 0.9 ? "#ef4444" : share > 0.75 ? "#f59e0b" : "var(--sc-accent-500)";
  const r = 34;
  const c = 2 * Math.PI * r;
  return (
    <div className="glass flex items-center gap-5 rounded-card p-5">
      <div className="relative h-20 w-20 shrink-0">
        <svg viewBox="0 0 80 80" className="h-20 w-20 -rotate-90">
          <circle cx="40" cy="40" r={r} style={{ stroke: "var(--sc-surface-raised)" }} strokeWidth="8" fill="none" />
          <circle
            cx="40"
            cy="40"
            r={r}
            style={{ stroke: color }}
            strokeWidth="8"
            fill="none"
            strokeLinecap="round"
            strokeDasharray={`${c * share} ${c}`}
          />
        </svg>
        <div className="tabular absolute inset-0 flex items-center justify-center text-sm font-bold">{formatPercent(share, 0)}</div>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          {disk.removable ? <Usb className="h-4 w-4 text-muted" /> : <HardDrive className="h-4 w-4 text-muted" />}
          <span className="truncate font-semibold">{disk.mount}</span>
          <span className="truncate text-xs text-muted">{disk.name}</span>
        </div>
        <div className="mt-1 text-xs text-muted">
          {disk.fileSystem} · {disk.kind.toUpperCase()}
        </div>
        <div className="tabular mt-2 text-sm">
          <span className="font-semibold text-slate-100">{formatBytes(disk.freeBytes)}</span>
          <span className="text-muted"> {t("dash.freeOf", { total: formatBytes(disk.totalBytes) })}</span>
        </div>
        <Button size="sm" variant="secondary" className="mt-3" onClick={() => startScan(disk.mount, disk.usedBytes)}>
          <ScanSearch className="h-3.5 w-3.5" /> {t("common.scan")}
        </Button>
      </div>
    </div>
  );
}

function SpaceChart({ snapshots }: { snapshots: SpaceSnapshot[] }) {
  const { lang } = useT();
  const { SERIES_COLORS, CHART_TEXT, CHART_LINE, POSITIVE, BG, RAISED, ACCENT, tooltipBase, theme } = useChartTheme();
  const option = useMemo(() => {
    const byMount = new Map<string, SpaceSnapshot[]>();
    for (const s of snapshots) {
      const arr = byMount.get(s.mount) ?? [];
      arr.push(s);
      byMount.set(s.mount, arr);
    }
    const series = [...byMount.entries()].map(([mount, list], i) => {
      const color = SERIES_COLORS[i % SERIES_COLORS.length];
      return {
        name: mount,
        type: "line",
        smooth: true,
        showSymbol: list.length < 40,
        symbolSize: 6,
        lineStyle: { width: 2.5, color },
        itemStyle: { color },
        areaStyle: {
          color: {
            type: "linear",
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: color + "55" },
              { offset: 1, color: color + "00" },
            ],
          },
        },
        data: list.map((s) => [s.takenAt * 1000, s.freeBytes, s.trigger, s.totalBytes]),
        markPoint: {
          symbol: "pin",
          symbolSize: 34,
          itemStyle: { color: POSITIVE },
          label: { formatter: "✓", color: BG, fontSize: 11, fontWeight: "bold" },
          data: list
            .filter((s) => s.trigger === "cleanup")
            .map((s) => ({ coord: [s.takenAt * 1000, s.freeBytes], name: t("dash.cleanupMarker") })),
        },
      };
    });
    return {
      backgroundColor: "transparent",
      color: SERIES_COLORS,
      grid: { left: 70, right: 24, top: 36, bottom: 50 },
      legend: { top: 0, textStyle: { color: CHART_TEXT }, icon: "roundRect" },
      tooltip: {
        ...tooltipBase,
        trigger: "axis",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        formatter: (params: any[]) => {
          if (!params.length) return "";
          const head = formatDateTime(params[0].value[0] / 1000);
          const rows = params
            .map(
              (p) =>
                `${p.marker} <b>${p.seriesName}</b> ${t("dash.chartFree", { size: formatBytes(p.value[1]) })}` +
                (p.value[2] !== "auto" ? ` <span style="color:var(--sc-chart-text)">(${triggerLabel(p.value[2])})</span>` : ""),
            )
            .join("<br/>");
          return `${head}<br/>${rows}`;
        },
      },
      xAxis: {
        type: "time",
        axisLine: { lineStyle: { color: CHART_LINE } },
        axisLabel: { color: CHART_TEXT },
        splitLine: { show: false },
      },
      yAxis: {
        type: "value",
        axisLabel: { color: CHART_TEXT, formatter: (v: number) => formatBytes(v) },
        splitLine: { lineStyle: { color: CHART_LINE, type: "dashed" } },
      },
      dataZoom: [
        { type: "inside" },
        {
          type: "slider",
          height: 18,
          bottom: 8,
          borderColor: "transparent",
          backgroundColor: RAISED,
          fillerColor: ACCENT + "33",
          dataBackground: { lineStyle: { color: ACCENT, opacity: 0.5 }, areaStyle: { color: ACCENT, opacity: 0.15 } },
          selectedDataBackground: { lineStyle: { color: ACCENT }, areaStyle: { color: ACCENT, opacity: 0.3 } },
          handleStyle: { color: ACCENT, borderColor: ACCENT },
          moveHandleStyle: { color: ACCENT, opacity: 0.6 },
          textStyle: { color: CHART_TEXT },
        },
      ],
      series,
    };
  }, [snapshots, theme, lang]);
  return <Chart option={option} style={{ height: 340 }} />;
}

/** Snapshot trigger ids ("scan", "cleanup", …) → localised label. */
function triggerLabel(trigger: string): string {
  const key = `trigger.${trigger}` as MessageKey;
  const label = t(key);
  return label === key ? trigger : label;
}

/** Renders a translated sentence with one value highlighted. */
function Highlighted({ text, param, value, className }: { text: string; param: string; value: string; className: string }) {
  const [before, after] = text.split(param);
  return (
    <>
      {before}
      <span className={className}>{value}</span>
      {after}
    </>
  );
}
