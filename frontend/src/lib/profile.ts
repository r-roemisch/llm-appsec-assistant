import { formatNumber } from "@/lib/format";
import type { PackageRef, ProfileIn } from "@/lib/types";

/** The Project Profile limits from docs/API.md; the server enforces them too. */
export const PROFILE_LIMITS = { stack: 2000, packages: 50, name: 214, version: 64 } as const;

/** One package row as typed in the form. */
export interface PackageDraft {
  ecosystem: string;
  name: string;
  version: string;
}

/** Characters as the server counts them: code points, not UTF-16 units. */
export function countCharacters(text: string): number {
  return [...text].length;
}

export type ProfileDraftResult = { ok: true; input: ProfileIn } | { ok: false; error: string };

/**
 * Checks the form against the limits and builds the PUT body. Rows with
 * neither a name nor a version are dropped; names and versions are trimmed and
 * an empty version is sent as null. `targetIds` are the Targets attached to the
 * profile (M4). Errors name rows as the form numbers them.
 */
export function buildProfileInput(
  stack: string,
  rows: readonly PackageDraft[],
  ecosystems: readonly string[],
  targetIds: readonly string[] = [],
): ProfileDraftResult {
  if (countCharacters(stack) > PROFILE_LIMITS.stack) {
    return {
      ok: false,
      error: `The stack description is longer than ${formatNumber(PROFILE_LIMITS.stack)} characters.`,
    };
  }
  const packages: PackageRef[] = [];
  for (const [index, row] of rows.entries()) {
    const name = row.name.trim();
    const version = row.version.trim();
    if (!name && !version) continue;
    const label = `package ${index + 1}`;
    if (!name) return { ok: false, error: `Give ${label} a name.` };
    if (countCharacters(name) > PROFILE_LIMITS.name) {
      return { ok: false, error: `The name of ${label} is longer than ${PROFILE_LIMITS.name} characters.` };
    }
    if (countCharacters(version) > PROFILE_LIMITS.version) {
      return { ok: false, error: `The version of ${label} is longer than ${PROFILE_LIMITS.version} characters.` };
    }
    if (!ecosystems.includes(row.ecosystem)) {
      return { ok: false, error: `Choose an ecosystem from the list for ${label}.` };
    }
    packages.push({ ecosystem: row.ecosystem, name, version: version || null });
  }
  if (packages.length > PROFILE_LIMITS.packages) {
    return { ok: false, error: `A profile holds at most ${PROFILE_LIMITS.packages} packages.` };
  }
  return { ok: true, input: { stack, packages, target_ids: [...targetIds] } };
}
