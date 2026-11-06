import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";

import { ModelPicker } from "@/components/conversation/ModelPicker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { errorMessage, resetSlot, setSlot } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import { SLOTS, type ModelOut, type ModelsOut, type Slot, type SlotOut, type SlotPatch } from "@/lib/types";

const SLOT_LABELS: Record<Slot, string> = {
  chat: "Chat",
  grader: "Grader",
  judge: "Judge",
  embedding: "Embedding",
};

function useSlotMutations(slot: Slot) {
  const queryClient = useQueryClient();
  const applySlots = (slots: Record<Slot, SlotOut>) => {
    queryClient.setQueryData<ModelsOut>(queryKeys.models, (old) => (old ? { ...old, slots } : old));
  };
  const save = useMutation({
    mutationFn: (patch: SlotPatch) => setSlot(slot, patch),
    onSuccess: (slots) => {
      applySlots(slots);
      toast.success(`${SLOT_LABELS[slot]} Slot saved`);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const reset = useMutation({
    mutationFn: () => resetSlot(slot),
    onSuccess: (slots) => {
      applySlots(slots);
      toast.success(`${SLOT_LABELS[slot]} Slot reset to its default`);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  return { save, reset };
}

function SlotEditor({ slot, value, models }: { slot: Slot; value: SlotOut; models: ModelOut[] }) {
  const isEmbedding = slot === "embedding";
  const [modelId, setModelId] = useState<string | null>(value.model_id);
  const [temperature, setTemperature] = useState(value.temperature === null ? "" : String(value.temperature));
  const [maxTokens, setMaxTokens] = useState(value.max_tokens === null ? "" : String(value.max_tokens));
  const { save, reset } = useSlotMutations(slot);

  const changed =
    modelId !== value.model_id ||
    temperature !== (value.temperature === null ? "" : String(value.temperature)) ||
    (!isEmbedding && maxTokens !== (value.max_tokens === null ? "" : String(value.max_tokens)));
  const pending = save.isPending || reset.isPending;

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!modelId) return;
    const patch: SlotPatch = {
      model_id: modelId,
      temperature: temperature === "" ? null : Number(temperature),
    };
    if (!isEmbedding && maxTokens !== "") patch.max_tokens = Number(maxTokens);
    save.mutate(patch);
  }

  return (
    <Card size="sm">
      <form onSubmit={onSubmit} className="contents">
        <CardHeader className="flex items-center justify-between">
          <CardTitle>{SLOT_LABELS[slot]}</CardTitle>
          <Badge variant={value.source === "override" ? "default" : "outline"} className="font-normal">
            {value.source === "override" ? "Override" : "Default"}
          </Badge>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor={`slot-${slot}-model`}>Model</Label>
            <ModelPicker
              id={`slot-${slot}-model`}
              models={models}
              kind={isEmbedding ? "embedding" : "chat"}
              value={modelId}
              onChange={setModelId}
              disabled={pending}
              aria-label={`${SLOT_LABELS[slot]} Slot Model`}
              className="w-full max-w-none"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor={`slot-${slot}-temperature`}>Temperature</Label>
              <Input
                id={`slot-${slot}-temperature`}
                type="number"
                inputMode="decimal"
                min={0}
                max={2}
                step={0.1}
                placeholder="Not sent"
                value={temperature}
                onChange={(event) => setTemperature(event.target.value)}
                disabled={pending}
              />
            </div>
            {!isEmbedding ? (
              <div className="space-y-1.5">
                <Label htmlFor={`slot-${slot}-max-tokens`}>Max tokens</Label>
                <Input
                  id={`slot-${slot}-max-tokens`}
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={128000}
                  step={1}
                  value={maxTokens}
                  onChange={(event) => setMaxTokens(event.target.value)}
                  disabled={pending}
                />
              </div>
            ) : null}
          </div>
          <p className="text-xs text-muted-foreground">
            Leave the temperature empty to not send one; some hosted Models reject it.
          </p>
        </CardContent>
        <CardFooter className="justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={pending || value.source === "default"}
            onClick={() => reset.mutate()}
          >
            Reset to default
          </Button>
          <Button type="submit" size="sm" disabled={pending || !changed || !modelId}>
            Save
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}

export function SlotsSection({ models, slots }: { models: ModelOut[]; slots: Record<Slot, SlotOut> }) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-base font-semibold">Slots</h2>
        <p className="text-sm text-muted-foreground">
          Which Model does each job. Defaults come from models.yaml; an override stays until you reset it.
        </p>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {SLOTS.map((slot) => (
          // The key resets the form when the server value changes.
          <SlotEditor key={`${slot}:${JSON.stringify(slots[slot])}`} slot={slot} value={slots[slot]} models={models} />
        ))}
      </div>
    </section>
  );
}
