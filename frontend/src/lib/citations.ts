// [n] markers in answer text. Answers cite passages as [n] (docs/API.md); a
// group such as [1, 3] cites several. A marker is linked only when every number
// in it has a Citation; anything else stays plain text.

export interface MarkerGroup<T> {
  /** The marker as written, such as "[2]" or "[1, 3]". */
  raw: string;
  /** What `lookup` returned for each distinct number, in order. */
  items: T[];
}

export type MarkerSegment<T> = string | MarkerGroup<T>;

const MARKER = /\[(\d{1,3}(?:\s*,\s*\d{1,3})*)\]/g;

/** Splits `text` into plain strings and marker groups whose numbers all resolve. */
export function splitCitationMarkers<T>(text: string, lookup: (n: number) => T | undefined): MarkerSegment<T>[] {
  const segments: MarkerSegment<T>[] = [];
  let last = 0;
  for (const match of text.matchAll(MARKER)) {
    const numbers = [...new Set(match[1].split(",").map((part) => Number(part.trim())))];
    const items = numbers.map(lookup).filter((item): item is T => item !== undefined);
    if (items.length !== numbers.length) continue;
    const start = match.index;
    if (start > last) segments.push(text.slice(last, start));
    segments.push({ raw: match[0], items });
    last = start + match[0].length;
  }
  if (last < text.length) segments.push(text.slice(last));
  return segments;
}
