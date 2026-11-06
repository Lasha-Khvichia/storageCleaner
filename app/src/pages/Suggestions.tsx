import { useState } from "react";
import { ChevronDown, ChevronRight, ScanSearch, Sparkles } from "lucide-react";
import { api, type SuggestionGroup } from "../api";
import { PageHeader } from "../components/Layout";
import { NodeTable } from "../components/NodeTable";
import { Button, Card, Checkbox, Empty, SafetyBadge, Spinner, Toggle, useAsync } from "../components/ui";
import { SAFETY, cx, formatBytes } from "../lib/format";
import { toSelected, useStore } from "../store";

export function Suggestions() {
  const info = useStore((s) => s.scan.info);
  const dataVersion = useStore((s) => s.dataVersion);
  const setPage = useStore((s) => s.setPage);
  const [includeReview, setIncludeReview] = useState(false);
  const groups = useAsync(
    () => (info ? api.getSuggestions(includeReview) : Promise.resolve([])),
    [info?.startedAt, includeReview, dataVersion],
  );

  if (!info) {
    return (
      <div>
        <PageHeader title="Suggestions" />
        <Empty icon={<Sparkles className="h-6 w-6" />} title="Scan a drive first">
          Suggestions are built from your latest scan.
          <div className="mt-4">
            <Button variant="primary" onClick={() => setPage("explorer")}>
              <ScanSearch className="h-4 w-4" /> Start a scan
            </Button>
          </div>
        </Empty>
      </div>
    );
  }

  const list = groups.data ?? [];
  const safeTotal = list.filter((g) => g.safety === "safe").reduce((s, g) => s + g.bytes, 0);
  const reviewTotal = list.filter((g) => g.safety === "review").reduce((s, g) => s + g.bytes, 0);

  return (
    <div>
      <PageHeader
        title="Suggestions"
        subtitle={`What can most likely be removed from ${info.root.path}, grouped by kind.`}
        actions={
          <label className="flex items-center gap-3 rounded-full border border-white/[0.08] bg-white/[0.04] px-4 py-2 text-sm">
            <Toggle checked={includeReview} onChange={setIncludeReview} />
            Include items that need review
          </label>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-4">
        <div className="rounded-card border border-emerald-500/30 bg-emerald-500/10 p-5">
          <div className="text-xs font-medium uppercase tracking-wider text-emerald-300/80">Safe to delete</div>
          <div className="tabular mt-1 text-3xl font-bold text-emerald-300">{formatBytes(safeTotal)}</div>
          <div className="mt-1 text-sm text-emerald-100/70">Rebuilt automatically or never needed again.</div>
        </div>
        <div className={cx("rounded-card border p-5", includeReview ? "border-amber-500/30 bg-amber-500/10" : "border-line bg-panel")}>
          <div className="text-xs font-medium uppercase tracking-wider text-amber-300/80">Needs your review</div>
          <div className="tabular mt-1 text-3xl font-bold text-amber-300">{includeReview ? formatBytes(reviewTotal) : "—"}</div>
          <div className="mt-1 text-sm text-muted">
            {includeReview ? "Installers, logs, upgrade leftovers. Check before deleting." : "Turn on the toggle to include these."}
          </div>
        </div>
      </div>

      {groups.loading && !groups.data ? (
        <Spinner />
      ) : list.length === 0 ? (
        <Empty icon={<Sparkles className="h-6 w-6" />} title="Nothing to suggest">
          No caches, temp files or clutter were found in this scan.
        </Empty>
      ) : (
        <div className="space-y-3">
          {list.map((g) => (
            <GroupCard key={`${g.category}-${g.safety}`} group={g} />
          ))}
        </div>
      )}
    </div>
  );
}

function GroupCard({ group }: { group: SuggestionGroup }) {
  const [open, setOpen] = useState(false);
  const selection = useStore((s) => s.selection);
  const selectMany = useStore((s) => s.selectMany);
  const selectedCount = group.items.filter((i) => selection.has(i.id)).length;
  const all = selectedCount === group.items.length && group.items.length > 0;
  const s = SAFETY[group.safety];
  return (
    <Card bodyClassName="p-0">
      <div className="flex cursor-pointer items-center gap-4 px-5 py-4" onClick={() => setOpen((o) => !o)}>
        <Checkbox
          checked={all}
          indeterminate={selectedCount > 0}
          onChange={(v) => selectMany(group.items.map(toSelected), v)}
          title="Select the whole group"
        />
        {open ? <ChevronDown className="h-4 w-4 text-muted" /> : <ChevronRight className="h-4 w-4 text-muted" />}
        <div className={cx("h-9 w-1 rounded-full", s.dot)} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-3">
            <span className="font-semibold">{group.label}</span>
            <SafetyBadge level={group.safety} compact />
          </div>
          <div className="mt-0.5 truncate text-xs text-muted">{group.items[0]?.reason}</div>
        </div>
        <div className="text-right">
          <div className="tabular text-lg font-semibold">{formatBytes(group.bytes)}</div>
          <div className="text-xs text-muted">
            {group.count} item{group.count === 1 ? "" : "s"}
            {group.count > group.items.length && ` (top ${group.items.length} shown)`}
          </div>
        </div>
      </div>
      {open && (
        <div className="border-t border-line p-3">
          <NodeTable rows={group.items} showPath shareMode="max" />
        </div>
      )}
    </Card>
  );
}
