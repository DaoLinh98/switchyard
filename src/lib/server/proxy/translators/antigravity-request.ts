import { getThoughtSignature } from "./antigravity-signatures";

/**
 * Translates Anthropic /v1/messages payload to Google Cloud Code / Gemini format.
 */

export interface ClaudeMessageContent {
  type: "text" | "image" | "tool_use" | "tool_result" | "thinking";
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: string | Array<{ type: string; text?: string }>;
  thinking?: string;
  signature?: string;
}

export interface ClaudeMessage {
  role: "user" | "assistant";
  content: string | ClaudeMessageContent[];
}

export interface ClaudeTool {
  name: string;
  description?: string;
  input_schema?: Record<string, unknown>;
}

export interface ClaudeMessagesPayload {
  model: string;
  messages: ClaudeMessage[];
  system?: string | Array<{ type: string; text: string }>;
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  tools?: ClaudeTool[];
  thinking?: {
    type?: "enabled" | "disabled" | "adaptive";
    budget_tokens?: number;
  };
}

export interface GeminiPart {
  text?: string;
  functionCall?: {
    name: string;
    args: Record<string, unknown>;
  };
  functionResponse?: {
    name: string;
    response: Record<string, unknown>;
  };
  thought?: boolean;
  thoughtSignature?: string;
  thought_signature?: string;
}

export interface GeminiContent {
  role: "user" | "model";
  parts: GeminiPart[];
}

export interface GeminiGenerationConfig {
  maxOutputTokens?: number;
  temperature?: number;
  topP?: number;
  thinkingConfig?: {
    thinkingBudget?: number;
  };
}

export interface CloudCodeGenerateContentRequest {
  project: string;
  model: string;
  userAgent?: string;
  requestId?: string;
  request: {
    sessionId?: string;
    contents: GeminiContent[];
    systemInstruction?: {
      parts: Array<{ text: string }>;
    };
    tools?: Array<{
      functionDeclarations: Array<{
        name: string;
        description?: string;
        parameters?: Record<string, unknown>;
      }>;
    }>;
    toolConfig?: {
      functionCallingConfig: {
        mode: "VALIDATED" | "AUTO";
      };
    };
    generationConfig?: GeminiGenerationConfig;
  };
}

function scoreSchemaOption(opt: Record<string, unknown>): number {
  if (opt.type === "object" || opt.properties) return 3;
  if (opt.type === "array" || opt.items) return 2;
  if (opt.type && opt.type !== "null") return 1;
  return 0;
}

function generateSessionId(): string {
  const adjs = ["useful", "bright", "swift", "calm", "bold"];
  const nouns = ["fuze", "wave", "spark", "flow", "core"];
  const adj = adjs[Math.floor(Math.random() * adjs.length)];
  const noun = nouns[Math.floor(Math.random() * nouns.length)];
  return `${adj}-${noun}-${crypto.randomUUID().slice(0, 5)}`;
}

/**
 * Sanitizes an Anthropic JSON Schema into Google Cloud Code / Gemini Schema.
 * Uses a strict WHITELIST of allowed Google Protobuf fields to prevent any
 * "Unknown name '...' Cannot find field" errors.
 */
