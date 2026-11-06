import type { Kind, Provider, Tier } from "@/lib/types";

export function providerLabel(provider: Provider): string {
  return provider === "openrouter" ? "OpenRouter" : "Ollama";
}

export function tierLabel(tier: Tier): string {
  return tier === "cheap" ? "Cheap" : "Powerful";
}

export function kindLabel(kind: Kind): string {
  return kind === "chat" ? "Chat" : "Embedding";
}
