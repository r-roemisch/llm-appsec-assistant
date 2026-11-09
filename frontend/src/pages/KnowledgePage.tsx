import { LoadError, LoadingRows } from "@/components/common/QueryState";
import { KnowledgeStatusPanel } from "@/components/knowledge/KnowledgeStatusPanel";
import { SharedSources } from "@/components/knowledge/SharedSources";
import { UploadArea } from "@/components/knowledge/UploadArea";
import { UploadList } from "@/components/knowledge/UploadList";
import { PageHeader } from "@/components/shell/PageHeader";
import { useKnowledgeSources, useKnowledgeStatus } from "@/hooks/useKnowledge";

export function KnowledgePage() {
  const status = useKnowledgeStatus();
  const sources = useKnowledgeSources();
  const uploads = sources.data?.filter((source) => source.mine) ?? [];
  const shared = sources.data?.filter((source) => !source.mine) ?? [];

  return (
    <>
      <PageHeader title="Knowledge Base" />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-10 px-4 py-6 md:px-6 md:py-8">
          {status.isPending ? (
            <LoadingRows rows={2} label="Loading the Knowledge Base status" />
          ) : status.isError ? (
            <LoadError error={status.error} onRetry={() => void status.refetch()} />
          ) : (
            <KnowledgeStatusPanel status={status.data} />
          )}

          <section aria-labelledby="uploads-heading" className="space-y-4">
            <div>
              <h2 id="uploads-heading" className="text-base font-semibold">
                Your uploads
              </h2>
              <p className="text-sm text-muted-foreground">
                Private to you: only your own Conversations retrieve and cite them, never anyone else's, admins
                included.
              </p>
            </div>
            <UploadArea status={status.data} />
            {sources.isPending ? (
              <LoadingRows label="Loading your uploads" />
            ) : sources.isError ? (
              <LoadError error={sources.error} onRetry={() => void sources.refetch()} />
            ) : (
              <UploadList uploads={uploads} />
            )}
          </section>

          {sources.isSuccess ? <SharedSources sources={shared} /> : null}
        </div>
      </div>
    </>
  );
}
