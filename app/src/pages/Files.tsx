import { useMemo, useState } from "react";
import { FileStack, PieChart, ScanSearch } from "lucide-react";
import { api, type TypeGroup } from "../api";
import { Chart, SERIES_COLORS, tooltipBase } from "../components/Chart";
import { PageHeader } from "../components/Layout";
import { NodeTable } from "../components/NodeTable";
import { Button, Card, Empty, Spinner, useAsync } from "../components/ui";
import { cx, formatBytes, formatCount } from "../lib/format";
import { useStore } from "../store";

export function Files() {
  const info = useStore((s) => s.scan.info);
  const dataVersion = useStore((s) => s.dataVersion);
  const setPage = useStore((s) => s.setPage);
  const [limit, setLimit] = useState(100);
  const largest = useAsync(() => (info ? api.getLargestFiles(limit) : Promise.resolve([])), [info?.startedAt, limit, dataVersion]);
  const types = useAsync(() => (info ? api.getTypeBreakdown() : Promise.resolve([])), [info?.startedAt, dataVersion]);

  if (!info) {
    return (
      <div>
        <PageHeader title="Files & Types" />
        <Empty icon={<FileStack className="h-6 w-6" />} title="Scan a drive first">
          <div className="mt-4">
            <Button variant="primary" onClick={() => setPage("explorer")}>
              <ScanSearch className="h-4 w-4" /> Start a scan
            </Button>
          </div>
        </Empty>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Files & Types" subtitle={`Largest files and what kinds of files fill ${info.root.path}.`} />
      <Card title="Space by file type" icon={<PieChart className="h-4 w-4 text-indigo-300" />} className="mb-5">
        {types.loading && !types.data ? <Spinner /> : <TypeBreakdown groups={types.data ?? []} />}
      </Card>
      <Card
        title="Largest files"
        icon={<FileStack className="h-4 w-4 text-indigo-300" />}
        actions={
          <select
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value))}
            className="rounded-lg border border-line bg-panel-2 px-2 py-1 text-xs"
          >
            {[50, 100, 250, 500].map((n) => (
              <option key={n} value={n}>
                Top {n}
              </option>
            ))}
          </select>
        }
        bodyClassName="p-3"
      >
        {largest.loading && !largest.data ? <Spinner /> : <NodeTable rows={largest.data ?? []} showPath shareMode="max" />}
      </Card>
    </div>
  );
}

function TypeBreakdown({ groups }: { groups: TypeGroup[] }) {
  const [active, setActive] = useState<string | null>(null);
  const total = groups.reduce((s, g) => s + g.bytes, 0);
  const option = useMemo(
    () => ({
      color: SERIES_COLORS,
      tooltip: {
        ...tooltipBase,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        formatter: (p: any) => `<b>${p.name}</b><br/>${formatBytes(p.value)} · ${p.percent}%`,
      },
      series: [
        {
          type: "pie",
          radius: ["55%", "85%"],
          itemStyle: { borderColor: "#121826", borderWidth: 3, borderRadius: 6 },
          label: { show: false },
          emphasis: { scale: true, scaleSize: 6 },
          data: groups.map((g) => ({ name: g.group, value: g.bytes })),
        },
      ],
    }),
    [groups],
  );
  if (groups.length === 0) return <div className="py-8 text-center text-sm text-muted">No files.</div>;
  const shown = active ? groups.filter((g) => g.group === active) : groups;
  return (
    <div className="grid grid-cols-[320px_1fr] gap-6">
      <div className="relative">
        <Chart
          option={option}
          style={{ height: 300 }}
          onEvents={{ click: (p) => setActive((a) => (a === p.name ? null : p.name)) }}
        />
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <div className="tabular text-xl font-bold">{formatBytes(total)}</div>
          <div className="text-xs text-muted">{active ?? "all files"}</div>
        </div>
      </div>
      <div className="overflow-hidden rounded-xl border border-line">
        <table className="w-full text-sm">
          <thead className="bg-panel-2 text-left text-xs uppercase tracking-wider text-muted">
            <tr>
              <th className="px-3 py-2.5 font-medium">Type</th>
              <th className="px-3 py-2.5 text-right font-medium">Size</th>
              <th className="px-3 py-2.5 text-right font-medium">Files</th>
              <th className="px-3 py-2.5 font-medium">Top extensions</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((g) => {
              const i = groups.indexOf(g);
              return (
                <tr
                  key={g.group}
                  onClick={() => setActive((a) => (a === g.group ? null : g.group))}
                  className={cx("cursor-pointer border-t border-line/70 hover:bg-white/[0.03]", active === g.group && "bg-indigo-500/10")}
                >
                  <td className="px-3 py-2">
                    <span className="flex items-center gap-2 font-medium">
                      <span className="h-2.5 w-2.5 rounded-sm" style={{ background: SERIES_COLORS[i % SERIES_COLORS.length] }} />
                      {g.group}
                    </span>
                  </td>
                  <td className="tabular px-3 py-2 text-right">{formatBytes(g.bytes)}</td>
                  <td className="tabular px-3 py-2 text-right text-muted">{formatCount(g.files)}</td>
                  <td className="px-3 py-2 text-xs text-muted">
                    {g.extensions
                      .slice(0, active ? 8 : 4)
                      .map(([ext, bytes]) => `${ext.startsWith("(") ? ext : "." + ext} ${formatBytes(bytes)}`)
                      .join(" · ")}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
