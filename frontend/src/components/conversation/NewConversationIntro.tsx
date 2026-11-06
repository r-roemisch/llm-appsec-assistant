import { RampartMark } from "@/components/common/Brand";

const EXAMPLES = [
  "How do I keep retrieved documents from injecting instructions into my RAG assistant?",
  "What should a Tool call gateway check before it lets the model run a shell command?",
  "Review my system prompt for ways a user could get it to leak other customers' data.",
];

/** The empty main area on "/": what Rampart is for, and three questions to start with. */
export function NewConversationIntro({ onPick }: { onPick: (text: string) => void }) {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-7 px-4 py-10 md:px-6 md:py-16">
      <RampartMark className="size-9" />
      <div>
        <h2 className="text-xl font-semibold tracking-tight">What are you building?</h2>
        <p className="mt-2 max-w-prose text-[15px] leading-relaxed text-muted-foreground">
          Rampart reviews the security of LLM applications: prompt injection, Tool permissions, data
          exfiltration, retrieval poisoning, and the controls that contain them. Describe your stack or
          paste the prompt you are worried about.
        </p>
      </div>
      <ul className="flex flex-col gap-2">
        {EXAMPLES.map((example) => (
          <li key={example}>
            <button
              type="button"
              onClick={() => onPick(example)}
              className="w-full rounded-lg border bg-card px-4 py-3 text-left text-sm leading-relaxed transition-colors outline-none hover:bg-accent/60 focus-visible:ring-3 focus-visible:ring-ring/40"
            >
              {example}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
