import { Badge } from "@/components/ui/badge";
import { providerLabel, tierLabel } from "@/lib/labels";
import type { Provider, Role, Tier } from "@/lib/types";
import { cn } from "@/lib/utils";

export function ProviderBadge({ provider }: { provider: Provider }) {
  return (
    <Badge variant="outline" className="font-normal">
      {providerLabel(provider)}
    </Badge>
  );
}

export function TierBadge({ tier }: { tier: Tier }) {
  return (
    <Badge variant="secondary" className="font-normal">
      {tierLabel(tier)}
    </Badge>
  );
}

export function RoleBadge({ role }: { role: Role }) {
  return (
    <Badge variant={role === "admin" ? "default" : "outline"} className="font-normal">
      {role === "admin" ? "Admin" : "User"}
    </Badge>
  );
}

/** A dot plus a word; never colour alone. */
export function AvailabilityMark({ available }: { available: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-sm">
      <span
        aria-hidden="true"
        className={cn("size-1.5 rounded-full", available ? "bg-success" : "bg-muted-foreground/40")}
      />
      <span className={available ? undefined : "text-muted-foreground"}>
        {available ? "Available" : "Unavailable"}
      </span>
    </span>
  );
}
