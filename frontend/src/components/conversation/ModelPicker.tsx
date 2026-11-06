import { ProviderBadge, TierBadge } from "@/components/common/ModelBadges";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Kind, ModelOut } from "@/lib/types";
import { cn } from "@/lib/utils";

interface ModelPickerProps {
  models: ModelOut[];
  value: string | null;
  onChange: (modelId: string) => void;
  /** Only Models of this kind are offered. */
  kind?: Kind;
  disabled?: boolean;
  className?: string;
  id?: string;
  "aria-label"?: string;
}

/**
 * A select of enabled Models of one kind (chat by default). The current value
 * stays visible even if an admin disabled that Model in the meantime.
 */
export function ModelPicker({
  models,
  value,
  onChange,
  kind = "chat",
  disabled,
  className,
  id,
  "aria-label": ariaLabel = "Model",
}: ModelPickerProps) {
  const options = models.filter((model) => model.kind === kind && model.enabled);
  const current = value ? models.find((model) => model.id === value) : undefined;
  const items = current && !options.includes(current) ? [...options, current] : options;

  return (
    <Select value={value ?? undefined} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger id={id} size="sm" aria-label={ariaLabel} className={cn("max-w-56", className)}>
        <SelectValue placeholder="Choose a Model" />
      </SelectTrigger>
      <SelectContent position="popper" align="start" className="min-w-64">
        {items.map((model) => (
          <SelectItem
            key={model.id}
            value={model.id}
            textValue={model.display_name}
            trailing={
              <>
                <ProviderBadge provider={model.provider} />
                <TierBadge tier={model.tier} />
                {!model.enabled ? <span className="text-xs text-muted-foreground">disabled</span> : null}
                {!model.available ? <span className="text-xs text-muted-foreground">unavailable</span> : null}
              </>
            }
          >
            {model.display_name}
          </SelectItem>
        ))}
        {items.length === 0 ? (
          <div className="px-2 py-1.5 text-sm text-muted-foreground">No enabled Models</div>
        ) : null}
      </SelectContent>
    </Select>
  );
}
