import { useQuery } from "@tanstack/react-query";

import { LoadError, LoadingRows } from "@/components/common/QueryState";
import { UsageByModelTable } from "@/components/usage/UsageByModelTable";
import { UsageByUserTable } from "@/components/usage/UsageByUserTable";
import { UsageTotals } from "@/components/usage/UsageTotals";
import { useModels } from "@/hooks/useModels";
import { getAdminUsage } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

export function AdminUsageTab() {
  const usage = useQuery({ queryKey: queryKeys.adminUsage, queryFn: getAdminUsage });
  const models = useModels();

  if (usage.isPending) return <LoadingRows label="Loading usage" />;
  if (usage.isError) return <LoadError error={usage.error} onRetry={() => void usage.refetch()} />;

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h2 className="text-base font-semibold">Everyone</h2>
        <UsageTotals usage={usage.data} />
      </section>
      <section className="space-y-3">
        <h2 className="text-base font-semibold">By user</h2>
        <UsageByUserTable rows={usage.data.by_user} />
      </section>
      <section className="space-y-3">
        <h2 className="text-base font-semibold">By Model</h2>
        <UsageByModelTable rows={usage.data.by_model} models={models.data?.models} />
      </section>
    </div>
  );
}
