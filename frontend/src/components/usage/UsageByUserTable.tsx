import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCost, formatNumber } from "@/lib/format";
import type { UsageByUser } from "@/lib/types";

export function UsageByUserTable({ rows }: { rows: UsageByUser[] }) {
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">No usage yet.</p>;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>User</TableHead>
          <TableHead className="text-right">Answers</TableHead>
          <TableHead className="text-right">Input tokens</TableHead>
          <TableHead className="text-right">Output tokens</TableHead>
          <TableHead className="text-right">Cost</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.user_id}>
            <TableCell className="font-medium">{row.username}</TableCell>
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
