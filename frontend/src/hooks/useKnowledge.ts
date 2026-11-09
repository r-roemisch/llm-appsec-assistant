import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { deleteSource, getKnowledgeStatus, getPassage, listSources, uploadSource } from "@/lib/api";
import { formatCount } from "@/lib/format";
import { queryKeys } from "@/lib/query-keys";
import type { SourceOut } from "@/lib/types";

export function useKnowledgeStatus() {
  return useQuery({ queryKey: queryKeys.knowledgeStatus, queryFn: getKnowledgeStatus });
}

export function useKnowledgeSources() {
  return useQuery({ queryKey: queryKeys.knowledgeSources, queryFn: listSources });
}

/** One passage, for a Citation. Passages do not change once ingested. */
export function usePassage(id: string) {
  return useQuery({ queryKey: queryKeys.passage(id), queryFn: () => getPassage(id), staleTime: 5 * 60_000 });
}

function refreshKnowledge(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: queryKeys.knowledgeStatus });
  void queryClient.invalidateQueries({ queryKey: queryKeys.knowledgeSources });
}

/** Uploads one file. Errors are left to the caller, which shows the server's detail. */
export function useUploadSource() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => uploadSource(file),
    onSuccess: (source) => {
      toast.success(`${source.title} added: ${formatCount(source.passage_count, "passage")}`);
      refreshKnowledge(queryClient);
    },
  });
}

/** Deletes one of the caller's uploads. Errors are left to the caller. */
export function useDeleteSource() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (source: SourceOut) => deleteSource(source.id),
    onSuccess: (_result, source) => {
      queryClient.setQueryData<SourceOut[]>(queryKeys.knowledgeSources, (old) =>
        old?.filter((item) => item.id !== source.id),
      );
      toast.success(`${source.title} deleted`);
      refreshKnowledge(queryClient);
    },
  });
}
