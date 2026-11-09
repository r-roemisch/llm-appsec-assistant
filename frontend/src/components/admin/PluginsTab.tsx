import { LoaderCircleIcon, OctagonXIcon } from "lucide-react";
import { useId } from "react";
import { useSearchParams } from "react-router";
import { toast } from "sonner";

import { PluginDetailDialog } from "@/components/admin/PluginDetailDialog";
import { PluginStatusBadge } from "@/components/admin/PluginStatusBadge";
import { LoadError, LoadingRows } from "@/components/common/QueryState";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useNow } from "@/hooks/useNow";
import { usePlugins, useSetPluginEnabled } from "@/hooks/usePlugins";
import { errorMessage } from "@/lib/api";
import { formatCount, formatDateTime, formatRelativeTime } from "@/lib/format";
import { canStart, listingMessage, needsReview } from "@/lib/plugins";
import type { PluginOut } from "@/lib/types";

const STEPS = [
  { title: "Enable", text: "starts the Plugin's server and lists its Tools. That alone contributes nothing." },
  { title: "Review and accept", text: "the listed definitions, warnings first. Only accepted definitions are offered." },
  {
    title: "Enable each Tool",
    text: "on the Tools tab, where accepted Tools start disabled. Every call needs the requester's Approval.",
  },
  {
    title: "Drift blocks use:",
    text: "when a later listing differs from what you accepted, the Plugin's Tools stop until you review the changes and accept again.",
  },
] as const;

function Intro() {
  return (
    <div className="space-y-3">
      <p className="max-w-prose text-sm text-muted-foreground">
        A Plugin is an MCP server that contributes Tools: third-party code that runs on the Rampart server. Plugins and
        the commands that start them are defined only in{" "}
        <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs text-foreground">plugins/catalog.yaml</code> on
        the server; this page cannot add a Plugin or change a command.
      </p>
      <ol aria-label="How Plugins work" className="grid gap-x-6 gap-y-2.5 rounded-xl border bg-muted/40 p-3.5 text-sm sm:grid-cols-2">
        {STEPS.map((step, index) => (
          <li key={step.title} className="flex gap-2.5">
            <span
              aria-hidden="true"
              className="flex size-5 shrink-0 items-center justify-center rounded-full bg-background text-xs font-semibold tabular-nums ring-1 ring-border"
            >
              {index + 1}
            </span>
            <p className="min-w-0 text-muted-foreground">
              <span className="font-medium text-foreground">{step.title}</span> {step.text}
            </p>
          </li>
        ))}
      </ol>
    </div>
  );
}

