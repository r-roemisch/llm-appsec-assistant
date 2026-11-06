import { formatCompact, formatCost } from "@/lib/format";
import type { UsageOut } from "@/lib/types";

/** The headline numbers of a usage report, as one row of stat tiles. */
export function UsageTotals({ usage }: { usage: UsageOut }) {
  const tiles = [
    { label: "Answers", value: formatCompact(usage.messages), title: "Assistant messages" },
    { label: "Input tokens", value: formatCompact(usage.input_tokens) },
    { label: "Output tokens", value: formatCompact(usage.output_tokens) },
    { label: "Cost", value: formatCost(usage.cost_usd) },
  ];
  return (
    <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-4">
      {tiles.map((tile) => (
        <div key={tile.label} className="bg-card px-4 py-3" title={tile.title}>
          <dt className="text-xs text-muted-foreground">{tile.label}</dt>
          <dd className="mt-1 text-xl font-semibold">{tile.value}</dd>
        </div>
      ))}
    </dl>
  );
}
