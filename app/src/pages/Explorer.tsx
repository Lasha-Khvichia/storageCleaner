import { useEffect, useMemo, useState } from "react";
import {
  ChevronRight,
  Download,
  FolderSearch,
  HardDrive,
  Home,
  Loader2,
  RotateCcw,
  ScanSearch,
  Square,
  TriangleAlert,
} from "lucide-react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { api, errorMessage, type NodeView, type TreemapNode } from "../api";
import { Chart, useChartTheme } from "../components/Chart";
import { PageHeader } from "../components/Layout";
import { NodeTable } from "../components/NodeTable";
import { Button, Card, Meter, SafetyBadge, Spinner, Stat, useAsync } from "../components/ui";
import { SAFETY, formatBytes, formatCount, formatDuration, formatPercent } from "../lib/format";
import { startScan } from "../lib/scan";
import { useStore } from "../store";

const PAGE = 200;

export function Explorer() {
  const scan = useStore((s) => s.scan);
  if (scan.running) return <ScanProgressView />;
  if (!scan.info) return <ScanTargetPicker />;
  return <Browser />;
}

function ScanTargetPicker() {
  const disks = useAsync(() => api.getDisks(), []);
  const error = useStore((s) => s.scan.error);
  const pickFolder = async () => {
    const dir = await open({ directory: true, multiple: false, title: "Choose a folder to scan" });
    if (typeof dir === "string") startScan(dir, null);
  };
  return (
    <div>
      <PageHeader title="Scan & Explore" subtitle="Pick a drive or folder. Scanning is read-only — nothing is changed." />
      {error && (
        <div className="mb-5 flex items-center gap-2 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          <TriangleAlert className="h-4 w-4" /> {error}
        </div>
      )}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4">
        {(disks.data ?? []).map((d) => {
          const share = d.totalBytes ? d.usedBytes / d.totalBytes : 0;
          return (
            <button
              key={d.mount}
              onClick={() => startScan(d.mount, d.usedBytes)}
              className="glass group rounded-card p-5 text-left transition hover:border-indigo-400/50"
            >
              <div className="flex items-center gap-3">
                <div className="rounded-xl bg-indigo-500/15 p-2.5 text-indigo-300">
                  <HardDrive className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <div className="font-semibold">{d.mount}</div>
                  <div className="truncate text-xs text-muted">{d.name || d.fileSystem}</div>
                </div>
                <ScanSearch className="ml-auto h-5 w-5 text-slate-500 group-hover:text-indigo-300" />
              </div>
              <Meter share={share} className="mt-4" color={share > 0.9 ? "#ef4444" : share > 0.75 ? "#f59e0b" : "var(--sc-accent-500)"} />
              <div className="tabular mt-2 text-xs text-muted">
                {formatBytes(d.usedBytes)} used · {formatBytes(d.freeBytes)} free
              </div>
            </button>
          );
        })}
        <button
          onClick={pickFolder}
          className="flex flex-col items-center justify-center gap-2 rounded-card border border-dashed border-line p-5 text-muted transition hover:border-indigo-400/60 hover:text-slate-200"
        >
          <FolderSearch className="h-6 w-6" />
          <span className="text-sm font-medium">Choose a folder…</span>
        </button>
      </div>
    </div>
  );
}

function ScanProgressView() {
  const scan = useStore((s) => s.scan);
  const p = scan.progress;
  const pct = p && scan.targetUsedBytes ? Math.min(0.99, p.bytes / scan.targetUsedBytes) : null;
  const [cancelling, setCancelling] = useState(false);
  return (
    <div>
      <PageHeader title="Scanning…" subtitle={scan.target ?? ""} />
      <Card>
        <div className="flex items-center gap-6">
          <div className="relative flex h-28 w-28 shrink-0 items-center justify-center">
            <Loader2 className="absolute h-28 w-28 animate-spin text-indigo-500/30" strokeWidth={1} />
            <span className="tabular text-2xl font-bold">{pct !== null ? formatPercent(pct, 0) : "…"}</span>
          </div>
          <div className="grid flex-1 grid-cols-4 gap-3">
            <Stat label="Files" value={formatCount(p?.files ?? 0)} />
            <Stat label="Folders" value={formatCount(p?.dirs ?? 0)} />
            <Stat label="Size found" value={formatBytes(p?.bytes ?? 0)} accent="var(--sc-accent-500)" />
            <Stat label="Unreadable" value={formatCount(p?.errors ?? 0)} sub="access denied etc." />
          </div>
        </div>
        {pct !== null && <Meter share={pct} className="mt-6 h-2" />}
        <div className="mt-4 truncate font-mono text-xs text-muted" title={p?.currentPath}>
          {p?.currentPath || "Starting…"}
        </div>
        <div className="mt-5 flex justify-end">
          <Button
            variant="secondary"
            loading={cancelling}
            onClick={() => {
              setCancelling(true);
              api.cancelScan().finally(() => setCancelling(false));
            }}
          >
            <Square className="h-3.5 w-3.5" /> Cancel scan
          </Button>
        </div>
      </Card>
    </div>
  );
}

