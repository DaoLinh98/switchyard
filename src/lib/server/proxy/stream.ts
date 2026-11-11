export interface StreamUsage {
  inputTokens?: number;
  outputTokens?: number;
}

/**
 * Wraps a ReadableStream from upstream SSE, parsing token usage in the background
 * without slowing down chunk delivery, and invoking onDone when the stream completes.
 */
export function tapSseStream(
  source: ReadableStream<Uint8Array>,
  callbacks: {
    onDone?: (usage: StreamUsage) => void;
    onError?: (err: unknown) => void;
  }
): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  let buffer = "";
  let inputTokens: number | undefined;
  let outputTokens: number | undefined;

  function parseLine(line: string) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) return;
    const jsonStr = trimmed.slice(5).trim();
    if (!jsonStr || jsonStr === "[DONE]") return;
    try {
      const data = JSON.parse(jsonStr);
      if (data.type === "message_start" && data.message?.usage?.input_tokens !== undefined) {
        inputTokens = data.message.usage.input_tokens;
      } else if (data.type === "message_delta" && data.usage?.output_tokens !== undefined) {
        outputTokens = data.usage.output_tokens;
      }
    } catch {
      // ignore partial or unparseable JSON
    }
  }

  const transform = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      controller.enqueue(chunk);
      try {
        buffer += decoder.decode(chunk, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          parseLine(line);
        }
      } catch (err) {
        // parsing failure shouldn't kill stream transfer
      }
    },
    flush() {
      if (buffer) {
        parseLine(buffer);
      }
      callbacks.onDone?.({ inputTokens, outputTokens });
    },
  });

  return source.pipeThrough(transform);
}
