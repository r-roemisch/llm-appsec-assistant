// Targets as the Targets page registers them (docs/API.md, M4): the loopback
// check the server also enforces, building the POST body, and the one-line
// glosses for the input surface and profile fields.

import { countCharacters } from "@/lib/profile";
import type { InputSurface, TargetCreateIn, TargetProfile } from "@/lib/types";

/** Client limits; the server enforces its own. The per-user cap is 20 Targets. */
export const TARGET_LIMITS = { name: 100, targets: 20 } as const;

/** "unset" is the form's third profile option; it is sent as null. */
export type ProfileChoice = TargetProfile | "unset";

/**
 * Whether `raw` is a loopback URL the server will accept: an `http`/`https`
 * address whose host is a loopback literal (`127.0.0.0/8`, `::1` or
 * `localhost`). The host is never resolved, here or on the server.
 */
export function isLoopbackUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  // URL keeps IPv6 hosts in brackets; strip them to compare the literal.
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host === "::1") return true;
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (ipv4) {
    const octets = ipv4.slice(1).map(Number);
    return octets.every((octet) => octet <= 255) && octets[0] === 127;
  }
  return false;
}

/** One line for each input surface, shown under the field. */
export function inputSurfaceDescription(surface: InputSurface): string {
  return surface === "document_slot"
    ? "Indirect injection: the candidate is hidden in a document the Target reads."
    : "Direct injection: the candidate is sent as the Target's own user message.";
}

export interface TargetDraft {
  name: string;
  baseUrl: string;
  inputSurface: InputSurface;
  profile: ProfileChoice;
}

export type TargetDraftResult = { ok: true; input: TargetCreateIn } | { ok: false; error: string };

/** Checks the register form and builds the POST body, or returns why it cannot. */
export function buildTargetInput(draft: TargetDraft): TargetDraftResult {
  const name = draft.name.trim();
  const baseUrl = draft.baseUrl.trim();
  if (!name) return { ok: false, error: "Give the Target a name." };
  if (countCharacters(name) > TARGET_LIMITS.name) {
    return { ok: false, error: `The name is longer than ${TARGET_LIMITS.name} characters.` };
  }
  if (!baseUrl) return { ok: false, error: "Enter the Target's base URL." };
  if (!isLoopbackUrl(baseUrl)) {
    return {
      ok: false,
      error: "The base URL must be a loopback address, like http://127.0.0.1:8001 or http://localhost:8001.",
    };
  }
  return {
    ok: true,
    input: {
      name,
      base_url: baseUrl,
      input_surface: draft.inputSurface,
      profile: draft.profile === "unset" ? null : draft.profile,
    },
  };
}
