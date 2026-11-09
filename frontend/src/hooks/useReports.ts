import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { deleteReport, getReport, listReports } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import type { ReportOut } from "@/lib/types";

/** The caller's Reports, newest first. */
export function useReports() {
  return useQuery({ queryKey: queryKeys.reportList, queryFn: listReports });
}

/** One Report. A stored Report never changes. */
export function useReport(id: string) {
  return useQuery({ queryKey: queryKeys.report(id), queryFn: () => getReport(id), staleTime: 5 * 60_000 });
}

/** Deletes one of the caller's Reports. Errors are left to the caller. */
export function useDeleteReport() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (report: ReportOut) => deleteReport(report.id),
    onSuccess: (_result, report) => {
      queryClient.setQueryData<ReportOut[]>(queryKeys.reportList, (old) => old?.filter((item) => item.id !== report.id));
      queryClient.removeQueries({ queryKey: queryKeys.report(report.id) });
      toast.success(`${report.title} deleted`);
      void queryClient.invalidateQueries({ queryKey: queryKeys.reportList });
    },
  });
}