export function cleanJsonSchemaForGemini(schema: unknown): Record<string, unknown> {
  if (typeof schema !== "object" || schema === null) {
    return {
      type: "object",
      properties: {
        reason: { type: "string", description: "Brief explanation of why you are calling this tool" },
      },
      required: ["reason"],
    };
  }

  let src = { ...(schema as Record<string, unknown>) };

  // 1. Handle allOf by merging
  if (Array.isArray(src.allOf) && src.allOf.length > 0) {
    const mergedProps: Record<string, unknown> = {};
    const mergedReq: string[] = [];
    for (const sub of src.allOf) {
      if (typeof sub === "object" && sub !== null) {
        if ((sub as any).properties) {
          Object.assign(mergedProps, (sub as any).properties);
        }
        if (Array.isArray((sub as any).required)) {
          for (const r of (sub as any).required) {
            if (!mergedReq.includes(r)) mergedReq.push(r);
          }
        }
      }
    }
    delete src.allOf;
    if (Object.keys(mergedProps).length > 0) {
      src.properties = { ...((src.properties as Record<string, unknown>) || {}), ...mergedProps };
    }
    if (mergedReq.length > 0) {
      src.required = [...((src.required as string[]) || []), ...mergedReq];
    }
  }

  // 2. Handle anyOf / oneOf by picking the best candidate (Google Protobuf Schema has NO anyOf/oneOf field)
  const anyOfSrc = src.anyOf || src.oneOf;
  if (Array.isArray(anyOfSrc) && anyOfSrc.length > 0) {
    const valid = anyOfSrc.filter(
      (opt): opt is Record<string, unknown> => typeof opt === "object" && opt !== null && opt.type !== "null"
    );
    const hasNull = anyOfSrc.some((opt) => typeof opt === "object" && opt !== null && opt.type === "null");
    if (valid.length > 0) {
      let bestIdx = 0;
      let bestScore = -1;
      for (let i = 0; i < valid.length; i++) {
        const score = scoreSchemaOption(valid[i]);
        if (score > bestScore) {
          bestScore = score;
          bestIdx = i;
        }
      }
      const chosen = valid[bestIdx];
      delete src.anyOf;
      delete src.oneOf;
      src = { ...src, ...chosen };
    } else {
      delete src.anyOf;
      delete src.oneOf;
    }
    if (hasNull) {
      src.nullable = true;
    }
  }

  const clean: Record<string, unknown> = {};

  // 3. Process description
  if (typeof src.description === "string" && src.description.trim()) {
    clean.description = src.description;
  }

  // 4. Process nullable
  if (src.nullable === true) {
    clean.nullable = true;
  }

  // 5. Process type (and union types like ["string", "null"])
  let typeVal = src.type;
  if (Array.isArray(typeVal)) {
    if (typeVal.includes("null")) {
      clean.nullable = true;
    }
    const nonNull = typeVal.filter((t) => t !== "null");
    if (nonNull.length === 0) {
      typeVal = "string";
    } else if (nonNull.includes("object") && src.properties) {
      typeVal = "object";
    } else if (nonNull.includes("array") && src.items) {
      typeVal = "array";
    } else {
      typeVal = nonNull[0];
    }
  }
  if (typeof typeVal === "string") {
    clean.type = typeVal.toLowerCase();
  }

  // 6. Process enum (or convert const to enum)
  let enumVals: unknown[] | undefined;
  if (src.const !== undefined) {
    enumVals = [src.const];
  } else if (Array.isArray(src.enum)) {
    enumVals = src.enum;
  }

  if (enumVals && enumVals.length > 0) {
    clean.enum = enumVals.map((v) => String(v));
    if (!clean.type) {
      clean.type = "string";
    }
  }

  // 7. Process format (only known valid protobuf formats)
  if (typeof src.format === "string") {
    const validFormats = ["int32", "int64", "float", "double", "byte", "date-time"];
    if (validFormats.includes(src.format.toLowerCase())) {
      clean.format = src.format.toLowerCase();
    }
  }

  // 8. Process properties (recursively)
  if (src.properties && typeof src.properties === "object" && !Array.isArray(src.properties)) {
    const cleanProps: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(src.properties as Record<string, unknown>)) {
      cleanProps[k] = cleanJsonSchemaForGemini(v);
    }
    clean.properties = cleanProps;
    if (!clean.type) {
      clean.type = "object";
    }
  }

  // 9. Process items (recursively)
  if (src.items) {
    if (Array.isArray(src.items)) {
      clean.items = src.items.length > 0 ? cleanJsonSchemaForGemini(src.items[0]) : { type: "string" };
    } else {
      clean.items = cleanJsonSchemaForGemini(src.items);
    }
    if (!clean.type) {
      clean.type = "array";
    }
  }

  // 10. Fallback type inference if still missing
  if (!clean.type) {
    if (clean.properties) {
      clean.type = "object";
    } else if (clean.items) {
      clean.type = "array";
    } else {
      clean.type = "string";
    }
  }

  // 11. Normalize object properties and required array
  if (clean.type === "object") {
    if (!clean.properties || Object.keys(clean.properties).length === 0) {
      clean.properties = {
        reason: { type: "string", description: "Brief explanation of why you are calling this tool" },
      };
      clean.required = ["reason"];
    } else if (Array.isArray(src.required)) {
      const validReq = src.required.filter(
        (r) => typeof r === "string" && Object.prototype.hasOwnProperty.call(clean.properties, r)
      );
      if (validReq.length > 0) {
        clean.required = validReq;
      }
    }
  } else {
    // Non-object types must not contain properties or required
    delete clean.properties;
    delete clean.required;
  }

  // 12. Normalize array items
  if (clean.type === "array") {
    if (!clean.items || Object.keys(clean.items).length === 0) {
      clean.items = { type: "string" };
    }
  } else {
    delete clean.items;
  }

  return clean;
}

