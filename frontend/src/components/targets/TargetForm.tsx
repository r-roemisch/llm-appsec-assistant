import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCreateTarget } from "@/hooks/useTargets";
import { errorMessage } from "@/lib/api";
import { inputSurfaceLabel, targetProfileLabel } from "@/lib/labels";
import { buildTargetInput, inputSurfaceDescription, TARGET_LIMITS, type ProfileChoice } from "@/lib/targets";
import type { InputSurface } from "@/lib/types";

const SURFACES: readonly InputSurface[] = ["user_message", "document_slot"];
const PROFILE_CHOICES: readonly ProfileChoice[] = ["unset", "secure", "vulnerable"];

function profileChoiceLabel(choice: ProfileChoice): string {
  return choice === "unset" ? "Not set" : targetProfileLabel(choice);
}

/** Register a loopback Target: name, base URL, input surface and the expected profile. */
export function TargetForm() {
  const create = useCreateTarget();
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [inputSurface, setInputSurface] = useState<InputSurface>("user_message");
  const [profile, setProfile] = useState<ProfileChoice>("unset");
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setName("");
    setBaseUrl("");
    setInputSurface("user_message");
    setProfile("unset");
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = buildTargetInput({ name, baseUrl, inputSurface, profile });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    create.mutate(result.input, {
      onSuccess: reset,
      onError: (err) => setError(errorMessage(err)),
    });
  }

  const pending = create.isPending;

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-5 rounded-xl border bg-card p-4 md:p-5">
      <div className="grid gap-5 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="target-name">Name</Label>
          <Input
            id="target-name"
            value={name}
            maxLength={TARGET_LIMITS.name}
            onChange={(event) => setName(event.target.value)}
            disabled={pending}
            placeholder="Staging bot"
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="target-base-url">Base URL</Label>
          <Input
            id="target-base-url"
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
            disabled={pending}
            placeholder="http://127.0.0.1:8001"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            aria-describedby="target-base-url-hint"
          />
          <p id="target-base-url-hint" className="text-xs text-muted-foreground">
            A loopback address only: 127.0.0.0/8, ::1 or localhost. Rampart refuses anything else.
          </p>
        </div>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="target-input-surface">Input surface</Label>
          <Select
            value={inputSurface}
            onValueChange={(value) => setInputSurface(value as InputSurface)}
            disabled={pending}
          >
            <SelectTrigger id="target-input-surface" aria-label="Input surface" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper" align="start">
              {SURFACES.map((surface) => (
                <SelectItem key={surface} value={surface}>
                  {inputSurfaceLabel(surface)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="space-y-0.5 text-xs text-muted-foreground">
            <p>User message — {inputSurfaceDescription("user_message")}</p>
            <p>Document slot — {inputSurfaceDescription("document_slot")}</p>
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="target-profile">Expected profile</Label>
          <Select value={profile} onValueChange={(value) => setProfile(value as ProfileChoice)} disabled={pending}>
            <SelectTrigger id="target-profile" aria-label="Expected profile" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper" align="start">
              {PROFILE_CHOICES.map((choice) => (
                <SelectItem key={choice} value={choice}>
                  {profileChoiceLabel(choice)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Optional: what you expect it to be running. It never changes what the suite does.
          </p>
        </div>
      </div>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <div className="flex items-center gap-2 border-t pt-4">
        <Button type="submit" disabled={pending}>
          {pending ? "Registering" : "Register target"}
        </Button>
      </div>
    </form>
  );
}
