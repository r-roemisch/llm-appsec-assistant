import { LoadError, LoadingRows } from "@/components/common/QueryState";
import { ReportList } from "@/components/reports/ReportList";
import { PageHeader } from "@/components/shell/PageHeader";
import { useReports } from "@/hooks/useReports";

export function ReportsPage() {
  const reports = useReports();

  return (
    <>
      <PageHeader title="Reports" />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-6 md:px-6 md:py-8">
          <p className="max-w-prose text-[15px] leading-relaxed text-muted-foreground">
            Reports the assistant wrote for you in your conversations. Only you can see them; download one as Markdown
            to share it.
          </p>
          {reports.isPending ? (
            <LoadingRows label="Loading your reports" />
          ) : reports.isError ? (
            <LoadError error={reports.error} onRetry={() => void reports.refetch()} />
          ) : (
            <ReportList reports={reports.data} />
          )}
        </div>
      </div>
    </>
  );
}