export function translateClaudeToGemini(
  payload: ClaudeMessagesPayload,
  project: string,
  targetModel: string
): CloudCodeGenerateContentRequest {
  const contents: GeminiContent[] = [];

  // 1. Process System Instruction
  let systemText = "";
  if (typeof payload.system === "string") {
    systemText = payload.system;
  } else if (Array.isArray(payload.system)) {
    systemText = payload.system
      .filter((s) => s.type === "text" && s.text)
      .map((s) => s.text)
      .join("\n\n");
  }

  // 2. Map tool definitions
  let tools: CloudCodeGenerateContentRequest["request"]["tools"];
  if (payload.tools && payload.tools.length > 0) {
    tools = [
      {
        functionDeclarations: payload.tools.map((t) => ({
          name: t.name,
          description: t.description ?? "",
          parameters: cleanJsonSchemaForGemini(t.input_schema ?? { type: "object", properties: {} }),
        })),
      },
    ];
  }

  // 3. Build tool_use_id -> name map and process conversation messages
  const toolUseIdToName = new Map<string, string>();
  for (const msg of payload.messages) {
    if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block.type === "tool_use" && block.id && block.name) {
          toolUseIdToName.set(block.id, block.name);
        }
      }
    }
  }

  for (const msg of payload.messages) {
    const role: "user" | "model" = msg.role === "assistant" ? "model" : "user";
    const parts: GeminiPart[] = [];

    if (typeof msg.content === "string") {
      if (msg.content.trim()) {
        parts.push({ text: msg.content });
      }
    } else if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block.type === "text" && block.text) {
          parts.push({ text: block.text });
        } else if (block.type === "thinking" && block.thinking) {
          parts.push({ text: block.thinking, thought: true });
        } else if (block.type === "tool_use" && block.name) {
          const sig = getThoughtSignature(block.id);
          parts.push({
            functionCall: {
              name: block.name,
              args: block.input ?? {},
            },
            thoughtSignature: sig,
            thought_signature: sig,
          });
        } else if (block.type === "tool_result") {
          let responseContent: Record<string, unknown> = {};
          if (typeof block.content === "string") {
            try {
              responseContent = JSON.parse(block.content);
              if (typeof responseContent !== "object" || responseContent === null) {
                responseContent = { result: block.content };
              }
            } catch {
              responseContent = { result: block.content };
            }
          } else if (Array.isArray(block.content)) {
            const joinedText = block.content
              .filter((c) => c.text)
              .map((c) => c.text)
              .join("\n");
            responseContent = { result: joinedText };
          }
          const fnName = (block.tool_use_id ? toolUseIdToName.get(block.tool_use_id) : undefined) ?? "tool_result";
          parts.push({
            functionResponse: {
              name: fnName,
              response: responseContent,
            },
          });
        }
      }
    }

    if (parts.length > 0) {
      const last = contents[contents.length - 1];
      if (last && last.role === role) {
        last.parts.push(...parts);
      } else {
        contents.push({ role, parts });
      }
    }
  }

  // Ensure contents has valid turn alternation and start/end roles
  if (contents.length === 0) {
    contents.push({ role: "user", parts: [{ text: "Hello" }] });
  } else {
    if (contents[0].role !== "user") {
      contents.unshift({ role: "user", parts: [{ text: "..." }] });
    }
    const lastContent = contents[contents.length - 1];
    if (lastContent.role === "model") {
      const fnCalls = (lastContent.parts || []).filter((p) => p.functionCall);
      if (fnCalls.length > 0) {
        contents.push({
          role: "user",
          parts: fnCalls.map((p) => ({
            functionResponse: {
              name: p.functionCall?.name || "tool",
              response: { result: "Continue." },
            },
          })),
        });
      } else {
        contents.push({ role: "user", parts: [{ text: "Continue." }] });
      }
    }
  }

  // 4. Generation Config
  const generationConfig: GeminiGenerationConfig = {};
  if (payload.max_tokens) generationConfig.maxOutputTokens = payload.max_tokens;
  if (payload.temperature !== undefined) generationConfig.temperature = payload.temperature;
  if (payload.top_p !== undefined) generationConfig.topP = payload.top_p;

  if (payload.thinking && payload.thinking.type !== "disabled") {
    if (typeof payload.thinking.budget_tokens === "number" && payload.thinking.budget_tokens >= 0) {
      generationConfig.thinkingConfig = {
        thinkingBudget: payload.thinking.budget_tokens,
      };
    }
  }

  const innerRequest: CloudCodeGenerateContentRequest["request"] = {
    sessionId: generateSessionId(),
    contents,
  };

  if (systemText.trim()) {
    innerRequest.systemInstruction = {
      parts: [{ text: systemText }],
    };
  }

  if (tools && tools.length > 0) {
    innerRequest.tools = tools;
    innerRequest.toolConfig = { functionCallingConfig: { mode: "VALIDATED" } };
  }

  if (Object.keys(generationConfig).length > 0) {
    innerRequest.generationConfig = generationConfig;
  }

  return {
    project,
    model: targetModel,
    userAgent: "antigravity",
    requestId: `agent-${crypto.randomUUID()}`,
    request: innerRequest,
  };
}
