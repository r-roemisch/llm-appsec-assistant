import { LifeBuoyIcon } from "lucide-react";
import { useState, type FormEvent } from "react";

import { MAX_MESSAGE_LENGTH } from "@/components/conversation/Composer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useStartConversation } from "@/hooks/useConversations";

/** Starts a help-mode Conversation with the typed question and opens it. */
export function AskAboutRampart() {
  const [question, setQuestion] = useState("");
  const start = useStartConversation();
  const content = question.trim();

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!content || start.isPending) return;
    start.mutate({ content, helpMode: true });
  }

  return (
    <section aria-labelledby="ask-heading" className="rounded-xl border bg-card p-4 md:p-5">
      <div className="flex items-center gap-2">
        <LifeBuoyIcon aria-hidden="true" className="size-4 text-primary" />
        <h2 id="ask-heading" className="text-base font-semibold">
          Ask about Rampart
        </h2>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        Starts a Conversation in help mode: answers come only from the guides below, with Citations.
      </p>
      <form onSubmit={onSubmit} className="mt-3 flex flex-col gap-2 sm:flex-row">
        <Input
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="How do I add a PDF to the Knowledge Base?"
          aria-label="Your question about Rampart"
          maxLength={MAX_MESSAGE_LENGTH}
          disabled={start.isPending}
          className="sm:flex-1"
        />
        <Button type="submit" disabled={!content || start.isPending}>
          {start.isPending ? "Starting" : "Ask"}
        </Button>
      </form>
    </section>
  );
}
