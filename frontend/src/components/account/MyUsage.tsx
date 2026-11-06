import { useQuery } from "@tanstack/react-query";

import { LoadError, LoadingRows } from "@/components/common/QueryState";
import { UsageByModelTable } from "@/components/usage/UsageByModelTable";
import { UsageTotals } from "@/components/usage/UsageTotals";
import { useModels } from "@/hooks/useModels";
import { getMyUsage } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

export function MyUsage() {
  const usage = useQuery({ queryKey: queryKeys.myUsage, queryFn: getMyUsage });
  const models = useModels();

  if (usage.isPending) return <LoadingRows label="Loading usage" />;
  if (usage.isError) return <LoadError error={usage.error} onRetry={() => void usage.refetch()} />;

  return (
    <div className="space-y-5">
      <UsageTotals usage={usage.data} />
      <div>
        <h3 className="mb-2 text-sm font-medium text-muted-foreground">By Model</h3>
        <UsageByModelTable rows={usage.data.by_model} models={models.data?.models} />
      </div>
    </div>
  );
}
