import { useCallback, useSyncExternalStore } from "react";

function query(media: string): MediaQueryList | null {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia(media)
    : null;
}

export function useMediaQuery(media: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = query(media);
      if (!list) return () => undefined;
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    [media],
  );
  const getSnapshot = useCallback(() => query(media)?.matches ?? false, [media]);
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