function PluginRow({ plugin, onOpen }: { plugin: PluginOut; onOpen: (id: string) => void }) {
  const toggle = useSetPluginEnabled(plugin.id);
  const switchId = useId();
  const now = useNow();
  // While the change is saved, the switch shows the state asked for.
  const checked = toggle.isPending ? toggle.variables === true : plugin.enabled;
  const startable = canStart(plugin);

  function onToggle(enabled: boolean) {
    toggle.mutate(enabled, {
      onSuccess: (updated) => {
        if (!enabled) {
          toast.success(`${updated.title} disabled.${updated.accepted_tools_digest ? " Its Tools are blocked." : ""}`);
          return;
        }
        const message = listingMessage(updated);
        toast[message.tone](`${updated.title} enabled. ${message.text}`);
      },
      onError: (err) => toast.error(`${plugin.title}: ${errorMessage(err)}`),
    });
  }

  return (
    <li
      aria-label={plugin.title}
      className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-start sm:justify-between"
    >
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <h3 className="font-medium break-words">{plugin.title}</h3>
          <PluginStatusBadge status={plugin.status} />
        </div>
        <p className="font-mono text-xs text-muted-foreground wrap-anywhere">{plugin.id}</p>
        {plugin.description ? (
          <p className="max-w-prose text-sm text-muted-foreground wrap-anywhere">{plugin.description}</p>
        ) : null}
        <p className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
          <span>{plugin.current_tools_digest ? formatCount(plugin.tool_count, "Tool") : "No Tools listed"}</span>
          <span title={plugin.last_seen ? formatDateTime(plugin.last_seen) : undefined}>
            {plugin.last_seen ? `Last listed ${formatRelativeTime(plugin.last_seen, now)}` : "Never listed"}
          </span>
          {plugin.accepted_at ? (
            <span title={formatDateTime(plugin.accepted_at)}>
              Accepted {plugin.accepted_by ? `by ${plugin.accepted_by} ` : ""}
              {formatRelativeTime(plugin.accepted_at, now)}
            </span>
          ) : null}
        </p>
        {plugin.status === "invalid" && plugin.catalog_error ? (
          <p className="text-xs text-destructive wrap-anywhere">Catalog entry: {plugin.catalog_error}</p>
        ) : null}
        {plugin.last_error ? (
          <p className="text-xs text-destructive wrap-anywhere">Last error: {plugin.last_error}</p>
        ) : null}
        {plugin.command ? (
          <div className="pt-0.5 text-xs text-muted-foreground">
            <span>Command, from the catalog file (read-only)</span>
            <code className="mt-0.5 block font-mono text-[0.6875rem] leading-relaxed wrap-anywhere">{plugin.command}</code>
          </div>
        ) : null}
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 sm:flex-col sm:items-end">
        <div className="flex items-center gap-2">
          <Switch
            id={switchId}
            checked={checked}
            disabled={toggle.isPending || (!plugin.enabled && !startable)}
            aria-label={`${plugin.title} enabled`}
            title={!plugin.enabled && !startable ? "Only a Plugin with a valid catalog entry can be enabled" : undefined}
            onCheckedChange={onToggle}
          />
          <label htmlFor={switchId} className="inline-flex items-center gap-1.5 text-sm">
            {toggle.isPending ? (
              <>
                <LoaderCircleIcon aria-hidden="true" className="size-3.5 animate-spin text-muted-foreground" />
                {toggle.variables ? "Listing Tools…" : "Disabling…"}
              </>
            ) : (
              "Enabled"
            )}
          </label>
        </div>
        <Button variant={needsReview(plugin) ? "default" : "outline"} size="sm" onClick={() => onOpen(plugin.id)}>
          {plugin.status === "drifted"
            ? "Review changes"
            : plugin.status === "pending_review"
              ? "Review definitions"
              : "Details"}
        </Button>
      </div>
    </li>
  );
}

/**
 * The Plugin catalog (M5): each Plugin's status, enable and disable, and a
 * detail to refresh, review and accept its Tool definitions. The open Plugin
 * is kept in the URL (`?plugin=<id>`), so other tabs can link to it.
 */
export function PluginsTab() {
  const plugins = usePlugins();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedId = searchParams.get("plugin");
  const selected = plugins.data?.plugins.find((plugin) => plugin.id === selectedId) ?? null;

  function select(id: string | null) {
    setSearchParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        if (id) next.set("plugin", id);
        else next.delete("plugin");
        return next;
      },
      { replace: true },
    );
  }

  return (
    <section className="space-y-4">
      <div className="space-y-2">
        <h2 className="text-base font-semibold">Plugins</h2>
        <Intro />
      </div>

      {plugins.data?.catalog_error ? (
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm"
        >
          <OctagonXIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-destructive" />
          <div className="min-w-0 space-y-0.5">
            <p className="font-medium text-destructive">The catalog file could not be read</p>
            <p className="wrap-anywhere">{plugins.data.catalog_error}</p>
            <p className="text-muted-foreground">
              Until plugins/catalog.yaml is fixed on the server, every Plugin counts as not in the catalog and its Tools
              are blocked.
            </p>
          </div>
        </div>
      ) : null}

      {plugins.isPending ? (
        <LoadingRows label="Loading Plugins" />
      ) : plugins.isError ? (
        <LoadError error={plugins.error} onRetry={() => void plugins.refetch()} />
      ) : plugins.data.plugins.length === 0 ? (
        <div className="rounded-xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
          <p className="font-medium text-foreground">No Plugins in the catalog</p>
          <p className="mt-1">Plugins are added to plugins/catalog.yaml on the server; the file is read again when it changes.</p>
        </div>
      ) : (
        <ul aria-label="Plugins" className="divide-y rounded-xl border bg-card">
          {plugins.data.plugins.map((plugin) => (
            <PluginRow key={plugin.id} plugin={plugin} onOpen={select} />
          ))}
        </ul>
      )}

      <PluginDetailDialog pluginId={selectedId} summary={selected} onClose={() => select(null)} />
    </section>
  );
}
