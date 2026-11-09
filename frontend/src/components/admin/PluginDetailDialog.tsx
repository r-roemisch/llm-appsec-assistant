import { ChevronRightIcon, CircleCheckIcon, RefreshCwIcon, ShieldCheckIcon, TriangleAlertIcon } from "lucide-react";
import { useId, useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";

import { PluginChangesView, PluginToolList } from "@/components/admin/PluginReview";
import { PluginStatusBadge } from "@/components/admin/PluginStatusBadge";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { LoadError, LoadingRows } from "@/components/common/QueryState";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useNow } from "@/hooks/useNow";
import { useAcceptPlugin, usePlugin, useRefreshPlugin } from "@/hooks/usePlugins";
import { ApiError, errorMessage } from "@/lib/api";
import { formatCount, formatDateTime, formatRelativeTime } from "@/lib/format";
import {
  acceptedDiffers,
  acceptHint,
  canAccept,
  canStart,
  listingMessage,
  pluginStatusExplanation,
  pluginStatusTone,
  shortDigest,
  unusableTools,
  warningCount,
  type StatusTone,
} from "@/lib/plugins";
import type { PluginDetailOut, PluginOut } from "@/lib/types";
import { cn } from "@/lib/utils";

interface PluginDetailDialogProps {
  /** The Plugin to show; null keeps the dialog closed. */
  pluginId: string | null;
  /** Its row from the list, shown while the detail loads. */
  summary: PluginOut | null;
  onClose: () => void;
}

