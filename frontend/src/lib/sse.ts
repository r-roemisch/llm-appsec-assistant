// A small parser for text/event-stream bodies.
//
// Handles `event:` and `data:` fields, multi-line data (joined with "\n"),
// blank-line delimiters, chunks that split a line, CRLF line endings and
// comment lines. `id:` and `retry:` are accepted and ignored. Data is parsed
// as JSON when possible and passed through as a string otherwise.

export interface SSEEvent {
  event: string;
  data: unknown;
}

function parseData(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}

export async function* parseSSE(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<SSEEvent, void, undefined> {
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8");

  const cancel = () => {
    reader.cancel().catch(() => undefined);
  };
  if (signal?.aborted) {
    cancel();
    return;
  }
  signal?.addEventListener("abort", cancel, { once: true });

  let buffer = "";
  let finished = false;
  let eventName = "";
  let dataLines: string[] = [];
  let hasData = false;

  const flush = (): SSEEvent | null => {
    if (!hasData) {
      eventName = "";
      return null;
    }
    const event: SSEEvent = {
      event: eventName || "message",
      data: parseData(dataLines.join("\n")),
    };
    eventName = "";
    dataLines = [];
    hasData = false;
    return event;
  };

  const handleLine = (rawLine: string): SSEEvent | null => {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    if (line === "") return flush();
    if (line.startsWith(":")) return null;
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "event") {
      eventName = value;
    } else if (field === "data") {
      dataLines.push(value);
      hasData = true;
    }
    return null;
  };

  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) {
        finished = true;
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      let newline = buffer.indexOf("\n");
      while (newline !== -1) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        const event = handleLine(line);
        if (event) yield event;
        newline = buffer.indexOf("\n");
      }
    }
    buffer += decoder.decode();
    if (buffer.length > 0) {
      const event = handleLine(buffer);
      if (event) yield event;
    }
    // The server may close the connection right after the final event
    // without a trailing blank line; do not lose it.
    const last = flush();
    if (last) yield last;
  } catch (error) {
    if (signal?.aborted) return;
    throw error;
  } finally {
    signal?.removeEventListener("abort", cancel);
    // The consumer stopped early (for example after a final event): close the connection.
    if (!finished) cancel();
    reader.releaseLock();
  }
}
