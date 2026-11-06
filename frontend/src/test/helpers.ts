import type { ModelOut, SessionOut, UserOut } from "@/lib/types";

export function jsonResponse(status: number, body?: unknown): Response {
  if (body === undefined) return new Response(null, { status });
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

export const alice: UserOut = {
  id: 1,
  username: "alice",
  role: "user",
  created_at: "2026-11-01T09:00:00Z",
};

export const aliceSession: SessionOut = { user: alice, csrf_token: "csrf-token-1" };

export function model(overrides: Partial<ModelOut> & Pick<ModelOut, "id" | "display_name">): ModelOut {
  return {
    provider: "openrouter",
    kind: "chat",
    tier: "cheap",
    enabled: true,
    available: true,
    context_length: 200_000,
    notes: null,
    ...overrides,
  };
}
