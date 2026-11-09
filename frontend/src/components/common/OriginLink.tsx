import { ExternalLinkIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Where a Source comes from: a link only for https URLs, opened in a new tab
 * without referrer or opener; repository paths and file names stay text.
 */
export function OriginLink({ origin, className }: { origin: string; className?: string }) {
  if (origin.startsWith("https://")) {
    return (
      <a
        href={origin}
        target="_blank"
        rel="noopener noreferrer"
        className={cn(
          "text-primary underline decoration-primary/40 underline-offset-3 wrap-anywhere hover:decoration-primary",
          className,
        )}
      >
        {origin}
        <ExternalLinkIcon aria-hidden="true" className="ml-1 inline size-3 align-[-1px]" />
      </a>
    );
  }
  return <span className={cn("font-mono text-xs text-muted-foreground wrap-anywhere", className)}>{origin}</span>;
}
