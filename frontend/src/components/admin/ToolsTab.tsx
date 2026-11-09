import { BanIcon } from "lucide-react";
import { useId, useState, type KeyboardEvent } from "react";
import { Link } from "react-router";
import { toast } from "sonner";

import { PluginBadge } from "@/components/common/PluginBadge";
import { LoadError, LoadingRows } from "@/components/common/QueryState";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAdminTools, useUpdateTool } from "@/hooks/useAdmin";
import { parseRateLimit } from "@/lib/admin-settings";
import { errorMessage } from "@/lib/api";
import { blockedText } from "@/lib/plugins";
import { costClassLabel, toolLabel, toolPluginId, toolShortLabel } from "@/lib/tools";
import type { Approver, ToolOut, ToolPolicyPatch } from "@/lib/types";

/** Why a Plugin Tool cannot run (M5), and where that is fixed; its own switch does not unblock it. */
function BlockedNotice({ id, block, pluginId }: { id: string; block: string; pluginId: string | null }) {
  const { label, hint } = blockedText(block);
  return (
    <div className="mt-1.5 max-w-sm space-y-1">
      <Badge variant="destructive" className="font-medium">
        <BanIcon aria-hidden="true" />
        {label}
      </Badge>
      <p id={id} className="text-xs text-muted-foreground">
        {hint}
        {pluginId ? (
          <>
            {" "}
            <Link
              to={`/admin?tab=plugins&plugin=${encodeURIComponent(pluginId)}`}
              className="font-medium text-primary underline decoration-primary/40 underline-offset-3 hover:decoration-primary"
            >
              Open {pluginId} on the Plugins tab
            </Link>
          </>
        ) : null}
      </p>
    </div>
  );
}

function ToolRow({ tool }: { tool: ToolOut }) {
  const pluginId = toolPluginId(tool.name, tool.contributed_by);
  const label = toolLabel(tool.name, tool.contributed_by);
  const blockedId = useId();
  const current = tool.rate_limit_per_hour === null ? "" : String(tool.rate_limit_per_hour);
  const [rateLimit, setRateLimit] = useState(current);
  const [error, setError] = useState<string | null>(null);
  const update = useUpdateTool(tool.name);

  function save(patch: ToolPolicyPatch, done: string) {
    setError(null);
    update.mutate(patch, {
      onSuccess: (updated) => {
        // "Default" may resolve to the value that was already shown.
        setRateLimit(updated.rate_limit_per_hour === null ? "" : String(updated.rate_limit_per_hour));
        toast.success(done);
      },
      onError: (err) => {
        setError(errorMessage(err));
        toast.error(`${label}: ${errorMessage(err)}`);
      },
    });
  }

  function commitRateLimit() {
    if (rateLimit.trim() === current) return;
    const parsed = parseRateLimit(rateLimit);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    save(
      { rate_limit_per_hour: parsed.value },
      parsed.value === null ? `${label}: rate limit back to its default` : `${label}: at most ${parsed.value} calls per hour`,
    );
  }

  function onRateLimitKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      commitRateLimit();
    } else if (event.key === "Escape") {
      setRateLimit(current);
      setError(null);
    }
  }

  return (
    <TableRow>
      <TableCell className="min-w-56 whitespace-normal">
        {pluginId ? (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-medium">{toolShortLabel(tool.name)}</span>
            <PluginBadge pluginId={pluginId} label={`Plugin: ${pluginId}`} />
          </div>
        ) : (
          <div className="font-medium">{label}</div>
        )}
        <div className="font-mono text-xs text-muted-foreground wrap-anywhere">{tool.name}</div>
        {tool.description ? (
          <p className="mt-0.5 line-clamp-2 max-w-sm text-xs text-muted-foreground wrap-anywhere" title={tool.description}>
            {tool.description}
          </p>
        ) : null}
        {tool.blocked ? <BlockedNotice id={blockedId} block={tool.blocked} pluginId={pluginId} /> : null}
        {error ? (
          <p role="alert" className="mt-1 max-w-sm text-xs text-destructive">
            {error}
          </p>
        ) : null}
      </TableCell>
      <TableCell>
        {tool.requires_approval ? (
          <Badge variant="outline" className="border-warning/40 font-normal text-warning">
            Requires approval
          </Badge>
        ) : (
          <span className="text-xs text-muted-foreground">No approval</span>
        )}
      </TableCell>
      <TableCell>
        <Select
          value={tool.approver}
          onValueChange={(value) =>
            save({ approver: value as Approver }, `${label}: ${value === "admin" ? "an administrator" : "the requester"} approves`)
          }
          disabled={!tool.requires_approval || update.isPending}
        >
          <SelectTrigger
            size="sm"
            aria-label={`Approver for ${label}`}
            title={tool.requires_approval ? undefined : "Only used by tools that require approval"}
            className="w-32"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper" align="start">
            <SelectItem value="requester">Requester</SelectItem>
            <SelectItem value="admin">Administrator</SelectItem>
          </SelectContent>
        </Select>
      </TableCell>
      <TableCell>
        <Input
          type="number"
          inputMode="numeric"
          min={1}
          step={1}
          placeholder="Default"
          aria-label={`Rate limit per hour for ${label}`}
          aria-invalid={error ? true : undefined}
          value={rateLimit}
          onChange={(event) => setRateLimit(event.target.value)}
          onBlur={commitRateLimit}
          onKeyDown={onRateLimitKeyDown}
          disabled={update.isPending}
          className="h-7 w-24"
        />
      </TableCell>
      <TableCell>
        <Badge variant="secondary" className="font-normal">
          {costClassLabel(tool.cost_class)}
        </Badge>
      </TableCell>
      <TableCell className="font-mono text-xs text-muted-foreground">{tool.contributed_by}</TableCell>
      <TableCell className="text-right">
        <Switch
          checked={tool.enabled}
          disabled={update.isPending}
          aria-label={`${label} enabled`}
          aria-describedby={tool.blocked ? blockedId : undefined}
          onCheckedChange={(enabled) =>
            save(
              { enabled },
              `${label} ${enabled ? "enabled" : "disabled"}${enabled && tool.blocked ? `, but still ${blockedText(tool.blocked).label.toLowerCase()}` : ""}`,
            )
          }
        />
      </TableCell>
    </TableRow>
  );
}

export function ToolsTab() {
  const tools = useAdminTools();

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-base font-semibold">Tools</h2>
        <p className="text-sm text-muted-foreground">
          Every Tool call passes the Gateway, which applies these settings. A disabled Tool is never offered to the
          Model. Leave the rate limit empty for the Tool's default; press Enter or leave the field to save it.
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          Plugin Tools appear here once their definitions are accepted on the Plugins tab. They start disabled and every
          call needs an Approval; a blocked one cannot run, whatever its switch says.
        </p>
      </div>
      {tools.isPending ? (
        <LoadingRows label="Loading Tools" />
      ) : tools.isError ? (
        <LoadError error={tools.error} onRetry={() => void tools.refetch()} />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Tool</TableHead>
              <TableHead>Approval</TableHead>
              <TableHead>Approver</TableHead>
              <TableHead>Rate limit / hour</TableHead>
              <TableHead>Cost</TableHead>
              <TableHead>Contributed by</TableHead>
              <TableHead className="text-right">Enabled</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tools.data.map((tool) => (
              <ToolRow key={tool.name} tool={tool} />
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
}
