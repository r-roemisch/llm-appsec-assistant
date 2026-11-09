import { ChevronRightIcon, FlaskConicalIcon, ThumbsDownIcon, ThumbsUpIcon } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";

import { EvaluationCaseDialog } from "@/components/admin/EvaluationCaseDialog";
import { CopyButton } from "@/components/common/CopyButton";
import { LoadError, LoadingRows } from "@/components/common/QueryState";
import { StatTiles } from "@/components/common/StatTiles";
import { Markdown } from "@/components/conversation/Markdown";
import { Button } from "@/components/ui/button";
import { useFeedbackDashboard } from "@/hooks/useFeedback";
import { useNow } from "@/hooks/useNow";
import type { FeedbackFilters } from "@/lib/api";
import { feedbackLabel, forwardedLabel, shortId } from "@/lib/feedback";
import { formatCompact, formatDateTime, formatRelativeTime } from "@/lib/format";
import { toolLabel } from "@/lib/tools";
import type { FeedbackDashboardOut, FeedbackRecordOut, FeedbackValue } from "@/lib/types";
import { cn } from "@/lib/utils";

const LIMIT = 200;

type Filter = "all" | "down" | "up";

const FILTERS: ReadonlyArray<{ value: Filter; label: string }> = [
  { value: "all", label: "All" },
  { value: "down", label: "Not helpful" },
  { value: "up", label: "Helpful" },
];

function filtersFor(filter: Filter): FeedbackFilters {
  if (filter === "down") return { value: -1, limit: LIMIT };
  if (filter === "up") return { value: 1, limit: LIMIT };
  return { limit: LIMIT };
}

function countFor(filter: Filter, data: FeedbackDashboardOut): number {
  return filter === "down" ? data.down : filter === "up" ? data.up : data.up + data.down;
}

/** A rating as a word, an icon and a colour; never colour alone. */
function RatingBadge({ value }: { value: FeedbackValue }) {
  const up = value === 1;
  const Icon = up ? ThumbsUpIcon : ThumbsDownIcon;
  return (
    <span
      data-value={value}
      className={cn(
        "inline-flex h-5 shrink-0 items-center gap-1 rounded-full border px-2 text-xs font-medium whitespace-nowrap",
        up ? "border-success/30 bg-success/10 text-success" : "border-destructive/30 bg-destructive/10 text-destructive",
      )}
    >
      <Icon aria-hidden="true" className="size-3" />
      {feedbackLabel(value)}
    </span>
  );
}