function Browser() {
  const info = useStore((s) => s.scan.info)!;
  const currentDir = useStore((s) => s.currentDir);
  const setCurrentDir = useStore((s) => s.setCurrentDir);
  const dataVersion = useStore((s) => s.dataVersion);
  const setScan = useStore((s) => s.setScan);
  const pushToast = useStore((s) => s.pushToast);

  const node = useAsync(() => api.getNode(currentDir), [currentDir, dataVersion]);
  const crumbs = useAsync(() => api.getBreadcrumbs(currentDir), [currentDir, dataVersion]);
  const treemap = useAsync(() => api.getTreemap(currentDir, 2, 40), [currentDir, dataVersion]);
  const totals = useAsync(() => api.getSafetyTotals(), [dataVersion, info.startedAt]);

  const [rows, setRows] = useState<NodeView[]>([]);
  const [loadingRows, setLoadingRows] = useState(false);
  useEffect(() => {
    let alive = true;
    setLoadingRows(true);
    api
      .getChildren(currentDir, 0, PAGE)
      .then((r) => alive && setRows(r))
      .catch(() => alive && setRows([]))
      .finally(() => alive && setLoadingRows(false));
    return () => {
      alive = false;
    };
  }, [currentDir, dataVersion]);

  // If the current folder was deleted, jump back to the root.
  useEffect(() => {
    if (!node.loading && node.data === null && currentDir !== 0) setCurrentDir(0);
  }, [node.loading, node.data, currentDir, setCurrentDir]);

  const loadMore = () => {
    setLoadingRows(true);
    api
      .getChildren(currentDir, rows.length, PAGE)
      .then((more) => setRows((r) => [...r, ...more]))
      .finally(() => setLoadingRows(false));
  };

  const exportCsv = async () => {
    const path = await save({ title: "Export report", defaultPath: "storage-report.csv", filters: [{ name: "CSV", extensions: ["csv"] }] });
    if (!path) return;
    try {
      await api.exportCsv(path, 4);
      pushToast({ kind: "success", title: "Report exported", body: path });
    } catch (e) {
      pushToast({ kind: "error", title: "Export failed", body: errorMessage(e) });
    }
  };

  const n = node.data;
  const totalBytes = (totals.data ?? []).reduce((s, t) => s + t.bytes, 0);

  return (
    <div>
      <PageHeader
        title="Scan & Explore"
        subtitle={
          <>
            {info.root.path} · {formatBytes(info.root.size)} · {formatCount(info.root.files)} files · scanned in{" "}
            {formatDuration(info.durationMs)}
          </>
        }
        actions={
          <>
            <Button size="sm" onClick={exportCsv}>
              <Download className="h-3.5 w-3.5" /> Export CSV
            </Button>
            <Button size="sm" onClick={() => startScan(info.root.path, null)}>
              <RotateCcw className="h-3.5 w-3.5" /> Rescan
            </Button>
            <Button size="sm" variant="primary" onClick={() => setScan({ info: null })}>
              <ScanSearch className="h-3.5 w-3.5" /> New scan
            </Button>
          </>
        }
      />

      {totalBytes > 0 && (
        <div className="glass mb-5 rounded-card p-4">
          <div className="mb-2 flex items-center justify-between text-xs text-muted">
            <span className="font-medium uppercase tracking-wider">Safety breakdown of all scanned files</span>
            <span className="flex gap-4">
              {(totals.data ?? []).map((t) => (
                <span key={t.level} className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full" style={{ background: SAFETY[t.level].color }} />
                  {SAFETY[t.level].label} <b className="tabular text-slate-200">{formatBytes(t.bytes)}</b>
                </span>
              ))}
            </span>
          </div>
          <div className="flex h-2.5 overflow-hidden rounded-full bg-slate-800">
            {(totals.data ?? []).map((t) => (
              <div key={t.level} style={{ width: `${(t.bytes / totalBytes) * 100}%`, background: SAFETY[t.level].color }} />
            ))}
          </div>
        </div>
      )}

      <nav className="mb-4 flex flex-wrap items-center gap-1 text-sm">
        {(crumbs.data ?? []).map((c, i, all) => (
          <span key={c.id} className="flex items-center gap-1">
            {i > 0 && <ChevronRight className="h-3.5 w-3.5 text-slate-600" />}
            <button
              onClick={() => setCurrentDir(c.id)}
              className={
                i === all.length - 1
                  ? "rounded-md px-2 py-1 font-semibold text-slate-100"
                  : "rounded-md px-2 py-1 text-muted hover:bg-white/5 hover:text-slate-200"
              }
            >
              {i === 0 ? (
                <span className="flex items-center gap-1.5">
                  <Home className="h-3.5 w-3.5" /> {c.name}
                </span>
              ) : (
                c.name
              )}
            </button>
          </span>
        ))}
        {n && (
          <span className="ml-auto flex items-center gap-3 text-xs text-muted">
            <span className="tabular font-semibold text-slate-200">{formatBytes(n.size)}</span>
            {formatCount(n.files)} files · {formatCount(n.dirs)} folders
            <SafetyBadge level={n.safety} reason={n.reason} compact />
          </span>
        )}
      </nav>
      {n && n.reason && n.safety !== "unknown" && (
        <p className="-mt-2 mb-4 text-xs text-muted">
          <b className={SAFETY[n.safety].text}>Why:</b> {n.reason}
        </p>
      )}

      <Card title="Space map" className="mb-5" bodyClassName="p-2">
        {treemap.loading && !treemap.data ? (
          <Spinner />
        ) : treemap.data && (treemap.data.children?.length ?? 0) > 0 ? (
          <Treemap data={treemap.data} onOpen={setCurrentDir} />
        ) : (
          <div className="py-10 text-center text-sm text-muted">This folder is empty.</div>
        )}
      </Card>

      <Card title={`Contents (${n?.childCount ?? rows.length})`} bodyClassName="p-3">
        <NodeTable rows={rows} onOpenDir={(d) => setCurrentDir(d.id)} emptyText={loadingRows ? "Loading…" : "This folder is empty."} />
        {n && rows.length < n.childCount && (
          <div className="mt-3 flex justify-center">
            <Button size="sm" onClick={loadMore} loading={loadingRows}>
              Load more ({formatCount(n.childCount - rows.length)} remaining)
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}

function Treemap({ data, onOpen }: { data: TreemapNode; onOpen: (id: number) => void }) {
  const { tooltipBase, theme, BG, SURFACE, RAISED, TEXT } = useChartTheme();
  const option = useMemo(() => {
    const convert = (t: TreemapNode, depth: number): Record<string, unknown> => ({
      name: t.name,
      value: t.value,
      id: t.id === null ? `other-${Math.random()}` : String(t.id),
      nodeId: t.id,
      isDir: t.isDir,
      safety: t.safety,
      itemStyle: {
        color: t.id === null ? RAISED : depth === 0 ? undefined : SAFETY[t.safety].color + (t.isDir ? "cc" : "99"),
        borderColor: BG,
      },
      children: t.children?.map((c) => convert(c, depth + 1)),
    });
    return {
      tooltip: {
        ...tooltipBase,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        formatter: (p: any) =>
          `<b>${p.name}</b><br/>${formatBytes(p.value)}` +
          (p.data?.safety ? `<br/><span style="color:${SAFETY[p.data.safety as keyof typeof SAFETY].color}">${SAFETY[p.data.safety as keyof typeof SAFETY].label}</span>` : "") +
          (p.data?.isDir ? `<br/><span style="color:var(--sc-chart-text)">Click to open</span>` : ""),
      },
      series: [
        {
          type: "treemap",
          roam: false,
          nodeClick: false,
          breadcrumb: { show: false },
          width: "100%",
          height: "100%",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          label: { show: true, formatter: "{b}", color: "#fff", fontSize: 11, overflow: "truncate" },
          upperLabel: { show: true, height: 20, color: TEXT, fontSize: 11, backgroundColor: "transparent" },
          levels: [
            { itemStyle: { borderWidth: 0, gapWidth: 3 } },
            { itemStyle: { borderWidth: 3, gapWidth: 1, borderColor: SURFACE } },
            { itemStyle: { borderWidth: 1, gapWidth: 1 }, colorSaturation: [0.35, 0.6] },
          ],
          data: (data.children ?? []).map((c) => convert(c, 1)),
        },
      ],
    };
  }, [data, theme]);

  return (
    <Chart
      option={option}
      style={{ height: 380 }}
      onEvents={{
        click: (p) => {
          const id = p?.data?.nodeId;
          if (typeof id === "number" && p.data.isDir) onOpen(id);
        },
      }}
    />
  );
}
