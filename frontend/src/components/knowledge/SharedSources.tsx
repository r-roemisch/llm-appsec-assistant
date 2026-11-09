import { LibraryBigIcon } from "lucide-react";
import type { ReactNode } from "react";

import { OriginLink } from "@/components/common/OriginLink";
import { Badge } from "@/components/ui/badge";
import { formatCount, formatDate, formatNumber } from "@/lib/format";
import type { SourceOut } from "@/lib/types";

function Command({ children }: { children: ReactNode }) {
  return <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em] text-foreground">{children}</code>;
}

function SharedSourceRow({ source }: { source: SourceOut }) {
  return (
    <li className="space-y-1 px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-sm font-medium">{source.title}</span>
        {source.synthetic ? (
          <Badge variant="outline" className="font-normal">
            Synthetic fixture
          </Badge>
        ) : null}
      </div>
      <p className="text-xs">
        <OriginLink origin={source.origin} />
      </p>
      <p className="text-xs text-muted-foreground wrap-anywhere">License: {source.license_note ?? "not recorded"}</p>
      <p className="flex flex-wrap gap-x-3 text-xs text-muted-foreground tabular-nums">
        <span>{formatCount(source.passage_count, "passage")}</span>
        <span>{formatNumber(source.embedded_count)} embedded</span>
        <span>Ingested {formatDate(source.fetched_at)}</span>
      </p>
    </li>
  );
}

interface SourceGroupProps {
  title: string;
  description: string;
  sources: SourceOut[];
}

function SourceGroup({ title, description, sources }: SourceGroupProps) {
  return (
    <section aria-label={title} className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h3 className="text-sm font-semibold">{title}</h3>
        <span className="text-xs text-muted-foreground">{formatCount(sources.length, "Source")}</span>
      </div>
      <p className="text-xs text-muted-foreground">{description}</p>
      {sources.length > 0 ? (
        <ul className="divide-y rounded-xl border bg-card">
          {sources.map((source) => (
            <SharedSourceRow key={source.id} source={source} />
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">None yet.</p>
      )}
    </section>
  );
}

/** The Sources every user's answers can cite, grouped as curated references and Rampart's guides. */
export function SharedSources({ sources }: { sources: SourceOut[] }) {
  const curated = sources.filter((source) => source.source_type !== "app_docs");
  const guides = sources.filter((source) => source.source_type === "app_docs");

  return (
    <section aria-labelledby="shared-heading" className="space-y-4">
      <div>
        <h2 id="shared-heading" className="text-base font-semibold">
          Shared Sources
        </h2>
        <p className="text-sm text-muted-foreground">
          Every user's answers can cite these. They are managed on the server with <Command>rampart ingest</Command>.
        </p>
      </div>
      {sources.length === 0 ? (
        <div className="rounded-xl border border-dashed px-4 py-8 text-center">
          <LibraryBigIcon aria-hidden="true" className="mx-auto size-6 text-muted-foreground" />
          <p className="mt-3 text-sm font-medium">No shared Sources yet</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            An admin adds them on the server: <Command>rampart ingest</Command> fetches the official references and
            Rampart's guides, and <Command>rampart ingest --fixtures</Command> loads synthetic fixtures for offline use.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          <SourceGroup
            title="Curated"
            description="Security references with their license notes: OWASP, MITRE ATLAS, NIST AI RMF and Rampart's primers."
            sources={curated}
          />
          <SourceGroup
            title="Rampart guides"
            description="Rampart's own user and admin guides. Help mode answers only from these."
            sources={guides}
          />
        </div>
      )}
    </section>
  );
}
