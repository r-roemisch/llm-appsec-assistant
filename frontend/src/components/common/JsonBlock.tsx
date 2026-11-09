import { formatArguments } from "@/lib/tools";
import { cn } from "@/lib/utils";

/** Tool arguments as pretty JSON; long values wrap instead of widening the page. */
export function JsonBlock({ value, className, label }: { value: Record<string, unknown>; className?: string; label?: string }) {
  return (
    <pre
      aria-label={label}
      className={cn(
        "max-h-64 overflow-auto rounded-md border bg-muted/50 px-3 py-2 font-mono text-xs leading-relaxed whitespace-pre-wrap wrap-anywhere",
        className,
      )}
    >
      {formatArguments(value)}
    </pre>
  );
}
