import { useQuery } from "@tanstack/react-query";
import { ChevronRightIcon } from "lucide-react";
import { useState } from "react";

import { JsonBlock } from "@/components/common/JsonBlock";
import { LoadError, LoadingRows } from "@/components/common/QueryState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAdminTools } from "@/hooks/useAdmin";
import {
  listGuardEventRecords,
  listToolCallRecords,
  type GuardEventAuditFilters,
  type ToolCallAuditFilters,
} from "@/lib/api";
import { formatLatency, formatShortDateTime } from "@/lib/format";
import { categoryPhrase } from "@/lib/guards";
import { queryKeys } from "@/lib/query-keys";
import { decisionLabel, humanize, reasonLabel, toolLabel } from "@/lib/tools";
import type { ToolCallRecordOut, ToolDecision } from "@/lib/types";
import { cn } from "@/lib/utils";

const LIMIT = 200;
const ALL = "all";

const DECISION_STYLES: Record<ToolDecision, string> = {
  allow: "border-success/30 text-success",
  deny: "border-destructive/30 text-destructive",
  approval_required: "border-warning/40 text-warning",
};

function DecisionBadge({ decision }: { decision: ToolDecision }) {
  return (
    <Badge variant="outline" className={cn("font-normal", DECISION_STYLES[decision] ?? "")}>
      {DECISION_STYLES[decision] ? decisionLabel(decision) : humanize(decision)}
    </Badge>
  );
}

const ACTION_STYLES: Record<string, string> = {
  blocked: "border-warning/40 text-warning",
  flagged: "text-foreground",
  redacted: "text-primary border-primary/30",
};

function FilterSelect({
  id,
  label,
  value,
  onChange,
  options,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <div className="flex items-center gap-2">
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id} size="sm" className="min-w-36">
          <SelectValue />
        </SelectTrigger>
        <SelectContent position="popper" align="start">
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function ToolCallRow({ record }: { record: ToolCallRecordOut }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <TableRow>
        <TableCell className="w-8">
          <Button
            variant="ghost"
            size="icon-xs"
            aria-expanded={open}
            aria-label={open ? `Hide the arguments of ${record.tool}` : `Show the arguments of ${record.tool}`}
            onClick={() => setOpen(!open)}
          >
            <ChevronRightIcon className={cn("transition-transform", open && "rotate-90")} />
          </Button>
        </TableCell>
        <TableCell className="text-muted-foreground tabular-nums">{formatShortDateTime(record.created_at)}</TableCell>
        <TableCell>{record.username ?? "—"}</TableCell>
        <TableCell>
          <div className="font-medium">{toolLabel(record.tool)}</div>
          <div className="font-mono text-xs text-muted-foreground">{record.tool}</div>
        </TableCell>
        <TableCell>
          <DecisionBadge decision={record.decision} />
        </TableCell>
        <TableCell className="min-w-56 whitespace-normal">
          <div>{reasonLabel(record.reason_code)}</div>
          {record.message ? <div className="text-xs text-muted-foreground">{record.message}</div> : null}
        </TableCell>
        <TableCell className="text-right tabular-nums">{formatLatency(record.duration_ms)}</TableCell>
      </TableRow>
      {open ? (
        <TableRow className="hover:bg-transparent">
          <TableCell colSpan={7} className="whitespace-normal">
            <div className="max-w-3xl space-y-2 py-1">
              <JsonBlock value={record.arguments} label={`Arguments of ${record.tool}`} />
              <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-xs">
                <dt className="text-muted-foreground">Call id</dt>
                <dd className="font-mono wrap-anywhere">{record.tool_call_id}</dd>
                <dt className="text-muted-foreground">Arguments digest</dt>
                <dd className="font-mono wrap-anywhere">{record.args_digest}</dd>
                {record.conversation_id ? (
                  <>
                    <dt className="text-muted-foreground">Conversation</dt>
                    <dd className="font-mono wrap-anywhere">{record.conversation_id}</dd>
                  </>
                ) : null}
                {record.error_class ? (
                  <>
                    <dt className="text-muted-foreground">Error</dt>
                    <dd className="font-mono text-destructive">{record.error_class}</dd>
                  </>
                ) : null}
              </dl>
            </div>
          </TableCell>
        </TableRow>
      ) : null}
    </>
  );
}

