import { rememberThoughtSignature } from "./antigravity-signatures";

/**
 * Translates Google Cloud Code / Gemini stream chunks into Anthropic SSE events.
 */

export interface GeminiCandidatePart {
  text?: string;
  thought?: boolean;
  thoughtSignature?: string;
  thought_signature?: string;
  functionCall?: {
    name: string;
    args: Record<string, unknown>;
  };
}

export interface GeminiCandidate {
  content?: {
    role?: string;
    parts?: GeminiCandidatePart[];
  };
  finishReason?: string;
}

export interface GeminiChunk {
  candidates?: GeminiCandidate[];
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
}

export function sseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/**
 * Creates a TransformStream that takes Google Cloud Code / Gemini raw response stream
 * and converts it into valid Anthropic SSE events (`message_start`, `content_block_delta`, `message_delta`, etc.).
 */
export function createGeminiToAnthropicSseStream(
  messageId: string,
  modelName: string,
  onDone?: (usage: { inputTokens?: number; outputTokens?: number }) => void
): TransformStream<Uint8Array, Uint8Array> {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let buffer = "";

  let messageStarted = false;
  let currentBlockIndex = 0;
  let activeBlockType: "text" | "thinking" | "tool_use" | null = null;
  let hadToolUse = false;
  let lastThoughtSignature: string | undefined;
  let inputTokens = 0;
  let outputTokens = 0;

  function emit(controller: TransformStreamDefaultController<Uint8Array>, event: string, data: unknown) {
    controller.enqueue(encoder.encode(sseEvent(event, data)));
  }

  function ensureMessageStarted(controller: TransformStreamDefaultController<Uint8Array>) {
    if (!messageStarted) {
      messageStarted = true;
      emit(controller, "message_start", {
        type: "message_start",
        message: {
          id: messageId,
          type: "message",
          role: "assistant",
          model: modelName,
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: inputTokens, output_tokens: 0 },
        },
      });
    }
  }

  function processChunk(controller: TransformStreamDefaultController<Uint8Array>, chunk: GeminiChunk) {
    if (chunk.usageMetadata) {
      if (chunk.usageMetadata.promptTokenCount) inputTokens = chunk.usageMetadata.promptTokenCount;
      if (chunk.usageMetadata.candidatesTokenCount) outputTokens = chunk.usageMetadata.candidatesTokenCount;
    }

    ensureMessageStarted(controller);

    const candidate = chunk.candidates?.[0];
    if (!candidate || !candidate.content?.parts) return;

    for (const part of candidate.content.parts) {
      const sig = part.thoughtSignature || part.thought_signature;
      if (sig) {
        lastThoughtSignature = sig;
      }

      if (part.thought) {
        // Thinking / reasoning block
        if (activeBlockType !== "thinking") {
          if (activeBlockType !== null) {
            emit(controller, "content_block_stop", { type: "content_block_stop", index: currentBlockIndex });
            currentBlockIndex++;
          }
          activeBlockType = "thinking";
          emit(controller, "content_block_start", {
            type: "content_block_start",
            index: currentBlockIndex,
            content_block: { type: "thinking", thinking: "" },
          });
        }
        if (part.text) {
          emit(controller, "content_block_delta", {
            type: "content_block_delta",
            index: currentBlockIndex,
            delta: { type: "thinking_delta", thinking: part.text },
          });
        }
      } else if (part.functionCall) {
        // Tool use block
        hadToolUse = true;
        if (activeBlockType !== null) {
          emit(controller, "content_block_stop", { type: "content_block_stop", index: currentBlockIndex });
          currentBlockIndex++;
        }
        activeBlockType = "tool_use";
        const toolUseId = "call_" + Math.random().toString(36).substring(2, 11);
        const effectiveSig = sig || lastThoughtSignature;
        if (effectiveSig) {
          rememberThoughtSignature(toolUseId, effectiveSig);
        }
        emit(controller, "content_block_start", {
          type: "content_block_start",
          index: currentBlockIndex,
          content_block: {
            type: "tool_use",
            id: toolUseId,
            name: part.functionCall.name,
            input: {},
          },
        });
        emit(controller, "content_block_delta", {
          type: "content_block_delta",
          index: currentBlockIndex,
          delta: {
            type: "input_json_delta",
            partial_json: JSON.stringify(part.functionCall.args ?? {}),
          },
        });
        emit(controller, "content_block_stop", { type: "content_block_stop", index: currentBlockIndex });
        currentBlockIndex++;
        activeBlockType = null;
      } else if (part.text) {
        // Normal text block
        if (activeBlockType !== "text") {
          if (activeBlockType !== null) {
            emit(controller, "content_block_stop", { type: "content_block_stop", index: currentBlockIndex });
            currentBlockIndex++;
          }
          activeBlockType = "text";
          emit(controller, "content_block_start", {
            type: "content_block_start",
            index: currentBlockIndex,
            content_block: { type: "text", text: "" },
          });
        }
        emit(controller, "content_block_delta", {
          type: "content_block_delta",
          index: currentBlockIndex,
          delta: { type: "text_delta", text: part.text },
        });
      }
    }
  }

  function parseLines(controller: TransformStreamDefaultController<Uint8Array>) {
    // Google Cloud Code returns either SSE lines (data: {...}) or raw JSON arrays
    let startIdx = 0;
    while (true) {
      const newlineIdx = buffer.indexOf("\n", startIdx);
      if (newlineIdx === -1) break;

      const rawLine = buffer.slice(startIdx, newlineIdx).trim();
      startIdx = newlineIdx + 1;

      if (!rawLine) continue;

      let jsonText = rawLine;
      if (rawLine.startsWith("data:")) {
        jsonText = rawLine.slice(5).trim();
      }

      // Handle JSON chunk
      if (jsonText && jsonText !== "[DONE]") {
        try {
          // If chunk starts with [, remove array wrapper
          if (jsonText.startsWith("[")) jsonText = jsonText.slice(1);
          if (jsonText.endsWith(",")) jsonText = jsonText.slice(0, -1);
          if (jsonText.endsWith("]")) jsonText = jsonText.slice(0, -1);

          const parsed = JSON.parse(jsonText.trim());
          const target = parsed.response ?? parsed;
          processChunk(controller, target);
        } catch {
          // not a complete JSON line yet, wait for more data
        }
      }
    }
    buffer = buffer.slice(startIdx);
  }

  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true });
      parseLines(controller);
    },
    flush(controller) {
      if (buffer.trim()) {
        try {
          const parsed = JSON.parse(buffer.trim());
          const target = parsed.response ?? parsed;
          processChunk(controller, target);
        } catch {
          // ignore trailing invalid buffer
        }
      }

      ensureMessageStarted(controller);

      if (activeBlockType !== null) {
        emit(controller, "content_block_stop", { type: "content_block_stop", index: currentBlockIndex });
      }

      const stopReason = hadToolUse ? "tool_use" : "end_turn";
      emit(controller, "message_delta", {
        type: "message_delta",
        delta: { stop_reason: stopReason, stop_sequence: null },
        usage: { output_tokens: outputTokens },
      });

      emit(controller, "message_stop", { type: "message_stop" });

      onDone?.({ inputTokens, outputTokens });
    },
  });
}
