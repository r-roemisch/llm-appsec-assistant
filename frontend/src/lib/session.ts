import type { SessionOut } from "@/lib/types";

// The last SessionOut the server returned (from login or /api/auth/me). Lives in
// memory only: the CSRF token is never written to storage.

type Listener = () => void;

let current: SessionOut | null = null;
const listeners = new Set<Listener>();
const unauthorizedListeners = new Set<Listener>();

export const session = {
  get(): SessionOut | null {
    return current;
  },
  csrfToken(): string | null {
    return current?.csrf_token ?? null;
  },
  set(next: SessionOut | null): void {
    current = next;
    listeners.forEach((listener) => listener());
  },
  clear(): void {
    session.set(null);
  },
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

/** Called when any request other than login answers 401. */
export function onUnauthorized(listener: Listener): () => void {
  unauthorizedListeners.add(listener);
  return () => {
    unauthorizedListeners.delete(listener);
  };
}

export function emitUnauthorized(): void {
  unauthorizedListeners.forEach((listener) => listener());
}