function ToolCallAudit() {
  const [tool, setTool] = useState(ALL);
  const [decision, setDecision] = useState(ALL);
  const tools = useAdminTools();
  const filters: ToolCallAuditFilters = {
    limit: LIMIT,
    ...(tool !== ALL ? { tool } : {}),
    ...(decision !== ALL ? { decision: decision as ToolDecision } : {}),
  };
  const records = useQuery({ queryKey: queryKeys.adminToolCalls(filters), queryFn: () => listToolCallRecords(filters) });
  const toolOptions = [
    { value: ALL, label: "All tools" },
    ...(tools.data ?? []).map((item) => ({ value: item.name, label: toolLabel(item.name) })),
  ];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <FilterSelect id="audit-tool" label="Tool" value={tool} onChange={setTool} options={toolOptions} />
        <FilterSelect
          id="audit-decision"
          label="Decision"
          value={decision}
          onChange={setDecision}
          options={[
            { value: ALL, label: "All decisions" },
            { value: "allow", label: "Allowed" },
            { value: "deny", label: "Denied" },
            { value: "approval_required", label: "Approval required" },
          ]}
        />
      </div>
      {records.isPending ? (
        <LoadingRows label="Loading Tool calls" />
      ) : records.isError ? (
        <LoadError error={records.error} onRetry={() => void records.refetch()} />
      ) : records.data.length === 0 ? (
        <p className="text-sm text-muted-foreground">No Tool calls match.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>
                <span className="sr-only">Arguments</span>
              </TableHead>
              <TableHead>Time</TableHead>
              <TableHead>User</TableHead>
              <TableHead>Tool</TableHead>
              <TableHead>Decision</TableHead>
              <TableHead>Reason</TableHead>
              <TableHead className="text-right">Duration</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {records.data.map((record) => (
              <ToolCallRow key={record.id} record={record} />
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

function GuardEventAudit() {
  const [guard, setGuard] = useState(ALL);
  const filters: GuardEventAuditFilters = { limit: LIMIT, ...(guard !== ALL ? { guard } : {}) };
  const events = useQuery({ queryKey: queryKeys.adminGuardEvents(filters), queryFn: () => listGuardEventRecords(filters) });

  return (
    <div className="space-y-3">
      <FilterSelect
        id="audit-guard"
        label="Guard"
        value={guard}
        onChange={setGuard}
        options={[
          { value: ALL, label: "All guards" },
          { value: "input", label: "Input" },
          { value: "provenance", label: "Provenance" },
          { value: "output", label: "Output" },
        ]}
      />
      {events.isPending ? (
        <LoadingRows label="Loading Guard events" />
      ) : events.isError ? (
        <LoadError error={events.error} onRetry={() => void events.refetch()} />
      ) : events.data.length === 0 ? (
        <p className="text-sm text-muted-foreground">No Guard events match.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Time</TableHead>
              <TableHead>User</TableHead>
              <TableHead>Guard</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Detail</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {events.data.map((event) => (
              <TableRow key={event.id}>
                <TableCell className="text-muted-foreground tabular-nums">{formatShortDateTime(event.created_at)}</TableCell>
                <TableCell>{event.username ?? "—"}</TableCell>
                <TableCell>{humanize(event.guard)}</TableCell>
                <TableCell>
                  <Badge variant="outline" className={cn("font-normal", ACTION_STYLES[event.action])}>
                    {humanize(event.action)}
                  </Badge>
                </TableCell>
                <TableCell className="min-w-40 whitespace-normal">
                  <div className="font-mono text-xs">{event.category.replace(/,/g, ", ")}</div>
                  <div className="text-xs text-muted-foreground">{categoryPhrase(event.category)}</div>
                </TableCell>
                <TableCell className="max-w-md min-w-64 text-xs whitespace-normal wrap-anywhere text-muted-foreground">
                  {event.detail || "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

export function AuditTab() {
  const [view, setView] = useState("tool-calls");
  return (
    <Tabs value={view} onValueChange={setView}>
      <div className="space-y-1">
        <h2 className="text-base font-semibold">Audit</h2>
        <p className="text-sm text-muted-foreground">
          Every Gateway decision and every Guard action, newest first (the latest {LIMIT}).
        </p>
      </div>
      <TabsList className="mt-2">
        <TabsTrigger value="tool-calls">Tool calls</TabsTrigger>
        <TabsTrigger value="guard-events">Guard events</TabsTrigger>
      </TabsList>
      <TabsContent value="tool-calls" className="pt-3">
        <ToolCallAudit />
      </TabsContent>
      <TabsContent value="guard-events" className="pt-3">
        <GuardEventAudit />
      </TabsContent>
    </Tabs>
  );
}
