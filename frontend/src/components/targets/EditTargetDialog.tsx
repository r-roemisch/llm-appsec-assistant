import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useUpdateTarget } from "@/hooks/useTargets";
import { errorMessage } from "@/lib/api";
import { targetProfileLabel } from "@/lib/labels";
import { TARGET_LIMITS, type ProfileChoice } from "@/lib/targets";
import type { TargetOut, TargetUpdateIn } from "@/lib/types";

const PROFILE_CHOICES: readonly ProfileChoice[] = ["unset", "secure", "vulnerable"];

function choiceLabel(choice: ProfileChoice): string {
  return choice === "unset" ? "Not set" : targetProfileLabel(choice);
}

function toChoice(profile: TargetOut["profile"]): ProfileChoice {
  return profile ?? "unset";
}

/** Rename a Target and set or clear its recorded profile. Base URL and surface are fixed. */
export function EditTargetDialog({
  target,
  open,
  onOpenChange,
}: {
  target: TargetOut;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const update = useUpdateTarget();
  const [name, setName] = useState(target.name);
  const [profile, setProfile] = useState<ProfileChoice>(toChoice(target.profile));
  const [error, setError] = useState<string | null>(null);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Give the Target a name.");
      return;
    }
    const patch: TargetUpdateIn = { name: trimmed, profile: profile === "unset" ? null : profile };
    setError(null);
    update.mutate(
      { id: target.id, patch },
      {
        onSuccess: () => onOpenChange(false),
        onError: (err) => setError(errorMessage(err)),
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Edit {target.name}</DialogTitle>
          <DialogDescription>Rename it or change the profile you expect it to be running.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} noValidate className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="edit-target-name">Name</Label>
            <Input
              id="edit-target-name"
              value={name}
              maxLength={TARGET_LIMITS.name}
              onChange={(event) => setName(event.target.value)}
              disabled={update.isPending}
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-target-profile">Expected profile</Label>
            <Select
              value={profile}
              onValueChange={(value) => setProfile(value as ProfileChoice)}
              disabled={update.isPending}
            >
              <SelectTrigger id="edit-target-profile" aria-label="Expected profile" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper" align="start">
                {PROFILE_CHOICES.map((choice) => (
                  <SelectItem key={choice} value={choice}>
                    {choiceLabel(choice)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={update.isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={update.isPending}>
              {update.isPending ? "Saving" : "Save changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
