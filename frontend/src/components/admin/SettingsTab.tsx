import { useState, type FormEvent } from "react";
import { toast } from "sonner";

import { LoadError, LoadingRows } from "@/components/common/QueryState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useAdminSettings, useUpdateAdminSettings } from "@/hooks/useAdmin";
import { parseBudget, personaProblem, SETTINGS_LIMITS } from "@/lib/admin-settings";
import { errorMessage } from "@/lib/api";
import { formatNumber } from "@/lib/format";
import { countCharacters } from "@/lib/profile";
import type { AdminSettingsOut } from "@/lib/types";
import { cn } from "@/lib/utils";

function FieldError({ id, error }: { id?: string; error: string | null }) {
  if (!error) return null;
  return (
    <p id={id} role="alert" className="text-sm text-destructive">
      {error}
    </p>
  );
}

function PersonaCard({ settings }: { settings: AdminSettingsOut }) {
  const save = useUpdateAdminSettings();
  const [persona, setPersona] = useState(settings.persona);
  const [error, setError] = useState<string | null>(null);
  const length = countCharacters(persona.trim());
  const outOfRange = length < SETTINGS_LIMITS.personaMin || length > SETTINGS_LIMITS.personaMax;
  const changed = persona !== settings.persona;

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const problem = personaProblem(persona);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    save.mutate(
      { persona: persona.trim() },
      {
        onSuccess: (updated) => {
          setPersona(updated.persona);
          toast.success("Persona saved");
        },
        onError: (err) => setError(errorMessage(err)),
      },
    );
  }

  function restoreDefault() {
    setError(null);
    save.mutate(
      { persona: null },
      {
        onSuccess: (updated) => {
          setPersona(updated.persona);
          toast.success("Default persona restored");
        },
        onError: (err) => setError(errorMessage(err)),
      },
    );
  }

  return (
    <Card>
      <form onSubmit={onSubmit} noValidate className="contents">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Persona
            <Badge variant={settings.persona_is_default ? "outline" : "default"} className="font-normal">
              {settings.persona_is_default ? "Default" : "Custom"}
            </Badge>
          </CardTitle>
          <CardDescription>
            Starts every system prompt. Rampart's rules for Tools, Citations and untrusted text follow it and cannot be
            edited.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex items-baseline justify-between gap-3">
            <Label htmlFor="settings-persona">Persona text</Label>
            <span
              id="settings-persona-count"
              className={cn("text-xs tabular-nums", outOfRange ? "text-destructive" : "text-muted-foreground")}
            >
              {formatNumber(length)} / {formatNumber(SETTINGS_LIMITS.personaMax)}
            </span>
          </div>
          <Textarea
            id="settings-persona"
            value={persona}
            onChange={(event) => setPersona(event.target.value)}
            rows={8}
            aria-describedby="settings-persona-count settings-persona-hint"
            aria-invalid={error ? true : undefined}
            disabled={save.isPending}
            className="max-h-96 min-h-40 font-mono text-[13px] leading-relaxed md:text-[13px]"
          />
          <p id="settings-persona-hint" className="text-xs text-muted-foreground">
            {formatNumber(SETTINGS_LIMITS.personaMin)} to {formatNumber(SETTINGS_LIMITS.personaMax)} characters.
          </p>
          <FieldError error={error} />
        </CardContent>
        <CardFooter className="justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={save.isPending || settings.persona_is_default}
            onClick={restoreDefault}
          >
            Restore default
          </Button>
          <Button type="submit" size="sm" disabled={save.isPending || !changed}>
            Save persona
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}

function BudgetCard({ settings }: { settings: AdminSettingsOut }) {
  const save = useUpdateAdminSettings();
  const [budget, setBudget] = useState(String(settings.conversation_token_budget));
  const [error, setError] = useState<string | null>(null);
  const changed = budget.trim() !== String(settings.conversation_token_budget);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = parseBudget(budget);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    setError(null);
    save.mutate(
      { conversation_token_budget: parsed.value },
      {
        onSuccess: (updated) => {
          setBudget(String(updated.conversation_token_budget));
          toast.success("Token budget saved");
        },
        onError: (err) => setError(errorMessage(err)),
      },
    );
  }

  return (
    <Card>
      <form onSubmit={onSubmit} noValidate className="contents">
        <CardHeader>
          <CardTitle>Conversation token budget</CardTitle>
          <CardDescription>
            Tokens one Conversation may use in total, over every Model call. When it is used up, Rampart stops before
            calling a Model and says so.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <Label htmlFor="settings-budget">Tokens per Conversation</Label>
          <Input
            id="settings-budget"
            type="number"
            inputMode="numeric"
            min={SETTINGS_LIMITS.budgetMin}
            max={SETTINGS_LIMITS.budgetMax}
            step={1000}
            value={budget}
            onChange={(event) => setBudget(event.target.value)}
            aria-describedby="settings-budget-hint"
            aria-invalid={error ? true : undefined}
            disabled={save.isPending}
            className="max-w-48"
          />
          <p id="settings-budget-hint" className="text-xs text-muted-foreground">
            {formatNumber(SETTINGS_LIMITS.budgetMin)} to {formatNumber(SETTINGS_LIMITS.budgetMax)}.
          </p>
          <FieldError error={error} />
        </CardContent>
        <CardFooter className="justify-end">
          <Button type="submit" size="sm" disabled={save.isPending || !changed}>
            Save budget
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}

function GuardsCard({ settings }: { settings: AdminSettingsOut }) {
  const save = useUpdateAdminSettings();
  const [error, setError] = useState<string | null>(null);

  function toggle(patch: { input_guard: boolean } | { input_classifier: boolean }, done: string) {
    setError(null);
    save.mutate(patch, { onSuccess: () => toast.success(done), onError: (err) => setError(errorMessage(err)) });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Input guard</CardTitle>
        <CardDescription>Checks on every user message before any Model sees it.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <Label htmlFor="settings-input-guard">Injection and jailbreak heuristics</Label>
            <p className="text-xs text-muted-foreground">
              Answers attack-like messages with a fixed response instead of a Model. Secret redaction always runs, even
              when this is off.
            </p>
          </div>
          <Switch
            id="settings-input-guard"
            checked={settings.input_guard}
            disabled={save.isPending}
            onCheckedChange={(on) => toggle({ input_guard: on }, on ? "Input guard on" : "Input guard off")}
          />
        </div>
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <Label htmlFor="settings-input-classifier">Input classifier</Label>
            <p className="text-xs text-muted-foreground">
              Also asks the grader Model whether a message is an attack: one extra grader call per turn.
            </p>
          </div>
          <Switch
            id="settings-input-classifier"
            checked={settings.input_classifier}
            disabled={save.isPending}
            onCheckedChange={(on) =>
              toggle({ input_classifier: on }, on ? "Input classifier on" : "Input classifier off")
            }
          />
        </div>
        <FieldError error={error} />
      </CardContent>
    </Card>
  );
}

export function SettingsTab() {
  const settings = useAdminSettings();

  if (settings.isPending) return <LoadingRows rows={4} label="Loading settings" />;
  if (settings.isError) return <LoadError error={settings.error} onRetry={() => void settings.refetch()} />;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
      <PersonaCard settings={settings.data} />
      <div className="space-y-6">
        <BudgetCard settings={settings.data} />
        <GuardsCard settings={settings.data} />
      </div>
    </div>
  );
}
