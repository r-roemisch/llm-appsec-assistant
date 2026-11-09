import { targetProfileLabel } from "@/lib/labels";
import type { TargetProfile } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * What the owner recorded a Target is running. Deliberately neutral (no
 * green/red, no shield): it is an expectation, not a test result, so it must
 * not look like the verdict badge an injection run shows.
 */
export function ExpectedProfileBadge({ value, className }: { value: TargetProfile | null; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center rounded-full border border-border bg-muted px-2 text-xs font-medium whitespace-nowrap text-muted-foreground",
        className,
      )}
    >
      {value ? `Expects ${targetProfileLabel(value).toLowerCase()}` : "Profile not set"}
    </span>
  );
}
