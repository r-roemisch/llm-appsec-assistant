import { PuzzleIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Marks a Tool that a Plugin contributes (M5): "Plugin fixture_docs". Neutral
 * on purpose; the cards around it say what a Plugin is and how far to trust it.
 */
export function PluginBadge({ pluginId, label, className }: { pluginId: string; label?: string; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 max-w-full min-w-0 shrink-0 items-center gap-1 rounded-full border border-border bg-muted px-2 text-xs font-medium text-foreground",
        className,
      )}
    >
      <PuzzleIcon aria-hidden="true" className="size-3 shrink-0 text-muted-foreground" />
      <span className="truncate">{label ?? `Plugin ${pluginId}`}</span>
    </span>
  );
}
