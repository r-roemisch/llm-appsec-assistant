import { describe, expect, it } from "vitest";

import { parseSSE, type SSEEvent } from "@/lib/sse";
import { streamOf } from "@/test/helpers";

async function collect(stream: ReadableStream<Uint8Array>, signal?: AbortSignal): Promise<SSEEvent[]> {
  const events: SSEEvent[] = [];
  for await (const event of parseSSE(stream, signal)) events.push(event);
  return events;
}

describe("parseSSE", () => {
  it("parses one event with JSON data", async () => {
    const events = await collect(streamOf(['event: delta\ndata: {"text":"Prompt injection is"}\n\n']));
    expect(events).toEqual([{ event: "delta", data: { text: "Prompt injection is" } }]);
  });

  it("parses two events in one chunk", async () => {
    const events = await collect(
      streamOf(['event: start\ndata: {"model_id":"m"}\n\nevent: delta\ndata: {"text":"a"}\n\n']),
    );
    expect(events.map((event) => event.event)).toEqual(["start", "delta"]);
    expect(events[1].data).toEqual({ text: "a" });
  });

  it("joins chunks that split a line and a JSON payload", async () => {
    const events = await collect(
      streamOf(["event: del", 'ta\ndata: {"te', 'xt":"hello"}', "\n", "\nevent: done\ndata: {}\n\n"]),
    );
    expect(events).toEqual([
      { event: "delta", data: { text: "hello" } },
      { event: "done", data: {} },
    ]);
  });

  it("decodes a multi-byte character split across chunks", async () => {
    const encoder = new TextEncoder();
    const bytes = encoder.encode('event: delta\ndata: {"text":"héllo"}\n\n');
    const splitAt = bytes.indexOf(0xc3) + 1; // inside the two bytes of "é"
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, splitAt));
        controller.enqueue(bytes.slice(splitAt));
        controller.close();
      },
    });
    const events = await collect(stream);
    expect(events[0].data).toEqual({ text: "héllo" });
  });

  it("accepts CRLF line endings", async () => {
    const events = await collect(streamOf(['event: usage\r\ndata: {"input_tokens":812}\r\n\r\n']));
    expect(events).toEqual([{ event: "usage", data: { input_tokens: 812 } }]);
  });

  it("joins multi-line data with newlines", async () => {
    const events = await collect(streamOf(['event: done\ndata: {"a":\ndata: 1}\n\n']));
    expect(events).toEqual([{ event: "done", data: { a: 1 } }]);
  });

  it("passes unknown event names through unchanged", async () => {
    const events = await collect(streamOf(['event: guard\ndata: {"verdict":"allow"}\n\n']));
    expect(events).toEqual([{ event: "guard", data: { verdict: "allow" } }]);
  });

  it("defaults the event name to message", async () => {
    const events = await collect(streamOf(["data: {}\n\n"]));
    expect(events).toEqual([{ event: "message", data: {} }]);
  });

  it("ignores comments, id and retry fields, and blank lines without data", async () => {
    const events = await collect(streamOf([': keep-alive\n\nid: 7\nretry: 1000\nevent: delta\ndata: {"text":"x"}\n\n']));
    expect(events).toEqual([{ event: "delta", data: { text: "x" } }]);
  });

  it("yields the final event even without a trailing blank line", async () => {
    const events = await collect(streamOf(['event: done\ndata: {"ok":true}']));
    expect(events).toEqual([{ event: "done", data: { ok: true } }]);
  });

  it("passes non-JSON data through as a string", async () => {
    const events = await collect(streamOf(["event: note\ndata: plain text\n\n"]));
    expect(events).toEqual([{ event: "note", data: "plain text" }]);
  });

  it("stops when the signal aborts", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('event: delta\ndata: {"text":"a"}\n\n'));
        // Never closes: only the abort can end the loop.
      },
    });
    const controller = new AbortController();
    const events: SSEEvent[] = [];
    for await (const event of parseSSE(stream, controller.signal)) {
      events.push(event);
      controller.abort();
    }
    expect(events).toHaveLength(1);
  });

  it("yields nothing when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const events = await collect(streamOf(["event: delta\ndata: {}\n\n"]), controller.signal);
    expect(events).toEqual([]);
  });
});
