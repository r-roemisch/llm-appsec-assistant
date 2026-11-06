import { useQuery } from "@tanstack/react-query";

import { getModels } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import type { ModelOut } from "@/lib/types";

export function useModels() {
  return useQuery({ queryKey: queryKeys.models, queryFn: getModels, staleTime: 60_000 });
}

/** Display name for a Model id, falling back to the id itself. */
export function modelDisplayName(models: ModelOut[] | undefined, id: string | null | undefined): string {
  if (!id) return "Unknown Model";
  return models?.find((model) => model.id === id)?.display_name ?? id;
}
