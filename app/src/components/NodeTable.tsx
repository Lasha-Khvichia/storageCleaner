import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ExternalLink, File, Folder, FolderOpen, Link2 } from "lucide-react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import type { NodeView } from "../api";
import { SAFETY, cx, formatBytes, formatCount, formatDate, formatPercent } from "../lib/format";
import { toSelected, useStore } from "../store";
import { Checkbox, SafetyBadge } from "./ui";

type SortKey = "name" | "size" | "files" | "modified" | "safety";

const SAFETY_ORDER = { safe: 0, review: 1, unknown: 2, protected: 3 } as const;

export function NodeTable({
  rows,
  onOpenDir,
  showPath,
  shareMode = "parent",
  emptyText = "Nothing here.",
}: {
  rows: NodeView[];
  onOpenDir?: (n: NodeView) => void;
  /** Show the full path under the name (for flat lists like largest files). */
  showPath?: boolean;
  /** Bar = share of parent, or relative to the largest row. */
  shareMode?: "parent" | "max";
  emptyText?: string;
}) {
  const selection = useStore((s) => s.selection);
  const toggleSelect = useStore((s) => s.toggleSelect);
  const selectMany = useStore((s) => s.selectMany);
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "size", desc: true });

  const sorted = useMemo(() => {
    const r = [...rows];
    const dir = sort.desc ? -1 : 1;
    r.sort((a, b) => {
      switch (sort.key) {
        case "name":
          return dir * a.name.localeCompare(b.name);
        case "files":
          return dir * (a.files - b.files);
        case "modified":
          return dir * (a.modified - b.modified);
        case "safety":
          return dir * (SAFETY_ORDER[a.safety] - SAFETY_ORDER[b.safety]);
        default:
          return dir * (a.size - b.size);
      }
    });
    return r;
  }, [rows, sort]);

  const maxSize = useMemo(() => rows.reduce((m, r) => Math.max(m, r.size), 0), [rows]);
  const selectable = rows.filter((r) => r.safety !== "protected");
  const selectedCount = selectable.filter((r) => selection.has(r.id)).length;
  const allSelected = selectable.length > 0 && selectedCount === selectable.length;

  const header = (key: SortKey, label: string, className?: string) => (
    <th
      className={cx("cursor-pointer select-none px-3 py-2.5 font-medium hover:text-slate-200", className)}
      onClick={() => setSort((s) => ({ key, desc: s.key === key ? !s.desc : key !== "name" }))}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {sort.key === key && (sort.desc ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />)}
      </span>
    </th>
  );

  if (rows.length === 0) {
    return <div className="py-10 text-center text-sm text-muted">{emptyText}</div>;
  }

  return (
    <div className="overflow-hidden rounded-xl border border-line">
      <table className="w-full table-fixed text-sm">
        <thead className="bg-panel-2 text-left text-xs uppercase tracking-wider text-muted">
          <tr>
            <th className="w-10 px-3 py-2.5">
              <Checkbox
                checked={allSelected}
                indeterminate={selectedCount > 0}
                disabled={selectable.length === 0}
                title={selectable.length === 0 ? "All items here are protected" : "Select all"}
                onChange={(v) => selectMany(selectable.map(toSelected), v)}
              />
            </th>
            {header("name", "Name")}
            {header("size", "Size", "w-56")}
            {header("files", "Files", "w-24 text-right")}
            {header("modified", "Modified", "w-32")}
            {header("safety", "Safety", "w-32")}
            <th className="w-10" />
          </tr>
        </thead>
        <tbody>
          {sorted.map((n) => {
            const selected = selection.has(n.id);
            const share = shareMode === "max" ? (maxSize ? n.size / maxSize : 0) : n.shareOfParent;
            const isDir = n.kind === "dir";
            const Icon = n.kind === "link" ? Link2 : isDir ? (selected ? FolderOpen : Folder) : File;
            return (
              <tr
                key={n.id}
                onClick={() => (isDir && onOpenDir ? onOpenDir(n) : toggleSelect(toSelected(n)))}
                className={cx(
                  "group cursor-pointer border-t border-line/70 transition-colors",
                  selected ? "bg-indigo-500/10 hover:bg-indigo-500/15" : "hover:bg-white/[0.03]",
                )}
              >
                <td className="px-3 py-2">
                  <Checkbox
                    checked={selected}
                    disabled={n.safety === "protected"}
                    title={n.safety === "protected" ? `Protected: ${n.reason}` : undefined}
                    onChange={() => toggleSelect(toSelected(n))}
                  />
                </td>
                <td className="px-3 py-2">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <Icon className={cx("h-4 w-4 shrink-0", isDir ? "text-indigo-300" : "text-slate-400")} />
                    <div className="min-w-0">
                      <div className="truncate font-medium text-slate-100" title={n.name}>
                        {n.name}
                      </div>
                      {showPath && (
                        <div className="truncate text-xs text-muted" title={n.path}>
                          {n.path}
                        </div>
                      )}
                    </div>
                  </div>
                </td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-3">
                    <span className="tabular w-20 shrink-0 text-right font-medium">{formatBytes(n.size)}</span>
                    <div className="flex-1">
                      <div className="h-1.5 overflow-hidden rounded-full bg-slate-800">
                        <div
                          className="h-full rounded-full"
                          style={{ width: `${Math.max(0.5, share * 100)}%`, background: SAFETY[n.safety].color }}
                        />
                      </div>
                    </div>
                    {shareMode === "parent" && (
                      <span className="tabular w-12 shrink-0 text-right text-xs text-muted">{formatPercent(share)}</span>
                    )}
                  </div>
                </td>
                <td className="tabular px-3 py-2 text-right text-muted">{isDir ? formatCount(n.files) : "—"}</td>
                <td className="px-3 py-2 text-muted">{formatDate(n.modified)}</td>
                <td className="px-3 py-2">
                  <SafetyBadge level={n.safety} reason={n.reason} compact />
                </td>
                <td className="px-2 py-2">
                  <button
                    title="Show in Explorer"
                    onClick={(e) => {
                      e.stopPropagation();
                      revealItemInDir(n.path).catch(() => {});
                    }}
                    className="rounded p-1 text-slate-500 opacity-0 hover:bg-white/5 hover:text-slate-200 group-hover:opacity-100"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
