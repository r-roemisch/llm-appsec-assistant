import { PlusIcon, XIcon } from "lucide-react";
import { useRef, useState, type FormEvent } from "react";
import { Link } from "react-router";

import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { ExpectedProfileBadge } from "@/components/common/ExpectedProfileBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useDeleteProfile, useSaveProfile } from "@/hooks/useProfile";
import { errorMessage } from "@/lib/api";
import { formatDateTime, formatNumber } from "@/lib/format";
import { buildProfileInput, countCharacters, PROFILE_LIMITS, type PackageDraft } from "@/lib/profile";
import type { ProfileOut, TargetOut } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Package rows shown before "Show all"; the rest stay in the form and are saved with it. */
const COLLAPSED_ROWS = 50;

/** The attached Target ids, as a stable sorted string for comparison. */
function idsKey(ids: Iterable<string>): string {
  return [...ids].sort().join("\u0000");
}

interface PackageRow extends PackageDraft {
  /** Stable React key; rows have no server id. */
  key: number;
}

interface PackageRowEditorProps {
  row: PackageRow;
  index: number;
  ecosystems: readonly string[];
  disabled: boolean;
  onChange: (change: Partial<PackageDraft>) => void;
  onRemove: () => void;
}

function PackageRowEditor({ row, index, ecosystems, disabled, onChange, onRemove }: PackageRowEditorProps) {
  const number = index + 1;
  // Keep a stored ecosystem visible even if the server no longer offers it.
  const options = row.ecosystem && !ecosystems.includes(row.ecosystem) ? [...ecosystems, row.ecosystem] : ecosystems;

  return (
    // Phones: ecosystem, name and remove on one line, version below. Wider: one row.
    <li className="grid grid-cols-[minmax(0,8rem)_minmax(0,1fr)_auto] items-center gap-2 rounded-lg border p-2 sm:grid-cols-[9rem_minmax(0,1fr)_9rem_auto] sm:rounded-none sm:border-0 sm:p-0">
      <Select value={row.ecosystem || undefined} onValueChange={(ecosystem) => onChange({ ecosystem })} disabled={disabled}>
        <SelectTrigger aria-label={`Ecosystem of package ${number}`} className="w-full">
          <SelectValue placeholder="Ecosystem" />
        </SelectTrigger>
        <SelectContent position="popper" align="start">
          {options.map((ecosystem) => (
            <SelectItem key={ecosystem} value={ecosystem}>
              {ecosystem}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Input
        aria-label={`Name of package ${number}`}
        placeholder="Name"
        value={row.name}
        maxLength={PROFILE_LIMITS.name}
        onChange={(event) => onChange({ name: event.target.value })}
        disabled={disabled}
        autoComplete="off"
        spellCheck={false}
      />
      <Input
        aria-label={`Version of package ${number}`}
        placeholder="Version (optional)"
        value={row.version}
        maxLength={PROFILE_LIMITS.version}
        onChange={(event) => onChange({ version: event.target.value })}
        disabled={disabled}
        autoComplete="off"
        spellCheck={false}
        className="order-last col-span-3 sm:order-none sm:col-span-1"
      />
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={`Remove package ${number}`}
        onClick={onRemove}
        disabled={disabled}
        className="text-muted-foreground"
      >
        <XIcon />
      </Button>
    </li>
  );
}

function toRow(pkg: ProfileOut["packages"][number], index: number): PackageRow {
  return { key: index, ecosystem: pkg.ecosystem, name: pkg.name, version: pkg.version ?? "" };
}

/** The Project Profile form. Remount it (with a key) when the server copy changes. */
export function ProfileForm({ profile, targets = [] }: { profile: ProfileOut; targets?: readonly TargetOut[] }) {
  const save = useSaveProfile();
  const remove = useDeleteProfile();
  const [stack, setStack] = useState(profile.stack);
  const [rows, setRows] = useState<PackageRow[]>(() => profile.packages.map(toRow));
  const nextKey = useRef(profile.packages.length);
  // The attached Target ids; seeded from the saved profile so a race with the
  // Targets list never drops ids the server already holds.
  const [selectedTargets, setSelectedTargets] = useState<Set<string>>(() => new Set(profile.target_ids));
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  // An imported lock file can hold hundreds of packages: show the first rows until asked.
  const [showAllRows, setShowAllRows] = useState(false);
  const visibleRows = showAllRows ? rows : rows.slice(0, COLLAPSED_ROWS);

  const ecosystems = profile.ecosystems;
  const stackLength = countCharacters(stack);
  const stackTooLong = stackLength > PROFILE_LIMITS.stack;
  const full = rows.length >= PROFILE_LIMITS.packages;
  const pending = save.isPending || remove.isPending;
  const dirty =
    stack !== profile.stack ||
    idsKey(selectedTargets) !== idsKey(profile.target_ids) ||
    JSON.stringify(rows.map((row) => [row.ecosystem, row.name, row.version])) !==
      JSON.stringify(profile.packages.map((pkg) => [pkg.ecosystem, pkg.name, pkg.version ?? ""]));

  function toggleTarget(id: string) {
    setSelectedTargets((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function updateRow(key: number, change: Partial<PackageDraft>) {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...change } : row)));
  }

  function removeRow(key: number) {
    setRows((current) => current.filter((row) => row.key !== key));
  }

  function addRow() {
    if (full) return;
    const key = nextKey.current;
    nextKey.current += 1;
    const ecosystem = rows.at(-1)?.ecosystem ?? ecosystems[0] ?? "";
    setRows((current) => [...current, { key, ecosystem, name: "", version: "" }]);
    setShowAllRows(true); // the new row is at the end of the list
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = buildProfileInput(stack, rows, ecosystems, [...selectedTargets]);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    save.mutate(result.input, { onError: (err) => setError(errorMessage(err)) });
  }

  function confirmDelete() {
    setDeleteError(null);
    remove.mutate(undefined, { onError: (err) => setDeleteError(errorMessage(err)) });
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-8">
      <div className="space-y-2">
        <div className="flex items-baseline justify-between gap-3">
          <Label htmlFor="profile-stack">Stack</Label>
          <span
            id="profile-stack-count"
            className={cn("text-xs tabular-nums", stackTooLong ? "text-destructive" : "text-muted-foreground")}
          >
            {formatNumber(stackLength)} / {formatNumber(PROFILE_LIMITS.stack)}
          </span>
        </div>
        <Textarea
          id="profile-stack"
          value={stack}
          onChange={(event) => setStack(event.target.value)}
          disabled={pending}
          aria-invalid={stackTooLong || undefined}
          aria-describedby="profile-stack-hint profile-stack-count"
          placeholder="A FastAPI service with a LangGraph agent on OpenRouter, retrieval over Chroma, and Tools that read our SQL database and search the web."
          className="min-h-32"
        />
        <p id="profile-stack-hint" className="text-xs text-muted-foreground">
          Languages, frameworks, Model providers, retrieval and Tools: whatever the assistant should keep in mind.
        </p>
      </div>

      <div role="group" aria-labelledby="profile-packages-label" className="space-y-3">
        <div className="flex items-baseline justify-between gap-3">
          <span id="profile-packages-label" className="text-sm leading-none font-medium">
            Packages
          </span>
          <span className="text-xs text-muted-foreground tabular-nums">
            {formatNumber(rows.length)} / {formatNumber(PROFILE_LIMITS.packages)}
          </span>
        </div>
        {rows.length > 0 ? (
          <>
            <div
              aria-hidden="true"
              className="hidden gap-2 text-xs text-muted-foreground sm:grid sm:grid-cols-[9rem_minmax(0,1fr)_9rem_1.75rem]"
            >
              <span>Ecosystem</span>
              <span>Name</span>
              <span>Version</span>
            </div>
            <ul className="space-y-2">
              {visibleRows.map((row, index) => (
                <PackageRowEditor
                  key={row.key}
                  row={row}
                  index={index}
                  ecosystems={ecosystems}
                  disabled={pending}
                  onChange={(change) => updateRow(row.key, change)}
                  onRemove={() => removeRow(row.key)}
                />
              ))}
            </ul>
            {rows.length > visibleRows.length ? (
              <Button type="button" variant="ghost" size="sm" onClick={() => setShowAllRows(true)}>
                Show all {formatNumber(rows.length)} packages
              </Button>
            ) : null}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">No packages yet. Add the dependencies the assistant should know about.</p>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" variant="outline" size="sm" onClick={addRow} disabled={full || pending || ecosystems.length === 0}>
            <PlusIcon />
            Add package
          </Button>
          {full ? (
            <span className="text-xs text-muted-foreground">
              A profile holds at most {formatNumber(PROFILE_LIMITS.packages)} packages.
            </span>
          ) : null}
        </div>
      </div>

      <div role="group" aria-labelledby="profile-targets-label" className="space-y-3">
        <div className="flex items-baseline justify-between gap-3">
          <span id="profile-targets-label" className="text-sm leading-none font-medium">
            Targets
          </span>
          {targets.length > 0 ? (
            <span className="text-xs text-muted-foreground tabular-nums">
              {selectedTargets.size} / {targets.length}
            </span>
          ) : null}
        </div>
        <p className="text-xs text-muted-foreground">
          Attach your registered Targets so Rampart can offer to run the injection suite against them.
        </p>
        {targets.length > 0 ? (
          <ul className="space-y-1.5">
            {targets.map((target) => (
              <li key={target.id}>
                <label className="flex cursor-pointer items-center gap-2.5 rounded-lg border p-2.5 hover:bg-accent/40">
                  <input
                    type="checkbox"
                    aria-label={target.name}
                    checked={selectedTargets.has(target.id)}
                    onChange={() => toggleTarget(target.id)}
                    disabled={pending}
                    className="size-4 shrink-0 accent-primary"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium break-words">{target.name}</span>
                      {target.profile ? <ExpectedProfileBadge value={target.profile} /> : null}
                    </div>
                    <p className="truncate font-mono text-xs text-muted-foreground">{target.base_url}</p>
                  </div>
                </label>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">
            No Targets registered yet.{" "}
            <Link
              to="/targets"
              className="font-medium text-primary underline decoration-primary/40 underline-offset-3 hover:decoration-primary"
            >
              Register one
            </Link>{" "}
            to attach it here.
          </p>
        )}
      </div>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2 border-t pt-5">
        <Button type="submit" disabled={pending || stackTooLong}>
          {save.isPending ? "Saving" : "Save profile"}
        </Button>
        <Button
          type="button"
          variant="destructive"
          disabled={pending || !profile.exists}
          onClick={() => {
            setDeleteError(null);
            setConfirmingDelete(true);
          }}
        >
          Delete profile
        </Button>
        <span className="ml-auto text-xs text-muted-foreground">
          {dirty ? "Unsaved changes" : profile.updated_at ? `Saved ${formatDateTime(profile.updated_at)}` : "Not saved yet"}
        </span>
      </div>

      <ConfirmDialog
        open={confirmingDelete}
        onOpenChange={setConfirmingDelete}
        title="Delete your Project Profile?"
        description="The assistant stops receiving it from the next turn on. This cannot be undone."
        error={deleteError}
        confirmLabel="Delete profile"
        destructive
        pending={remove.isPending}
        onConfirm={confirmDelete}
      />
    </form>
  );
}
