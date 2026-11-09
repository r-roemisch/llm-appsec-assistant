import { useQuery } from "@tanstack/react-query";
import { ShieldIcon } from "lucide-react";
import { useSearchParams } from "react-router";

import { LoadError, LoadingRows } from "@/components/common/QueryState";
import { Markdown } from "@/components/conversation/Markdown";
import { AskAboutRampart } from "@/components/help/AskAboutRampart";
import { PageHeader } from "@/components/shell/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getHelpDocs } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import type { HelpDocOut } from "@/lib/types";

function AdminLabel({ className }: { className?: string }) {
  return (
    <Badge variant="outline" className={className}>
      <ShieldIcon aria-hidden="true" />
      For administrators
    </Badge>
  );
}

function Guides({ docs, selected, onSelect }: { docs: HelpDocOut[]; selected: string | null; onSelect: (slug: string) => void }) {
  const current = docs.find((doc) => doc.slug === selected)?.slug ?? docs[0].slug;
  return (
    <Tabs value={current} onValueChange={onSelect}>
      <TabsList variant="line">
        {docs.map((doc) => (
          <TabsTrigger key={doc.slug} value={doc.slug}>
            {doc.title}
            {doc.audience === "admin" ? <AdminLabel className="hidden font-normal sm:inline-flex" /> : null}
          </TabsTrigger>
        ))}
      </TabsList>
      {docs.map((doc) => (
        <TabsContent key={doc.slug} value={doc.slug} className="space-y-4 pt-5">
          {doc.audience === "admin" ? <AdminLabel className="font-normal" /> : null}
          <Markdown content={doc.markdown} />
        </TabsContent>
      ))}
    </Tabs>
  );
}

export function HelpPage() {
  const docs = useQuery({ queryKey: queryKeys.helpDocs, queryFn: getHelpDocs, staleTime: 5 * 60_000 });
  const [searchParams, setSearchParams] = useSearchParams();

  return (
    <>
      <PageHeader title="Help" />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-6 md:px-6 md:py-8">
          <AskAboutRampart />
          <section aria-labelledby="guides-heading" className="space-y-3">
            <h2 id="guides-heading" className="text-base font-semibold">
              Guides
            </h2>
            {docs.isPending ? (
              <LoadingRows rows={5} label="Loading the guides" />
            ) : docs.isError ? (
              <LoadError error={docs.error} onRetry={() => void docs.refetch()} />
            ) : docs.data.length === 0 ? (
              <p className="text-sm text-muted-foreground">No guides are available on this server.</p>
            ) : (
              <Guides
                docs={docs.data}
                selected={searchParams.get("guide")}
                onSelect={(slug) => setSearchParams({ guide: slug }, { replace: true })}
              />
            )}
          </section>
        </div>
      </div>
    </>
  );
}
