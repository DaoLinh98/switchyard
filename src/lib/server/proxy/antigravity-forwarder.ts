import { accessToken, type AccountMetaFull } from "../accounts";
import { listAccounts } from "../providers";
import { AG } from "../oauth/antigravity";
import { db } from "../db";
import { translateClaudeToGemini, type ClaudeMessagesPayload } from "./translators/antigravity-request";
import { createGeminiToAnthropicSseStream } from "./translators/antigravity-stream";
import { rememberThoughtSignature } from "./translators/antigravity-signatures";

export interface AntigravityForwardOptions {
  accountId: string;
  model: string;
  body: Record<string, unknown>;
  signal?: AbortSignal;
}

export interface AntigravityForwardResult {
  response: Response;
  status: number;
  sseStream?: ReadableStream<Uint8Array>;
  onStreamDone?: (cb: (usage: { inputTokens?: number; outputTokens?: number }) => void) => void;
}

function getProviderCustomHeaders(provider: string): Record<string, string> {
  const row = db().prepare("SELECT headers FROM provider_settings WHERE provider = ?").get(provider) as
    | { headers: string }
    | undefined;
  if (!row?.headers) return {};
  try {
    const list = JSON.parse(row.headers) as { name: string; value: string }[];
    const res: Record<string, string> = {};
    for (const h of list) {
      if (h.name && h.value) res[h.name] = h.value;
    }
    return res;
  } catch {
    return {};
  }
}

export async function forwardToAntigravity(opts: AntigravityForwardOptions): Promise<AntigravityForwardResult> {
  const access = await accessToken(opts.accountId);
  const account = listAccounts("antigravity").find((a) => a.id === opts.accountId);
  const project = (account?.meta as AccountMetaFull)?.project;
  if (!project) {
    throw new Error("Antigravity account has no Cloud Code project configured; please reconnect.");
  }

  // Model ID mapping: strip 'ag/' prefix if present
  let targetModel = opts.model;
  if (targetModel.startsWith("ag/")) {
    targetModel = targetModel.slice(3);
  }

  const AG_MODEL_SYNONYMS: Record<string, string> = {
    "gemini-default": "gemini-3.8-flash-medium",
    "gemini-flash": "gemini-3.8-flash-medium",
    "gemini-3.8-flash": "gemini-3.8-flash-medium",
    "gemini-3.8-flash-tiered": "gemini-3.8-flash-medium",
    "gemini-3.7-flash": "gemini-3.7-flash-medium",
    "gemini-3.7-flash-tiered": "gemini-3.7-flash-medium",
    "gemini-3.6-flash": "gemini-3.6-flash-medium",
    "gemini-3.6-flash-tiered": "gemini-3.6-flash-medium",
    "gemini-3.5-flash": "gemini-3.5-flash-low",
    "claude-sonnet-5-5": "claude-sonnet-5-5-high",
    "claude-sonnet-5.5": "claude-sonnet-5-5-high",
    "claude-opus-5-5": "claude-opus-5-5-high",
    "claude-opus-5.5": "claude-opus-5-5-high",
    "claude-3-5-sonnet": "claude-sonnet-5-5-high",
    "claude-3-7-sonnet": "claude-sonnet-5-5-high",
  };
  if (AG_MODEL_SYNONYMS[targetModel]) {
    targetModel = AG_MODEL_SYNONYMS[targetModel];
  }

  const geminiPayload = translateClaudeToGemini(
    opts.body as unknown as ClaudeMessagesPayload,
    project,
    targetModel
  );

  const customHeaders = getProviderCustomHeaders("antigravity");
  const headers: Record<string, string> = {
    Authorization: `Bearer ${access}`,
    "User-Agent": AG.userAgent,
    "Content-Type": "application/json",
    ...customHeaders,
  };

  const isStream = Boolean(opts.body.stream);
  const methodEndpoint = isStream ? ":streamGenerateContent?alt=sse" : ":generateContent";

  let lastRes: { response: Response; status: number } | undefined;
  for (const base of AG.apiBases) {
    try {
      const url = `${base}/v1internal${methodEndpoint}`;
      const res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(geminiPayload),
        signal: opts.signal,
      });

      if (!res.ok) {
        lastRes = { response: res, status: res.status };
        // If not the last base, try next base on upstream errors (e.g. daily -> prod or vice versa, including 429)
        if (base !== AG.apiBases[AG.apiBases.length - 1] && res.status !== 400) {
          continue;
        }
        return lastRes;
      }

      if (isStream) {
        if (!res.body) {
          throw new Error("Antigravity stream response body is null");
        }

        let streamDoneCb: ((usage: { inputTokens?: number; outputTokens?: number }) => void) | undefined;
        const msgId = "msg_" + Math.random().toString(36).substring(2, 14);
        const transform = createGeminiToAnthropicSseStream(msgId, opts.model, (usage) => {
          streamDoneCb?.(usage);
        });

        const sseStream = res.body.pipeThrough(transform);
        return {
          response: res,
          status: 200,
          sseStream,
          onStreamDone: (cb) => {
            streamDoneCb = cb;
          },
        };
      }

      // Non-streaming response translation: Cloud Code returns { response: { candidates, usageMetadata } }
      const raw = (await res.json()) as any;
      const data = raw.response ?? raw;
      const candidate = data.candidates?.[0];
      const content: any[] = [];
      let stopReason = "end_turn";
      let lastThoughtSig: string | undefined;

      for (const part of candidate?.content?.parts ?? []) {
        const sig = part.thoughtSignature || part.thought_signature;
        if (sig) lastThoughtSig = sig;

        if (part.text) {
          content.push({ type: "text", text: part.text });
        } else if (part.functionCall) {
          stopReason = "tool_use";
          const toolUseId = "call_" + Math.random().toString(36).substring(2, 11);
          const effectiveSig = sig || lastThoughtSig;
          if (effectiveSig) {
            rememberThoughtSignature(toolUseId, effectiveSig);
          }
          content.push({
            type: "tool_use",
            id: toolUseId,
            name: part.functionCall.name,
            input: part.functionCall.args ?? {},
          });
        }
      }

      if (content.length === 0) {
        content.push({ type: "text", text: "" });
      }

      const anthropicResponse = {
        id: "msg_" + Math.random().toString(36).substring(2, 14),
        type: "message",
        role: "assistant",
        model: opts.model,
        content,
        stop_reason: stopReason,
        stop_sequence: null,
        usage: {
          input_tokens: data.usageMetadata?.promptTokenCount ?? 0,
          output_tokens: data.usageMetadata?.candidatesTokenCount ?? 0,
        },
      };

      return {
        response: Response.json(anthropicResponse),
        status: 200,
      };
    } catch (err) {
      lastErr = err;
    }
  }

  throw lastErr;
}
