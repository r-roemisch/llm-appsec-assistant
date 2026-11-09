import { InfoIcon, MessageSquareTextIcon, ThumbsDownIcon, ThumbsUpIcon } from "lucide-react";
import { useId, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode, type Ref } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useRateAnswer } from "@/hooks/useFeedback";
import {
  commentProblem,
  FEEDBACK_LIMITS,
  FEEDBACK_NOTE,
  feedbackInput,
  feedbackLabel,
  nextFeedback,
} from "@/lib/feedback";
import { formatNumber } from "@/lib/format";
import { countCharacters } from "@/lib/profile";
import type { FeedbackValue, MessageOut } from "@/lib/types";
import { cn } from "@/lib/utils";

function promptFor(value: FeedbackValue): string {
  return value === 1 ? "What made this answer helpful?" : "What was wrong with this answer?";
}

interface ThumbButtonProps {
  value: FeedbackValue;
  pressed: boolean;
  onClick: () => void;
  buttonRef: Ref<HTMLButtonElement>;
}

function ThumbButton({ value, pressed, onClick, buttonRef }: ThumbButtonProps) {
  const Icon = value === 1 ? ThumbsUpIcon : ThumbsDownIcon;
  const label = feedbackLabel(value);
  return (
    <Button
      ref={buttonRef}
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={label}
      aria-pressed={pressed}
      title={pressed ? `${label}. Click again to remove your rating` : label}
      onClick={onClick}
      className={cn(
        "text-muted-foreground",
        pressed && "bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary dark:hover:bg-primary/20",
      )}
    >
      <Icon aria-hidden="true" className={cn(pressed && "fill-current")} />
    </Button>
  );
}

interface AnswerFeedbackProps {
  /** A finished answer of the signed-in user (status complete or error). */
  message: MessageOut;
  /** The answer's meta line (Model, tokens, cost); the thumbs sit at its end. */
  meta: ReactNode;
}

/**
 * Thumbs up and down on a finished answer, with an optional comment. A click
 * saves the rating at once and opens a small comment form that says who sees
 * it; the pressed thumb again removes the rating. Feedback is capture only.
 */
export function AnswerFeedback({ message, meta }: AnswerFeedbackProps) {
  const feedback = message.feedback ?? null;
  const rate = useRateAnswer(message);
  // The rating the comment form is open for; null while it is closed.
  const [editing, setEditing] = useState<FeedbackValue | null>(null);
  const [draft, setDraft] = useState("");
  const upRef = useRef<HTMLButtonElement>(null);
  const downRef = useRef<HTMLButtonElement>(null);
  const id = useId();
  const problem = editing === null ? null : commentProblem(draft);

  function onThumb(value: FeedbackValue) {
    if (rate.isPending) return;
    const next = nextFeedback(feedback, value);
    // A rating that was not saved has nothing to comment on.
    rate.mutate(next, { onError: () => setEditing(null) });
    if (!next) {
      setEditing(null);
      return;
    }
    // Switching thumbs while typing keeps what was typed.
    if (editing === null) setDraft(feedback?.comment ?? "");
    setEditing(value);
  }

  function openComment() {
    if (!feedback) return;
    setDraft(feedback.comment ?? "");
    setEditing(feedback.value);
  }

  function close() {
    const thumb = editing === -1 ? downRef : upRef;
    setEditing(null);
    // Back to the thumb, so keyboard users keep their place.
    thumb.current?.focus();
  }

  function onSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (editing === null || problem || rate.isPending) return;
    const input = feedbackInput(editing, draft);
    if (feedback?.value === editing && (input.comment ?? null) === (feedback.comment ?? null)) {
      close();
      return;
    }
    rate.mutate(input, {
      onSuccess: () => {
        toast.success(input.comment ? "Thanks, your comment is saved." : "Thanks, your rating is saved.");
        close();
      },
    });
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <div className="min-w-0">{meta}</div>
        <div role="group" aria-label="Rate this answer" className="-my-1 ml-auto flex shrink-0 items-center gap-0.5">
          <ThumbButton value={1} pressed={feedback?.value === 1} onClick={() => onThumb(1)} buttonRef={upRef} />
          <ThumbButton value={-1} pressed={feedback?.value === -1} onClick={() => onThumb(-1)} buttonRef={downRef} />
          {feedback && editing === null ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={feedback.comment ? "Edit your comment" : "Add a comment"}
              title={feedback.comment ? `Your comment: ${feedback.comment}` : "Add a comment"}
              onClick={openComment}
              className="text-muted-foreground"
            >
              <MessageSquareTextIcon aria-hidden="true" className={cn(feedback.comment && "text-primary")} />
            </Button>
          ) : null}
        </div>
      </div>

      {editing !== null ? (
        <form
          aria-label="Comment on this answer"
          onSubmit={onSave}
          noValidate
          className="space-y-2 rounded-lg border bg-card p-3 shadow-xs"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <Label htmlFor={`${id}-comment`} className="text-sm">
              {promptFor(editing)}
              <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <span
              id={`${id}-count`}
              className={cn("text-xs tabular-nums", problem ? "text-destructive" : "text-muted-foreground")}
            >
              {formatNumber(countCharacters(draft.trim()))} / {formatNumber(FEEDBACK_LIMITS.comment)}
            </span>
          </div>
          <Textarea
            id={`${id}-comment`}
            // The form opens because of a click on a thumb; typing is the next step.
            autoFocus
            rows={2}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onKeyDown}
            aria-describedby={`${id}-count ${id}-note`}
            aria-invalid={problem ? true : undefined}
            className="max-h-48 min-h-16 text-sm md:text-sm"
          />
          {problem ? (
            <p role="alert" className="text-xs text-destructive">
              {problem}
            </p>
          ) : null}
          <p id={`${id}-note`} className="flex gap-1.5 text-xs text-muted-foreground">
            <InfoIcon aria-hidden="true" className="mt-px size-3.5 shrink-0" />
            <span>{FEEDBACK_NOTE}</span>
          </p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={close}>
              Skip
            </Button>
            <Button type="submit" size="sm" disabled={Boolean(problem) || rate.isPending}>
              {rate.isPending ? "Saving…" : "Save"}
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
