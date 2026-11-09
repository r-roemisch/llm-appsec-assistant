import {
  CircleCheckIcon,
  CircleDashedIcon,
  CircleOffIcon,
  OctagonXIcon,
  ShieldAlertIcon,
  TriangleAlertIcon,
  type LucideIcon,
} from "lucide-react";

import { pluginStatusLabel, pluginStatusTone, type StatusTone } from "@/lib/plugins";
import type { PluginStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

const TONES: Record<StatusTone, string> = {
  success: "border-success/30 bg-success/10 text-success",
  warning: "border-warning/40 bg-warning/10 text-warning",
  destructive: "border-destructive/30 bg-destructive/10 text-destructive",
  neutral: "border-border bg-muted text-muted-foreground",
};

const ICONS: Record<PluginStatus, LucideIcon> = {
  ok: CircleCheckIcon,
  pending_review: ShieldAlertIcon,
  drifted: OctagonXIcon,
  error: TriangleAlertIcon,
  new: CircleDashedIcon,
  missing: CircleOffIcon,
  invalid: CircleOffIcon,
};

/** A Plugin's status as a word and a colour; never colour alone. */
export function PluginStatusBadge({ status, className }: { status: PluginStatus; className?: string }) {
  const Icon = ICONS[status] ?? CircleDashedIcon;
  return (
    <span
      data-status={status}
      className={cn(
        "inline-flex h-5 shrink-0 items-center gap-1 rounded-full border px-2 text-xs font-medium whitespace-nowrap",
        TONES[pluginStatusTone(status)],
        className,
      )}
    >
      <Icon aria-hidden="true" className="size-3" />
      {pluginStatusLabel(status)}
    </span>
  );
}
