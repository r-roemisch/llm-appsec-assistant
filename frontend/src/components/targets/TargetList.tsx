import { FlaskConicalIcon, PencilIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";

import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { ExpectedProfileBadge } from "@/components/common/ExpectedProfileBadge";
import { EditTargetDialog } from "@/components/targets/EditTargetDialog";
import { Button } from "@/components/ui/button";
import { useDeleteTarget } from "@/hooks/useTargets";
import { errorMessage } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { inputSurfaceLabel } from "@/lib/labels";
import type { TargetOut } from "@/lib/types";

/** A conversation message that asks Rampart to run the suite against this Target. */
function runTestPrompt(name: string): string {
  return `Run the seed-v1 injection suite against my '${name}' target.`;
}

function TargetRow({ target }: { target: TargetOut }) {
  const navigate = useNavigate();
  const remove = useDeleteTarget();
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <li className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-medium break-words">{target.name}</h3>
          <ExpectedProfileBadge value={target.profile} />
        </div>
        <p className="font-mono text-xs text-muted-foreground wrap-anywhere">{target.base_url}</p>
        <p className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
          <span>{inputSurfaceLabel(target.input_surface)}</span>
          <span className="tabular-nums">Registered {formatDate(target.registered_at)}</span>
        </p>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-1.5">
        <Button
          variant="outline"
          size="sm"
          onClick={() => navigate("/", { state: { draft: runTestPrompt(target.name) } })}
        >
          <FlaskConicalIcon aria-hidden="true" />
          Run a test
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground"
          aria-label={`Edit ${target.name}`}
          title="Edit"
          onClick={() => setEditing(true)}
        >
          <PencilIcon />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground hover:text-destructive"
          aria-label={`Delete ${target.name}`}
          title="Delete"
          onClick={() => {
            setError(null);
            setConfirming(true);
          }}
        >
          <Trash2Icon />
        </Button>
      </div>

      <EditTargetDialog target={target} open={editing} onOpenChange={setEditing} />
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Delete ${target.name}?`}
        description="Rampart can no longer run the injection suite against it. This cannot be undone."
        error={error}
        confirmLabel="Delete target"
        destructive
        pending={remove.isPending}
        onConfirm={() =>
          remove.mutate(target, {
            onSuccess: () => setConfirming(false),
            onError: (err) => setError(errorMessage(err)),
          })
        }
      />
    </li>
  );
}

/** The caller's registered Targets: profile, address, surface, and edit/delete/run. */
export function TargetList({ targets }: { targets: TargetOut[] }) {
  if (targets.length === 0) {
    return (
      <div className="rounded-xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
        <p className="font-medium text-foreground">No targets yet</p>
        <p className="mt-1">
          Register one above, or start the demo with{" "}
          <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">rampart demo-target</code>.
        </p>
      </div>
    );
  }
  return (
    <ul aria-label="Your targets" className="divide-y rounded-xl border bg-card">
      {targets.map((target) => (
        <TargetRow key={target.id} target={target} />
      ))}
    </ul>
  );
}
