import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { modelDisplayName } from "@/hooks/useModels";
import { formatCost, formatNumber } from "@/lib/format";
import type { ModelOut, UsageByModel } from "@/lib/types";

export function UsageByModelTable({ rows, models }: { rows: UsageByModel[]; models: ModelOut[] | undefined }) {
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">No usage yet.</p>;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Model</TableHead>
          <TableHead className="text-right">Answers</TableHead>
          <TableHead className="text-right">Input tokens</TableHead>
          <TableHead className="text-right">Output tokens</TableHead>
          <TableHead className="text-right">Cost</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.model_id}>
            <TableCell>
              <div className="font-medium">{modelDisplayName(models, row.model_id)}</div>
              <div className="font-mono text-xs text-muted-foreground">{row.model_id}</div>
            </TableCell>
            <TableCell className="text-right tabular-nums">{formatNumber(row.messages)}</TableCell>
            <TableCell className="text-right tabular-nums">{formatNumber(row.input_tokens)}</TableCell>
            <TableCell className="text-right tabular-nums">{formatNumber(row.output_tokens)}</TableCell>
            <TableCell className="text-right tabular-nums">{formatCost(row.cost_usd)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
