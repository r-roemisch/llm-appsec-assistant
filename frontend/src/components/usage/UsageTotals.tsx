import { StatTiles } from "@/components/common/StatTiles";
import { formatCompact, formatCost } from "@/lib/format";
import type { UsageOut } from "@/lib/types";

/** The headline numbers of a usage report, as one row of stat tiles. */
export function UsageTotals({ usage }: { usage: UsageOut }) {
  return (
    <StatTiles
      tiles={[
        { label: "Answers", value: formatCompact(usage.messages), title: "Assistant messages" },
        { label: "Input tokens", value: formatCompact(usage.input_tokens) },
        { label: "Output tokens", value: formatCompact(usage.output_tokens) },
        { label: "Cost", value: formatCost(usage.cost_usd) },
      ]}
    />
  );
}
