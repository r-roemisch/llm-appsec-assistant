import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckIcon, XIcon } from "lucide-react";
import { toast } from "sonner";

import { JsonBlock } from "@/components/common/JsonBlock";
import { PluginApprovalNote } from "@/components/common/PluginApprovalNote";
import { LoadError, LoadingRows } from "@/components/common/QueryState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { usePendingAdminApprovals } from "@/hooks/useAdmin";
import { useNow } from "@/hooks/useNow";
import { decideApproval, errorMessage, listApprovals } from "@/lib/api";
import { formatCountdown, formatRelativeTime, formatShortDateTime } from "@/lib/format";
import { queryKeys } from "@/lib/query-keys";
import { approvalStatusLabel, toolLabel, toolPluginId } from "@/lib/tools";
import type { ApprovalDecision, ApprovalOut, ApprovalStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

const RECENT_LIMIT = 20;

const STATUS_STYLES: Record<ApprovalStatus, string> = {
  pending: "border-warning/40 text-warning",
  approved: "border-success/30 text-success",
  rejected: "border-destructive/30 text-destructive",
  expired: "text-muted-foreground",
  consumed: "text-muted-foreground",
};

export function ApprovalStatusBadge({ status }: { status: ApprovalStatus }) {
  return (
    <Badge variant="outline" className={cn("font-normal", STATUS_STYLES[status])}>
      {approvalStatusLabel(status)}
    </Badge>
  );
}

function PendingApproval({ approval, now }: { approval: ApprovalOut; now: number }) {
  const queryClient = useQueryClient();
  const tool = toolLabel(approval.tool);
  const pluginId = toolPluginId(approval.tool);
  const remaining = Date.parse(approval.expires_at) - now;
  const decide = useMutation({
    mutationFn: (decision: ApprovalDecision) => decideApproval(approval.id, decision),
    onSuccess: (updated) => {
      toast.success(
        updated.status === "approved"
          ? `Approved. ${updated.requested_by} can continue the conversation.`
          : `Rejected. ${updated.requested_by}'s assistant continues without the call.`,
      );
    },
    onError: (err) => toast.error(errorMessage(err)),
    // Decided, expired meanwhile or not: the lists are out of date either way.
    onSettled: () => void queryClient.invalidateQueries({ queryKey: queryKeys.adminApprovals }),
  });

  return (
    <li aria-label={`Approval for ${tool} requested by ${approval.requested_by}`} className="space-y-3 rounded-xl border bg-card p-4">
      <div className="space-y-0.5">
        <p className="flex flex-wrap items-baseline gap-x-2">
          <span className="font-medium">{tool}</span>
          <span className="font-mono text-xs text-muted-foreground">{approval.tool}</span>
        </p>
        <p className="text-xs text-muted-foreground">
          Requested by <span className="font-medium text-foreground">{approval.requested_by}</span>{" "}
          {formatRelativeTime(approval.created_at, now)} ·{" "}
          {remaining > 0 ? (
            <span className="tabular-nums">expires in {formatCountdown(remaining)}</span>
          ) : (
            <span className="text-destructive">expired</span>
          )}
        </p>
      </div>
      {pluginId ? <PluginApprovalNote pluginId={pluginId} /> : null}
      <JsonBlock value={approval.arguments} label={`Arguments of ${tool}`} />
      <p className="text-xs text-muted-foreground">
        Approving lets exactly this call run once; the requester then continues the conversation.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={decide.isPending || remaining <= 0} onClick={() => decide.mutate("approve")}>
          <CheckIcon />
          Approve
        </Button>
        <Button size="sm" variant="outline" disabled={decide.isPending} onClick={() => decide.mutate("reject")}>
          <XIcon />
          Reject
        </Button>
      </div>
    </li>
  );
}

function RecentDecisions({ approvals, now }: { approvals: ApprovalOut[]; now: number }) {
  if (approvals.length === 0) return <p className="text-sm text-muted-foreground">No decisions yet.</p>;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Tool</TableHead>
          <TableHead>Requested by</TableHead>
          <TableHead>Approver</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Decided by</TableHead>
          <TableHead>When</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {approvals.map((approval) => (
          <TableRow key={approval.id}>
            <TableCell className="font-medium">{toolLabel(approval.tool)}</TableCell>
            <TableCell>{approval.requested_by}</TableCell>
            <TableCell>{approval.approver === "admin" ? "Administrator" : "Requester"}</TableCell>
            <TableCell>
              <ApprovalStatusBadge status={approval.status} />
            </TableCell>
            <TableCell>{approval.decided_by ?? "—"}</TableCell>
            <TableCell className="text-muted-foreground" title={formatShortDateTime(approval.decided_at ?? approval.created_at, now)}>
              {formatRelativeTime(approval.decided_at ?? approval.created_at, now)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function ApprovalsTab() {
  const pending = usePendingAdminApprovals();
  const all = useQuery({ queryKey: queryKeys.adminApprovalList({}), queryFn: () => listApprovals() });
  const now = useNow(1000);
  const recent = all.data?.filter((approval) => approval.status !== "pending").slice(0, RECENT_LIMIT) ?? [];

  return (
    <div className="space-y-10">
      <section className="space-y-3">
        <div>
          <h2 className="text-base font-semibold">Waiting for an administrator</h2>
          <p className="text-sm text-muted-foreground">
            Tool calls of Tools set to admin approval. Each Approval is bound to the arguments shown and expires after 24
            hours.
          </p>
        </div>
        {pending.isPending ? (
          <LoadingRows label="Loading Approvals" />
        ) : pending.isError ? (
          <LoadError error={pending.error} onRetry={() => void pending.refetch()} />
        ) : pending.data.length === 0 ? (
          <p className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
            Nothing waits for a decision.
          </p>
        ) : (
          <ul className="space-y-3">
            {pending.data.map((approval) => (
              <PendingApproval key={approval.id} approval={approval} now={now} />
            ))}
          </ul>
        )}
      </section>
      <section className="space-y-3">
        <div>
          <h2 className="text-base font-semibold">Recent decisions</h2>
          <p className="text-sm text-muted-foreground">
            The latest {RECENT_LIMIT} Approvals that are no longer pending, by requesters and administrators.
          </p>
        </div>
        {all.isPending ? (
          <LoadingRows label="Loading recent decisions" />
        ) : all.isError ? (
          <LoadError error={all.error} onRetry={() => void all.refetch()} />
        ) : (
          <RecentDecisions approvals={recent} now={now} />
        )}
      </section>
    </div>
  );
}