/** One Plugin: its state, a refresh, the listed definitions and changes to review, and the accept step. */
export function PluginDetailDialog({ pluginId, summary, onClose }: PluginDetailDialogProps) {
  return (
    <Dialog
      open={pluginId !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      {pluginId ? <PluginDetails key={pluginId} pluginId={pluginId} summary={summary} /> : null}
    </Dialog>
  );
}

const CALLOUT_TONES: Record<StatusTone, string> = {
  success: "border-success/30 bg-success/5",
  warning: "border-warning/40 bg-warning/5",
  destructive: "border-destructive/30 bg-destructive/5",
  neutral: "border-border bg-muted/40",
};

function StatusCallout({ plugin }: { plugin: PluginOut }) {
  return (
    <div className={cn("space-y-1 rounded-lg border px-3 py-2.5 text-sm", CALLOUT_TONES[pluginStatusTone(plugin.status)])}>
      <p>{pluginStatusExplanation(plugin)}</p>
      {plugin.status === "invalid" && plugin.catalog_error ? (
        <p className="text-destructive wrap-anywhere">Catalog entry: {plugin.catalog_error}</p>
      ) : null}
      {plugin.last_error ? <p className="text-destructive wrap-anywhere">Last error: {plugin.last_error}</p> : null}
      {plugin.status === "ok" && plugin.enabled ? (
        <Link
          to="/admin?tab=tools"
          className="inline-flex items-center gap-0.5 font-medium text-primary underline decoration-primary/40 underline-offset-3 hover:decoration-primary"
        >
          Open the Tools tab
          <ChevronRightIcon aria-hidden="true" className="size-3.5" />
        </Link>
      ) : null}
    </div>
  );
}

function Facts({ plugin, now }: { plugin: PluginDetailOut; now: number }) {
  return (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-sm">
      <dt className="text-muted-foreground">Enabled</dt>
      <dd>
        {plugin.enabled ? "Yes" : "No"}
        {!plugin.enabled && plugin.accepted_tools_digest ? (
          <span className="text-muted-foreground">: its Tools are blocked</span>
        ) : null}
      </dd>
      <dt className="text-muted-foreground">Last listed</dt>
      <dd title={plugin.last_seen ? formatDateTime(plugin.last_seen) : undefined}>
        {plugin.last_seen
          ? `${formatRelativeTime(plugin.last_seen, now)}, ${formatCount(plugin.tool_count, "Tool")}`
          : "Never"}
      </dd>
      <dt className="text-muted-foreground">Accepted</dt>
      <dd>
        {plugin.accepted_at ? (
          <span title={formatDateTime(plugin.accepted_at)}>
            {formatRelativeTime(plugin.accepted_at, now)}
            {plugin.accepted_by ? ` by ${plugin.accepted_by}` : ""}
          </span>
        ) : (
          "Never"
        )}
      </dd>
      <dt className="text-muted-foreground">Digests</dt>
      <dd className="flex flex-wrap gap-x-3 font-mono text-xs leading-5">
        <span title={plugin.current_tools_digest ?? undefined}>listed {shortDigest(plugin.current_tools_digest)}</span>
        <span title={plugin.accepted_tools_digest ?? undefined}>accepted {shortDigest(plugin.accepted_tools_digest)}</span>
      </dd>
      {plugin.command ? (
        <>
          <dt className="text-muted-foreground">Command</dt>
          <dd className="min-w-0 space-y-0.5">
            <code className="block font-mono text-xs leading-relaxed text-muted-foreground wrap-anywhere">
              {plugin.command}
            </code>
            <span className="block text-xs text-muted-foreground">
              From plugins/catalog.yaml on the server; read-only.
            </span>
          </dd>
        </>
      ) : null}
    </dl>
  );
}

/** What accepting means, named before the admin confirms: how many definitions, which warnings, what follows. */
function AcceptSummary({ plugin }: { plugin: PluginDetailOut }) {
  const tools = plugin.current_tools;
  const warnings = warningCount(tools);
  const flagged = tools.filter((tool) => tool.warnings.length > 0);
  const unusable = unusableTools(tools);
  return (
    <div className="space-y-3 text-sm">
      {warnings > 0 ? (
        <div className="space-y-1.5 rounded-md border border-warning/40 bg-warning/10 px-3 py-2">
          <p className="flex items-start gap-1.5 font-medium">
            <TriangleAlertIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-warning" />
            <span className="min-w-0 wrap-anywhere">
              {formatCount(warnings, "warning")} in{" "}
              <span className="font-mono">{flagged.map((tool) => tool.name).join(", ")}</span>
            </span>
          </p>
          <ul aria-label="Warnings to accept" className="max-h-56 space-y-1 overflow-y-auto text-xs">
            {flagged.flatMap((tool) =>
              tool.warnings.map((warning, index) => (
                <li key={`${tool.name}:${index}`} className="wrap-anywhere">
                  <span className="font-mono">{tool.name}</span>: {warning}
                </li>
              )),
            )}
          </ul>
        </div>
      ) : (
        <p className="flex items-center gap-1.5 text-muted-foreground">
          <CircleCheckIcon aria-hidden="true" className="size-4 text-success" />
          No warnings.
        </p>
      )}
      {unusable.length > 0 ? (
        <p className="text-xs text-destructive wrap-anywhere">
          {formatCount(unusable.length, "definition")} cannot be offered (bad name or schema) and will not be usable:{" "}
          <span className="font-mono">{unusable.map((tool) => tool.name).join(", ")}</span>
        </p>
      ) : null}
      <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
        {plugin.status === "drifted" ? (
          <li>
            This replaces the definitions accepted
            {plugin.accepted_by ? ` by ${plugin.accepted_by}` : ""}
            {plugin.accepted_at ? ` on ${formatDateTime(plugin.accepted_at)}` : ""} and ends the drift block.
          </li>
        ) : null}
        <li>Accepted Tools appear on the Tools tab; new ones start disabled, to be enabled one by one.</li>
        <li>Every call still needs an Approval: the requester's, unless you require an administrator's there.</li>
        {!plugin.enabled ? <li>The Plugin is disabled: its Tools stay blocked until you enable it.</li> : null}
      </ul>
    </div>
  );
}

function DetailBody({
  plugin,
  refreshing,
  onRefresh,
}: {
  plugin: PluginDetailOut;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const now = useNow();
  const headingId = useId();
  const showChanges = acceptedDiffers(plugin);

  return (
    <>
      <StatusCallout plugin={plugin} />

      <section aria-label="Plugin state" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-medium">State</h3>
          <Button variant="outline" size="sm" disabled={refreshing || !canStart(plugin)} onClick={onRefresh}>
            <RefreshCwIcon aria-hidden="true" className={cn(refreshing && "animate-spin")} />
            {refreshing ? "Listing Tools…" : "Refresh"}
          </Button>
        </div>
        <Facts plugin={plugin} now={now} />
        <p className="text-xs text-muted-foreground">
          Refresh starts the server and lists its Tools again; it takes about a second.
        </p>
      </section>

      {showChanges ? (
        <section aria-labelledby={`${headingId}-changes`} className="space-y-2">
          <h3 id={`${headingId}-changes`} className="text-sm font-medium">
            Changes since acceptance
          </h3>
          <PluginChangesView detail={plugin} />
        </section>
      ) : null}

      <section aria-labelledby={`${headingId}-current`} className="space-y-2">
        <div>
          <h3 id={`${headingId}-current`} className="text-sm font-medium">
            Current definitions
          </h3>
          <p className="text-xs text-muted-foreground">
            The last listing, as the server sent it. Titles, descriptions and schemas come from the Plugin: read them as
            untrusted text.
          </p>
        </div>
        {plugin.current_tools.length > 0 ? (
          <PluginToolList
            tools={plugin.current_tools}
            label="Current definitions"
            changes={showChanges ? plugin.changes : null}
          />
        ) : (
          <p className="rounded-lg border border-dashed px-3 py-4 text-center text-sm text-muted-foreground">
            {plugin.current_tools_digest ? "The server listed no Tools." : "No Tools listed yet."}
          </p>
        )}
      </section>

      {showChanges && plugin.accepted_tools.length > 0 ? (
        <details className="group/accepted space-y-2">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded-sm text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring/50 [&::-webkit-details-marker]:hidden">
            <ChevronRightIcon aria-hidden="true" className="size-4 transition-transform group-open/accepted:rotate-90" />
            Accepted definitions ({plugin.accepted_tools.length})
          </summary>
          <p className="text-xs text-muted-foreground">
            What was accepted
            {plugin.accepted_by ? ` by ${plugin.accepted_by}` : ""}
            {plugin.accepted_at ? ` on ${formatDateTime(plugin.accepted_at)}` : ""}.
          </p>
          <PluginToolList tools={plugin.accepted_tools} label="Accepted definitions" />
        </details>
      ) : null}
    </>
  );
}

function PluginDetails({ pluginId, summary }: { pluginId: string; summary: PluginOut | null }) {
  const detail = usePlugin(pluginId);
  const refresh = useRefreshPlugin(pluginId);
  const accept = useAcceptPlugin(pluginId);
  // The digest of the definitions on screen when the admin chose to accept; null while not confirming.
  const [confirmDigest, setConfirmDigest] = useState<string | null>(null);
  const [acceptError, setAcceptError] = useState<string | null>(null);
  // Set when an accept answered 409: the definitions changed since the review.
  const [changedAgain, setChangedAgain] = useState(false);
  const data = detail.data;
  const plugin: PluginOut | null = data ?? summary;
  const title = plugin?.title ?? pluginId;
  const acceptable = data ? canAccept(data) : false;
  const count = data?.current_tools.length ?? summary?.tool_count ?? 0;

  function onRefresh() {
    refresh.mutate(undefined, {
      onSuccess: (updated) => {
        setChangedAgain(false);
        const message = listingMessage(updated);
        toast[message.tone](`${updated.title}: ${message.text}`);
      },
      onError: (err) => toast.error(`${title}: ${errorMessage(err)}`),
    });
  }

  function startAccept() {
    if (!data?.current_tools_digest || !canAccept(data)) return;
    setAcceptError(null);
    setConfirmDigest(data.current_tools_digest);
  }

  function confirmAccept() {
    if (!confirmDigest) return;
    accept.mutate(confirmDigest, {
      onSuccess: (updated) => {
        setConfirmDigest(null);
        setChangedAgain(false);
        toast.success(
          `${updated.title}: ${formatCount(updated.current_tools.length, "Tool definition")} accepted. ${
            updated.enabled ? "Enable its Tools on the Tools tab." : "Enable the Plugin, then its Tools on the Tools tab."
          }`,
        );
      },
      onError: (err) => {
        if (err instanceof ApiError && err.status === 409) {
          // The hook fetches the detail again; the admin reviews what is current now.
          setConfirmDigest(null);
          setChangedAgain(true);
          toast.error(`${title}: nothing was accepted, the definitions changed since your review.`);
        } else {
          setAcceptError(errorMessage(err));
        }
      },
    });
  }

  return (
    <DialogContent className="flex max-h-[90dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl">
      <DialogHeader className="gap-1.5 border-b px-4 pt-4 pr-12 pb-3">
        <DialogTitle className="flex flex-wrap items-center gap-x-2 gap-y-1 leading-snug">
          <span className="min-w-0 break-words">{title}</span>
          {plugin ? <PluginStatusBadge status={plugin.status} /> : null}
        </DialogTitle>
        <DialogDescription className="wrap-anywhere">
          <span className="font-mono text-xs">{pluginId}</span>
          {plugin?.description ? ` · ${plugin.description}` : null}
        </DialogDescription>
      </DialogHeader>

      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-4 py-4">
        {detail.isPending ? (
          <LoadingRows rows={4} label="Loading the Plugin" />
        ) : detail.isError ? (
          detail.error instanceof ApiError && detail.error.status === 404 ? (
            <p role="alert" className="text-sm text-destructive">
              There is no Plugin {pluginId}: it is neither in the catalog nor stored.
            </p>
          ) : (
            <LoadError error={detail.error} onRetry={() => void detail.refetch()} />
          )
        ) : (
          <DetailBody plugin={detail.data} refreshing={refresh.isPending} onRefresh={onRefresh} />
        )}
      </div>

      <DialogFooter className="mx-0 mb-0 flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 space-y-1 text-xs">
          {changedAgain ? (
            <p role="alert" className="font-medium text-destructive">
              The Tool definitions changed since you opened this review, so nothing was accepted. Review the current
              definitions above{acceptable ? " and accept again." : "."}
            </p>
          ) : null}
          {data ? <p className="text-muted-foreground">{acceptHint(data)}</p> : null}
        </div>
        <Button className="shrink-0" disabled={!acceptable || accept.isPending} onClick={startAccept}>
          <ShieldCheckIcon aria-hidden="true" />
          Accept {formatCount(count, "definition")}…
        </Button>
      </DialogFooter>

      {data ? (
        <ConfirmDialog
          open={confirmDigest !== null}
          onOpenChange={(open) => {
            if (!open) setConfirmDigest(null);
          }}
          title={`Accept ${formatCount(count, "Tool definition")} from ${data.title}?`}
          description={
            <>
              Exactly the definitions shown are accepted (digest{" "}
              <span className="font-mono">{shortDigest(confirmDigest)}</span>). If they changed in the meantime, nothing
              is accepted.
            </>
          }
          error={acceptError}
          confirmLabel={`Accept ${formatCount(count, "definition")}`}
          pending={accept.isPending}
          onConfirm={confirmAccept}
          className="sm:max-w-md"
        >
          <AcceptSummary plugin={data} />
        </ConfirmDialog>
      ) : null}
    </DialogContent>
  );
}
