import { ArrowUpIcon, SquareIcon } from "lucide-react";
import type { FormEvent, KeyboardEvent, ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export const MAX_MESSAGE_LENGTH = 32_000;

interface ComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSend: (content: string) => void;
  onStop: () => void;
  streaming: boolean;
  disabled?: boolean;
  /** The Model picker, rendered in the toolbar. */
  modelPicker: ReactNode;
  autoFocus?: boolean;
}

export function Composer({ value, onChange, onSend, onStop, streaming, disabled, modelPicker, autoFocus }: ComposerProps) {
  const content = value.trim();
  const tooLong = value.length > MAX_MESSAGE_LENGTH;
  const canSend = !streaming && !disabled && content.length > 0 && !tooLong;

  function submit() {
    if (!canSend) return;
    onSend(content);
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    submit();
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  }

  return (
    <form onSubmit={onSubmit} className="shrink-0 px-3 pt-2 pb-3 md:px-6 md:pb-4">
      <div className="mx-auto max-w-3xl rounded-xl border bg-card transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/25">
        <Textarea
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Ask about the security of your LLM application"
          rows={1}
          disabled={streaming || disabled}
          autoFocus={autoFocus}
          aria-label="Message"
          className="max-h-60 min-h-11 resize-none border-0 bg-transparent px-4 pt-3 pb-1 text-[15px] shadow-none focus-visible:border-transparent focus-visible:ring-0 md:text-[15px] dark:bg-transparent"
        />
        <div className="flex items-center gap-2 px-2 pb-2">
          {modelPicker}
          <span className="hidden text-xs text-muted-foreground lg:inline">Enter sends, Shift+Enter adds a line</span>
          <div className="ml-auto flex items-center gap-2">
            {value.length > MAX_MESSAGE_LENGTH * 0.9 ? (
              <span className={cn("text-xs tabular-nums", tooLong ? "text-destructive" : "text-muted-foreground")}>
                {value.length.toLocaleString("en-US")} / {MAX_MESSAGE_LENGTH.toLocaleString("en-US")}
              </span>
            ) : null}
            {streaming ? (
              <Button type="button" variant="outline" onClick={onStop}>
                <SquareIcon className="size-3 fill-current" />
                Stop
              </Button>
            ) : (
              <Button type="submit" disabled={!canSend}>
                <ArrowUpIcon />
                Send
              </Button>
            )}
          </div>
        </div>
      </div>
    </form>
  );
}
