import { ChevronRightIcon, MinusIcon, PencilIcon, PlusIcon, TriangleAlertIcon, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { JsonBlock } from "@/components/common/JsonBlock";
import { formatCount } from "@/lib/format";
import { definitionFieldLabel, diffField, findTool, isJsonField, type DiffPart } from "@/lib/plugins";
import type { PluginChanges, PluginDetailOut, PluginToolChange, PluginToolOut } from "@/lib/types";
import { cn } from "@/lib/utils";

// Everything a Plugin's server sends is untrusted: these components render it
// as plain text and preformatted JSON only. No Markdown, no links, no HTML.

/** A small block that opens on request. */
function Disclosure({ summary, children }: { summary: string; children: ReactNode }) {
  return (
    <details className="group/disclosure">
      <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded-sm text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 [&::-webkit-details-marker]:hidden">
        <ChevronRightIcon aria-hidden="true" className="size-3 transition-transform group-open/disclosure:rotate-90" />
        {summary}
      </summary>
      <div className="mt-1.5">{children}</div>
    </details>
  );
}

/** Text from a Plugin's server: line breaks kept, long words wrapped, framed as data. */
function UntrustedText({ text, empty }: { text: string; empty: string }) {
  if (!text) return <p className="text-sm text-muted-foreground italic">{empty}</p>;
  return (
    <p className="rounded-md border border-dashed bg-muted/30 px-2.5 py-1.5 text-sm whitespace-pre-wrap wrap-anywhere">
      {text}
    </p>
  );
}

function MarkBadge({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex h-5 items-center rounded-full border border-primary/30 bg-primary/10 px-2 text-xs font-medium text-primary">
      {children}
    </span>
  );
}

/** One Tool definition as a server listed it, warnings first. */
export function PluginToolCard({ tool, mark = null }: { tool: PluginToolOut; mark?: "added" | "changed" | null }) {
  const warnings = tool.warnings.length;
  return (
    <article
      aria-label={`Tool definition ${tool.name}`}
      className={cn("space-y-2.5 rounded-lg border bg-card p-3", warnings > 0 && "border-warning/50")}
    >
      <header className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <h4 className="min-w-0 font-mono text-sm font-medium wrap-anywhere">{tool.name}</h4>
        {mark === "added" ? <MarkBadge>New</MarkBadge> : mark === "changed" ? <MarkBadge>Changed</MarkBadge> : null}
        {warnings > 0 ? (
          <span className="inline-flex h-5 items-center gap-1 rounded-full border border-warning/40 bg-warning/10 px-2 text-xs font-medium text-warning">
            <TriangleAlertIcon aria-hidden="true" className="size-3" />
            {formatCount(warnings, "warning")}
          </span>
        ) : null}
      </header>

      {warnings > 0 ? (
        <ul
          aria-label={`Warnings for ${tool.name}`}
          className="space-y-1 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs"
        >
          {tool.warnings.map((warning, index) => (
            <li key={index} className="flex items-start gap-1.5">
              <TriangleAlertIcon aria-hidden="true" className="mt-px size-3.5 shrink-0 text-warning" />
              <span className="min-w-0 wrap-anywhere">{warning}</span>
            </li>
          ))}
        </ul>
      ) : null}

      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
        <dt className="text-muted-foreground">Exposed as</dt>
        <dd className="font-mono wrap-anywhere">
          {tool.exposed_name ?? <span className="font-sans text-destructive">Cannot be offered (bad name or schema)</span>}
        </dd>
        <dt className="text-muted-foreground">Title</dt>
        <dd className="wrap-anywhere">{tool.title ?? <span className="text-muted-foreground">None</span>}</dd>
      </dl>

      <div className="space-y-1">
        <p className="text-xs text-muted-foreground">Description</p>
        <UntrustedText text={tool.description} empty="No description" />
      </div>

      <div className="flex flex-col items-start gap-1.5">
        <Disclosure summary="Input schema">
          <JsonBlock value={tool.input_schema} label={`Input schema of ${tool.name}`} />
        </Disclosure>
        {tool.output_schema ? (
          <Disclosure summary="Output schema">
            <JsonBlock value={tool.output_schema} label={`Output schema of ${tool.name}`} />
          </Disclosure>
        ) : null}
        {tool.annotations ? (
          <Disclosure summary="Annotations">
            <JsonBlock value={tool.annotations} label={`Annotations of ${tool.name}`} />
          </Disclosure>
        ) : null}
      </div>
    </article>
  );
}

/** Definitions in the server's order; with `changes`, new and changed ones are marked. */
export function PluginToolList({
  tools,
  label,
  changes = null,
}: {
  tools: readonly PluginToolOut[];
  label: string;
  changes?: PluginChanges | null;
}) {
  const added = new Set(changes?.added ?? []);
  const changed = new Set(changes?.changed.map((change) => change.name) ?? []);
  return (
    <ul aria-label={label} className="space-y-3">
      {tools.map((tool, index) => (
        // A server could list a name twice; the position keeps the keys unique.
        <li key={`${index}:${tool.name}`}>
          <PluginToolCard tool={tool} mark={added.has(tool.name) ? "added" : changed.has(tool.name) ? "changed" : null} />
        </li>
      ))}
    </ul>
  );
}

/** One side of a before/after view; the parts only this side has are marked. */
function DiffPane({
  parts,
  side,
  label,
  json,
}: {
  parts: readonly DiffPart[];
  side: "before" | "after";
  label: string;
  json: boolean;
}) {
  return (
    <figure className="min-w-0 space-y-1">
      <figcaption className="text-[0.6875rem] font-medium tracking-wide text-muted-foreground uppercase">
        {side === "before" ? "Accepted" : "Listed now"}
      </figcaption>
      <pre
        aria-label={label}
        className={cn(
          "max-h-72 overflow-auto rounded-md border bg-muted/50 px-3 py-2 text-xs leading-relaxed whitespace-pre-wrap wrap-anywhere",
          json ? "font-mono" : "font-sans text-[0.8125rem]",
        )}
      >
        {parts.length === 0 ? (
          <span className="text-muted-foreground italic">(none)</span>
        ) : (
          parts.map((part, index) =>
            !part.changed ? (
              <span key={index}>{part.text}</span>
            ) : side === "before" ? (
              <del key={index} className="rounded-sm bg-destructive/15 decoration-destructive/70">
                {part.text}
              </del>
            ) : (
              <ins key={index} className="rounded-sm bg-success/20 decoration-success/70">
                {part.text}
              </ins>
            ),
          )
        )}
      </pre>
    </figure>
  );
}

function FieldDiff({
  name,
  field,
  before,
  after,
}: {
  name: string;
  field: string;
  before: PluginToolOut | undefined;
  after: PluginToolOut | undefined;
}) {
  const diff = diffField(before, after, field);
  const label = definitionFieldLabel(field);
  const json = isJsonField(field);
  return (
    <div className="space-y-1.5">
      <h5 className="text-xs font-medium">{label}</h5>
      <div className="grid gap-2 sm:grid-cols-2">
        <DiffPane parts={diff.before} side="before" label={`${label} of ${name}, accepted`} json={json} />
        <DiffPane parts={diff.after} side="after" label={`${label} of ${name}, listed now`} json={json} />
      </div>
    </div>
  );
}

function ToolChange({ change, detail }: { change: PluginToolChange; detail: PluginDetailOut }) {
  const before = findTool(detail.accepted_tools, change.name);
  const after = findTool(detail.current_tools, change.name);
  return (
    <article aria-label={`Changes to ${change.name}`} className="space-y-3 rounded-lg border bg-card p-3">
      <header className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <PencilIcon aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
        <h4 className="min-w-0 font-mono text-sm font-medium wrap-anywhere">{change.name}</h4>
        <span className="text-xs text-muted-foreground">changed:</span>
        {change.fields.map((field) => (
          <span key={field} className="rounded-md border bg-muted px-1.5 text-xs">
            {definitionFieldLabel(field)}
          </span>
        ))}
      </header>
      {change.fields.map((field) => (
        <FieldDiff key={field} name={change.name} field={field} before={before} after={after} />
      ))}
    </article>
  );
}

function NameGroup({ title, names, note, Icon }: { title: string; names: string[]; note: string; Icon: LucideIcon }) {
  return (
    <div className="space-y-1.5 rounded-lg border bg-card p-3">
      <h4 className="flex items-center gap-1.5 text-sm font-medium">
        <Icon aria-hidden="true" className="size-3.5 text-muted-foreground" />
        {title}
      </h4>
      <ul aria-label={title} className="flex flex-wrap gap-1.5">
        {names.map((name) => (
          <li key={name} className="rounded-md border bg-muted px-1.5 py-0.5 font-mono text-xs wrap-anywhere">
            {name}
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">{note}</p>
    </div>
  );
}

/** What differs between the accepted definitions and the last listing, with a before/after view per changed field. */
export function PluginChangesView({ detail }: { detail: PluginDetailOut }) {
  const { added, removed, changed } = detail.changes;
  if (added.length === 0 && removed.length === 0 && changed.length === 0) {
    return <p className="text-sm text-muted-foreground">No differences between the accepted definitions and the last listing.</p>;
  }
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        {formatCount(added.length, "Tool")} added · {formatCount(removed.length, "Tool")} removed ·{" "}
        {formatCount(changed.length, "Tool")} changed
      </p>
      {added.length > 0 ? (
        <NameGroup title="Added" names={added} Icon={PlusIcon} note="New in this listing; their definitions are below." />
      ) : null}
      {removed.length > 0 ? (
        <NameGroup title="Removed" names={removed} Icon={MinusIcon} note="Accepted earlier, no longer listed by the server." />
      ) : null}
      {changed.map((change) => (
        <ToolChange key={change.name} change={change} detail={detail} />
      ))}
    </div>
  );
}