function FilterButtons({
  filter,
  onChange,
  data,
}: {
  filter: Filter;
  onChange: (filter: Filter) => void;
  data: FeedbackDashboardOut | undefined;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-muted-foreground">Show</span>
      <div role="group" aria-label="Filter by rating" className="inline-flex max-w-full rounded-lg bg-muted p-[3px]">
        {FILTERS.map((item) => {
          const pressed = item.value === filter;
          return (
            <button
              key={item.value}
              type="button"
              aria-pressed={pressed}
              onClick={() => onChange(item.value)}
              className={cn(
                "inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium whitespace-nowrap text-foreground/60 outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 dark:text-muted-foreground dark:hover:text-foreground",
                pressed && "bg-background text-foreground shadow-sm dark:bg-input/30 dark:text-foreground",
              )}
            >
              {item.label}
              {data ? (
                <span className="text-xs text-muted-foreground tabular-nums">{formatCompact(countFor(item.value, data))}</span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function FeedbackItem({
  record,
  now,
  onConvert,
}: {
  record: FeedbackRecordOut;
  now: number;
  onConvert: (record: FeedbackRecordOut) => void;
}) {
  const [answerOpen, setAnswerOpen] = useState(false);
  const who = record.username ?? "A deleted user";
  const changed = record.updated_at !== record.created_at;

  return (
    <li aria-label={`${feedbackLabel(record.value)} from ${who}`} className="space-y-3 px-4 py-4">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <RatingBadge value={record.value} />
          <span className="text-sm font-medium wrap-anywhere">{who}</span>
          <span
            className="text-xs text-muted-foreground"
            title={`Rated ${formatDateTime(record.created_at)}${changed ? `, changed ${formatDateTime(record.updated_at)}` : ""}`}
          >
            {formatRelativeTime(record.updated_at, now)}
          </span>
        </div>
        {record.evaluation_case_id ? (
          <Link
            to="/admin?tab=evaluation"
            title={`Evaluation Case ${record.evaluation_case_id}`}
            className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-primary/30 bg-primary/5 px-2.5 text-[0.8rem] font-medium text-primary outline-none hover:bg-primary/10 focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <FlaskConicalIcon aria-hidden="true" className="size-3.5" />
            Case {shortId(record.evaluation_case_id)}
          </Link>
        ) : (
          <Button variant="outline" size="sm" className="shrink-0" onClick={() => onConvert(record)}>
            <FlaskConicalIcon aria-hidden="true" />
            Make an Evaluation Case
          </Button>
        )}
      </div>

      {record.comment ? (
        <blockquote
          aria-label="Comment"
          className="border-l-2 border-border pl-3 text-sm whitespace-pre-wrap wrap-anywhere"
        >
          {record.comment}
        </blockquote>
      ) : (
        <p className="text-xs text-muted-foreground italic">No comment.</p>
      )}

      <div className="space-y-1">
        <h3 className="text-xs font-medium text-muted-foreground">Question</h3>
        {record.question ? (
          <p className="max-h-40 overflow-y-auto text-sm whitespace-pre-wrap wrap-anywhere">{record.question}</p>
        ) : (
          <p className="text-sm text-muted-foreground italic">The question could not be found.</p>
        )}
      </div>

      <div className="space-y-1.5">
        <Button
          variant="ghost"
          size="xs"
          aria-expanded={answerOpen}
          onClick={() => setAnswerOpen(!answerOpen)}
          className="-ml-2 text-muted-foreground"
        >
          <ChevronRightIcon aria-hidden="true" className={cn("transition-transform", answerOpen && "rotate-90")} />
          {answerOpen ? "Hide the answer" : "Show the answer"}
        </Button>
        {answerOpen ? (
          <div
            role="region"
            aria-label="Answer"
            className="max-h-96 overflow-y-auto rounded-lg border bg-background px-3 py-2.5"
          >
            <Markdown content={record.answer} />
          </div>
        ) : null}
      </div>

      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-xs">
        <dt className="text-muted-foreground">Model</dt>
        <dd className="font-mono wrap-anywhere">{record.model_id ?? "—"}</dd>
        <dt className="text-muted-foreground">Tools used</dt>
        <dd>
          {record.tools_used.length > 0 ? (
            <ul aria-label="Tools used" className="flex flex-wrap gap-1">
              {record.tools_used.map((name) => (
                <li
                  key={name}
                  title={name}
                  className="max-w-full rounded-full border bg-muted px-2 py-px wrap-anywhere text-foreground"
                >
                  {toolLabel(name)}
                </li>
              ))}
            </ul>
          ) : (
            <span className="text-muted-foreground">None</span>
          )}
        </dd>
        <dt className="text-muted-foreground">Trace</dt>
        <dd className="min-w-0">
          {record.trace_id ? (
            <span className="flex min-w-0 items-center gap-1">
              <code className="min-w-0 font-mono text-[0.6875rem] wrap-anywhere">{record.trace_id}</code>
              <CopyButton text={record.trace_id} label="Copy the trace id" className="-my-1 shrink-0" />
            </span>
          ) : (
            <span className="text-muted-foreground">No trace</span>
          )}
        </dd>
        <dt className="text-muted-foreground">Score</dt>
        <dd title={record.forwarded_at ? `Forwarded ${formatDateTime(record.forwarded_at)}` : undefined}>
          {forwardedLabel(record)}
        </dd>
      </dl>
    </li>
  );
}

/**
 * The admin Feedback dashboard (M6): totals, a filter, and each answer users
 * rated with the question, the comment and the trace. An answer can become an
 * Evaluation Case, which the next evaluation run includes.
 */
export function FeedbackTab() {
  const [filter, setFilter] = useState<Filter>("all");
  const dashboard = useFeedbackDashboard(filtersFor(filter));
  const [converting, setConverting] = useState<FeedbackRecordOut | null>(null);
  const now = useNow();
  const data = dashboard.data;

  return (
    <section className="space-y-4">
      <div className="space-y-1">
        <h2 className="text-base font-semibold">Feedback</h2>
        <p className="max-w-prose text-sm text-muted-foreground">
          Thumbs up and down that users gave their own answers, with the question and the answer, newest first (the
          latest {LIMIT}). Feedback is capture only: it is stored with the answer's trace and changes nothing about how
          Rampart behaves. To act on an answer, make it an Evaluation Case: a reviewed test case that the next
          evaluation run measures.
        </p>
      </div>

      {data ? (
        <StatTiles
          tiles={[
            { label: "Ratings", value: formatCompact(data.up + data.down) },
            { label: "Helpful", value: formatCompact(data.up) },
            { label: "Not helpful", value: formatCompact(data.down) },
            {
              label: "Converted to cases",
              value: formatCompact(data.converted),
              title: "Answers an admin turned into Evaluation Cases",
            },
          ]}
        />
      ) : null}

      <FilterButtons filter={filter} onChange={setFilter} data={data} />

      {dashboard.isPending ? (
        <LoadingRows label="Loading Feedback" />
      ) : dashboard.isError ? (
        <LoadError error={dashboard.error} onRetry={() => void dashboard.refetch()} />
      ) : dashboard.data.items.length === 0 ? (
        <div className="rounded-xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
          {filter === "all" ? (
            <>
              <p className="font-medium text-foreground">No Feedback yet</p>
              <p className="mt-1">Users rate their answers with the thumbs under each answer.</p>
            </>
          ) : (
            <p>No answers rated {filter === "down" ? "not helpful" : "helpful"}.</p>
          )}
        </div>
      ) : (
        <ul
          aria-label="Feedback"
          aria-busy={dashboard.isPlaceholderData || undefined}
          className={cn("divide-y rounded-xl border bg-card transition-opacity", dashboard.isPlaceholderData && "opacity-60")}
        >
          {dashboard.data.items.map((record) => (
            <FeedbackItem key={record.id} record={record} now={now} onConvert={setConverting} />
          ))}
        </ul>
      )}

      <EvaluationCaseDialog record={converting} onClose={() => setConverting(null)} />
    </section>
  );
}
