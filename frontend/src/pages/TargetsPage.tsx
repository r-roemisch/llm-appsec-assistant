import { LoadError, LoadingRows } from "@/components/common/QueryState";
import { PageHeader } from "@/components/shell/PageHeader";
import { TargetForm } from "@/components/targets/TargetForm";
import { TargetList } from "@/components/targets/TargetList";
import { useTargets } from "@/hooks/useTargets";

export function TargetsPage() {
  const targets = useTargets();

  return (
    <>
      <PageHeader title="Targets" />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-6 md:px-6 md:py-8">
          <div className="max-w-prose space-y-3 text-[15px] leading-relaxed text-muted-foreground">
            <p>
              A Target is one of your own apps, running on your own machine at a loopback address like{" "}
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-[13px]">http://127.0.0.1:8001</code>, that
              Rampart may run its fixed <span className="font-medium text-foreground">seed-v1</span> prompt-injection
              suite against. The suite runs only with your approval, and Rampart refuses any address that is not a
              loopback literal.
            </p>
            <p>
              The quickest way to try it is{" "}
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-[13px]">rampart demo-target</code>, which
              starts a small loopback app you can register and test.
            </p>
          </div>

          <section aria-labelledby="register-target-heading" className="space-y-3">
            <h2 id="register-target-heading" className="text-sm font-medium">
              Register a target
            </h2>
            <TargetForm />
          </section>

          <section aria-labelledby="your-targets-heading" className="space-y-3">
            <h2 id="your-targets-heading" className="text-sm font-medium">
              Your targets
            </h2>
            {targets.isPending ? (
              <LoadingRows label="Loading your targets" />
            ) : targets.isError ? (
              <LoadError error={targets.error} onRetry={() => void targets.refetch()} />
            ) : (
              <TargetList targets={targets.data} />
            )}
          </section>

          <section
            aria-labelledby="how-to-test-heading"
            className="rounded-xl border bg-muted/40 px-4 py-4 text-sm leading-relaxed"
          >
            <h2 id="how-to-test-heading" className="font-medium">
              How to run a test
            </h2>
            <p className="mt-1 text-muted-foreground">
              Running is not a button here: open a conversation and ask Rampart to run the injection test against a
              target by name. It stops for your approval before anything touches the Target, and shows the verdict
              when the run finishes. "Run a test" on a target just opens a new conversation with that request ready to
              send.
            </p>
          </section>
        </div>
      </div>
    </>
  );
}
