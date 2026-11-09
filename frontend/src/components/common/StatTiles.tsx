import type { ReactNode } from "react";

export interface StatTile {
  label: string;
  value: ReactNode;
  /** Shown on hover. */
  title?: string;
}

/** Headline numbers as one row of tiles (two per row on phones). */
export function StatTiles({ tiles }: { tiles: StatTile[] }) {
  return (
    <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-4">
      {tiles.map((tile) => (
        <div key={tile.label} className="bg-card px-4 py-3" title={tile.title}>
          <dt className="text-xs text-muted-foreground">{tile.label}</dt>
          <dd className="mt-1 text-xl font-semibold">{tile.value}</dd>
        </div>
      ))}
    </dl>
  );
}
