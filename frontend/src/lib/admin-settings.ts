// Checks for the admin settings form, with the limits from docs/API.md (M3).
// The server enforces them too and answers 422; these give the same message
// before a request is sent.

import { formatNumber } from "@/lib/format";
import { countCharacters } from "@/lib/profile";

export const SETTINGS_LIMITS = {
  personaMin: 50,
  personaMax: 8000,
  budgetMin: 1000,
  budgetMax: 10_000_000,
} as const;

/** Why the persona cannot be saved, or null. The server trims it and counts code points. */
export function personaProblem(persona: string): string | null {
  const length = countCharacters(persona.trim());
  if (length < SETTINGS_LIMITS.personaMin || length > SETTINGS_LIMITS.personaMax) {
    return `The persona must be ${formatNumber(SETTINGS_LIMITS.personaMin)} to ${formatNumber(SETTINGS_LIMITS.personaMax)} characters (it has ${formatNumber(length)}).`;
  }
  return null;
}

export type BudgetResult = { ok: true; value: number } | { ok: false; error: string };

/** The token budget typed in the form as a number within the limits. */
export function parseBudget(text: string): BudgetResult {
  const trimmed = text.trim().replace(/[,_\s]/g, "");
  const value = Number(trimmed);
  if (!trimmed || !Number.isInteger(value) || value < SETTINGS_LIMITS.budgetMin || value > SETTINGS_LIMITS.budgetMax) {
    return {
      ok: false,
      error: `The token budget must be a whole number from ${formatNumber(SETTINGS_LIMITS.budgetMin)} to ${formatNumber(SETTINGS_LIMITS.budgetMax)}.`,
    };
  }
  return { ok: true, value };
}

export type RateLimitResult = { ok: true; value: number | null } | { ok: false; error: string };

/** A Tool's rate limit as typed: empty restores the default (null), otherwise a whole number of at least 1. */
export function parseRateLimit(text: string): RateLimitResult {
  const trimmed = text.trim();
  if (trimmed === "") return { ok: true, value: null };
  const value = Number(trimmed);
  if (!Number.isInteger(value) || value < 1) {
    return { ok: false, error: "The rate limit is a whole number of calls per hour, at least 1; leave it empty for the default." };
  }
  return { ok: true, value };
}
