import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { SlotsSection } from "@/components/admin/SlotsSection";
import { AvailabilityMark, ProviderBadge, TierBadge } from "@/components/common/ModelBadges";
import { LoadError, LoadingRows } from "@/components/common/QueryState";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useModels } from "@/hooks/useModels";
import { errorMessage, setModelEnabled } from "@/lib/api";
import { kindLabel } from "@/lib/labels";
import { queryKeys } from "@/lib/query-keys";
import type { ModelOut, ModelsOut } from "@/lib/types";

function ModelTable({ models }: { models: ModelOut[] }) {
  const queryClient = useQueryClient();

  const toggle = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => setModelEnabled(id, enabled),
    onMutate: async ({ id, enabled }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.models });
      const previous = queryClient.getQueryData<ModelsOut>(queryKeys.models);
      queryClient.setQueryData<ModelsOut>(queryKeys.models, (old) =>
        old ? { ...old, models: old.models.map((model) => (model.id === id ? { ...model, enabled } : model)) } : old,
      );
      return { previous };
    },
    onSuccess: (updated) => {
      queryClient.setQueryData<ModelsOut>(queryKeys.models, (old) =>
        old ? { ...old, models: old.models.map((model) => (model.id === updated.id ? updated : model)) } : old,
      );
    },
    onError: (err, _variables, context) => {
      if (context?.previous) queryClient.setQueryData(queryKeys.models, context.previous);
      toast.error(errorMessage(err));
    },
  });

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Model</TableHead>
          <TableHead>Provider</TableHead>
          <TableHead>Kind</TableHead>
          <TableHead>Tier</TableHead>
          <TableHead>Availability</TableHead>
          <TableHead className="text-right">Enabled</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {models.map((model) => (
          <TableRow key={model.id}>
            <TableCell>
              <div className="font-medium">{model.display_name}</div>
              <div className="font-mono text-xs text-muted-foreground">{model.id}</div>
            </TableCell>
            <TableCell>
              <ProviderBadge provider={model.provider} />
            </TableCell>
            <TableCell>{kindLabel(model.kind)}</TableCell>
            <TableCell>
              <TierBadge tier={model.tier} />
            </TableCell>
            <TableCell>
              <AvailabilityMark available={model.available} />
            </TableCell>
            <TableCell className="text-right">
              <Switch
                checked={model.enabled}
                disabled={toggle.isPending}
                aria-label={`${model.display_name} enabled`}
                onCheckedChange={(enabled) => toggle.mutate({ id: model.id, enabled })}
              />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function ModelsTab() {
  const models = useModels();

  if (models.isPending) return <LoadingRows label="Loading Models" />;
  if (models.isError) return <LoadError error={models.error} onRetry={() => void models.refetch()} />;

  return (
    <div className="space-y-10">
      <section className="space-y-3">
        <div>
          <h2 className="text-base font-semibold">Catalog</h2>
          <p className="text-sm text-muted-foreground">
            Every Model from models.yaml. Disabled Models disappear from the picker; a Model that a Slot uses
            cannot be disabled.
          </p>
        </div>
        <ModelTable models={models.data.models} />
      </section>
      <SlotsSection models={models.data.models} slots={models.data.slots} />
    </div>
  );
}
