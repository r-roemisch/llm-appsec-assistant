import type { InputSurface, Kind, Provider, RetrievalMode, SourceType, TargetProfile, Tier } from "@/lib/types";

export function providerLabel(provider: Provider): string {
  return provider === "openrouter" ? "OpenRouter" : "Ollama";
}

export function tierLabel(tier: Tier): string {
  return tier === "cheap" ? "Cheap" : "Powerful";
}

export function kindLabel(kind: Kind): string {
  return kind === "chat" ? "Chat" : "Embedding";
}

export function retrievalModeLabel(mode: RetrievalMode): string {
  return mode === "hybrid" ? "Hybrid search" : "Keyword search only";
}

export function sourceTypeLabel(type: SourceType): string {
  switch (type) {
    case "curated":
      return "Curated";
    case "app_docs":
      return "Rampart guide";
    case "upload":
      return "Upload";
  }
}

export function inputSurfaceLabel(surface: InputSurface): string {
  return surface === "document_slot" ? "Document slot" : "User message";
}

/** The owner's recorded profile, or an injection run's verdict. */
export function targetProfileLabel(profile: TargetProfile): string {
  return profile === "secure" ? "Secure" : "Vulnerable";
}
