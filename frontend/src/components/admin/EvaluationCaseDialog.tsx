import { PencilLineIcon } from "lucide-react";
import { useId, useMemo, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { LoadError, LoadingRows } from "@/components/common/QueryState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAdminTools } from "@/hooks/useAdmin";
import { useCreateEvaluationCase } from "@/hooks/useFeedback";
import { errorMessage } from "@/lib/api";
import {
  buildCaseInput,
  CASE_LIMITS,
  caseDraftFrom,
  caseKindLabel,
  feedbackLabel,
  shortId,
  type CaseDraft,
} from "@/lib/feedback";
import { formatNumber } from "@/lib/format";
import { countCharacters } from "@/lib/profile";
import { toolLabel } from "@/lib/tools";
import type { EvaluationCaseKind, FeedbackRecordOut } from "@/lib/types";
import { cn } from "@/lib/utils";

interface EvaluationCaseDialogProps {
  /** The Feedback whose answer becomes a case; null keeps the dialog closed. */
  record: FeedbackRecordOut | null;
  onClose: () => void;
}

/** Turns an answer with Feedback into an Evaluation Case: the admin reviews and corrects it first. */
export function EvaluationCaseDialog({ record, onClose }: EvaluationCaseDialogProps) {
  return (
    <Dialog
      open={record !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      {record ? <CaseForm key={record.id} record={record} onDone={onClose} /> : null}
    </Dialog>
  );
}

const KIND_HINTS: Record<EvaluationCaseKind, string> = {
  qa: "The judge Model scores Rampart's answer to the question against your expected answer.",
  tool: "Checks that Rampart calls the expected Tools for the question. No judge.",
};

function Counter({ id, length, max }: { id: string; length: number; max: number }) {
  return (
    <span id={id} className={cn("text-xs tabular-nums", length > max ? "text-destructive" : "text-muted-foreground")}>
      {formatNumber(length)} / {formatNumber(max)}
    </span>
  );
}

function CaseForm({ record, onDone }: { record: FeedbackRecordOut; onDone: () => void }) {
  const [draft, setDraft] = useState<CaseDraft>(() => caseDraftFrom(record));
  const [error, setError] = useState<string | null>(null);
  const create = useCreateEvaluationCase(record.id);
  const tools = useAdminTools();
  const known = useMemo(() => new Set((tools.data ?? []).map((tool) => tool.name)), [tools.data]);
  const id = useId();
  const isTool = draft.kind === "tool";
  // Tools the answer used that the server no longer has: they cannot be expected.
  const gone = tools.data ? record.tools_used.filter((name) => !known.has(name)) : [];
  const selected = draft.expectedTools.filter((name) => known.has(name));
  const questionLength = countCharacters(draft.question.trim());
  const answerLength = countCharacters(draft.expectedAnswer.trim());

  function update(patch: Partial<CaseDraft>) {
    setDraft((current) => ({ ...current, ...patch }));
    setError(null);
  }

  function toggleTool(name: string, checked: boolean) {
    update({
      expectedTools: checked
        ? [...draft.expectedTools.filter((item) => item !== name), name]
        : draft.expectedTools.filter((item) => item !== name),
    });
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (create.isPending) return;
    const built = buildCaseInput(draft, isTool ? known : undefined);
    if (!built.ok) {
      setError(built.error);
      return;
    }
    setError(null);
    create.mutate(built.input, {
      onSuccess: (created) => {
        toast.success(`Evaluation Case ${shortId(created.id)} added. The next ${created.kind} run includes it.`);
        onDone();
      },
      // 409 (already a case) and 422 (missing or unknown expectations) are shown here, in the dialog.
      onError: (err) => setError(errorMessage(err)),
    });
  }

  return (
    <DialogContent className="flex max-h-[90dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
      <form onSubmit={onSubmit} noValidate className="flex min-h-0 flex-1 flex-col">
        <DialogHeader className="gap-1.5 border-b px-4 pt-4 pr-12 pb-3">
          <DialogTitle>Make an Evaluation Case</DialogTitle>
          <DialogDescription>
            From {record.username ?? "a deleted user"}'s answer rated {feedbackLabel(record.value).toLowerCase()}. The
            case joins the next evaluation run of its suite; nothing else changes.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4">
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Kind</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {(["qa", "tool"] as const).map((kind) => (
                <label
                  key={kind}
                  className="flex cursor-pointer gap-2.5 rounded-lg border p-3 text-sm transition-colors has-checked:border-primary has-checked:bg-primary/5 has-focus-visible:ring-3 has-focus-visible:ring-ring/50"
                >
                  <input
                    type="radio"
                    name={`${id}-kind`}
                    value={kind}
                    checked={draft.kind === kind}
                    onChange={() => update({ kind })}
                    className="mt-0.5 size-4 shrink-0 accent-primary outline-none"
                  />
                  <span className="min-w-0 space-y-0.5">
                    <span className="block font-medium">
                      {caseKindLabel(kind)} <span className="font-mono text-xs font-normal text-muted-foreground">{kind}</span>
                    </span>
                    <span className="block text-xs text-muted-foreground">{KIND_HINTS[kind]}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="space-y-1.5">
            <div className="flex items-baseline justify-between gap-3">
              <Label htmlFor={`${id}-question`}>Question</Label>
              <Counter id={`${id}-question-count`} length={questionLength} max={CASE_LIMITS.question} />
            </div>
            <Textarea
              id={`${id}-question`}
              rows={3}
              value={draft.question}
              onChange={(event) => update({ question: event.target.value })}
              aria-describedby={`${id}-question-count ${id}-question-hint`}
              className="max-h-48 text-sm md:text-sm"
            />
            <p id={`${id}-question-hint`} className="text-xs text-muted-foreground">
              {record.question
                ? "The user's question, prefilled. The run asks it in a new Conversation, so make it stand on its own."
                : "The user's question could not be found: write the question the case asks."}
            </p>
          </div>

          {isTool ? (
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Expected Tools</legend>
              <p className="text-xs text-muted-foreground">
                The Tools Rampart should call for this question: at least one, at most {CASE_LIMITS.expectedTools}.
                Prefilled with the Tools the answer used.
              </p>
              {tools.isPending ? (
                <LoadingRows rows={3} label="Loading Tools" />
              ) : tools.isError ? (
                <LoadError error={tools.error} onRetry={() => void tools.refetch()} />
              ) : (
                <ul aria-label="Tools" className="max-h-64 divide-y overflow-y-auto rounded-lg border">
                  {tools.data.map((tool) => (
                    <li key={tool.name}>
                      <label className="flex cursor-pointer items-start gap-2.5 px-3 py-2 text-sm hover:bg-muted/50">
                        <input
                          type="checkbox"
                          checked={draft.expectedTools.includes(tool.name)}
                          onChange={(event) => toggleTool(tool.name, event.target.checked)}
                          className="mt-0.5 size-4 shrink-0 accent-primary"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block font-medium wrap-anywhere">{toolLabel(tool.name, tool.contributed_by)}</span>
                          <span className="block font-mono text-xs text-muted-foreground wrap-anywhere">{tool.name}</span>
                        </span>
                        {record.tools_used.includes(tool.name) ? (
                          <Badge variant="secondary" className="font-normal">
                            Used in the answer
                          </Badge>
                        ) : null}
                      </label>
                    </li>
                  ))}
                </ul>
              )}
              {gone.length > 0 ? (
                <p className="text-xs text-muted-foreground wrap-anywhere">
                  Used in the answer but no longer a Tool, so left out:{" "}
                  <span className="font-mono">{gone.join(", ")}</span>
                </p>
              ) : null}
              <p className="text-xs text-muted-foreground tabular-nums" aria-live="polite">
                {formatNumber(selected.length)} selected
              </p>
            </fieldset>
          ) : (
            <div className="space-y-1.5">
              <div className="flex items-baseline justify-between gap-3">
                <Label htmlFor={`${id}-expected`}>Expected answer</Label>
                <Counter id={`${id}-expected-count`} length={answerLength} max={CASE_LIMITS.expectedAnswer} />
              </div>
              <p
                id={`${id}-expected-hint`}
                className="flex gap-1.5 rounded-md border border-warning/40 bg-warning/10 px-2.5 py-2 text-xs"
              >
                <PencilLineIcon aria-hidden="true" className="mt-px size-3.5 shrink-0 text-warning" />
                <span>
                  Prefilled with Rampart's answer as a starting point. Correct it into the right reference answer, and
                  remove Citation markers like [1]: the judge scores future answers against this text.
                </span>
              </p>
              <Textarea
                id={`${id}-expected`}
                rows={8}
                value={draft.expectedAnswer}
                onChange={(event) => update({ expectedAnswer: event.target.value })}
                aria-describedby={`${id}-expected-count ${id}-expected-hint`}
                className="max-h-80 text-sm md:text-sm"
              />
            </div>
          )}

          {error ? (
            <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </div>

        <DialogFooter className="mx-0 mb-0">
          <Button type="button" variant="outline" onClick={onDone} disabled={create.isPending}>
            Cancel
          </Button>
          <Button type="submit" disabled={create.isPending || (isTool && !tools.data)}>
            {create.isPending ? "Making the case…" : "Make the case"}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
