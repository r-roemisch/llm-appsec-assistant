import { createContext, useContext } from "react";

import type { CitationOut } from "@/lib/types";

export interface CitationContextValue {
  /** The Citations of one answer, by marker number. */
  byNumber: ReadonlyMap<number, CitationOut>;
  /** Opens the passage behind marker `n`. */
  open: (n: number) => void;
}

/** Provided around an answer's Markdown; null everywhere else, so [n] stays text. */
export const CitationContext = createContext<CitationContextValue | null>(null);

export function useCitations(): CitationContextValue | null {
  return useContext(CitationContext);
}
