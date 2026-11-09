import { ShieldAlertIcon, ShieldCheckIcon } from "lucide-react";

import { targetProfileLabel } from "@/lib/labels";
import type { TargetProfile } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * An injection run's verdict, green for secure and red for vulnerable. Only for
 * results: a Target's recorded (expected) profile uses ExpectedProfileBadge,
 * so an expectation never looks like a test outcome.
 */
export function SecurityBadge({
  value,
  label,
  className,
}: {
  value: TargetProfile;
  label?: string;
  className?: string;
}) {
  const secure = value === "secure";
  const Icon = secure ? ShieldCheckIcon : ShieldAlertIcon;
  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center gap-1 rounded-full border px-2 text-xs font-medium whitespace-nowrap",
        secure ? "border-success/30 bg-success/10 text-success" : "border-destructive/30 bg-destructive/10 text-destructive",
        className,
      )}
    >
      <Icon aria-hidden="true" className="size-3" />
      {label ?? targetProfileLabel(value)}
    </span>
  );
}
