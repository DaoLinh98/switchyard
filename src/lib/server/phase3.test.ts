import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

process.env.SWITCHYARD_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "switchyard-p3-"));

const { db, proxyApiKey } = await import("./db");
const accounts = await import("./accounts");
const { listAccounts } = await import("./providers");
const { updateProviderSettings } = await import("./provider-detail");
const { listTraffic } = await import("./proxy/traffic");
const { POST } = await import("../../app/v1/messages/route");

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>;
function mockFetch(handler: Handler) {
  const fn = vi.fn((input: string | URL | Request, init?: RequestInit) =>
    Promise.resolve(handler(String(input), init))
  );
  vi.stubGlobal("fetch", fn);
  return fn;
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });

function makeToken(access = "tok-access") {
  return { access, refresh: "tok-refresh", expiresAt: Date.now() + 3_600_000 };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Phase 3 - /v1/messages Proxy Core", () => {
  const validKey = proxyApiKey();

  beforeEach(() => {
    // Clear test tables and round-robin cursors
    db().exec("DELETE FROM traffic; DELETE FROM accounts; DELETE FROM conversations; DELETE FROM provider_settings; DELETE FROM settings WHERE key LIKE 'rr_cursor_%';");
  });

  describe("Authentication", () => {
    it("returns 401 when x-api-key is missing or invalid", async () => {
      const reqNoKey = new NextRequest("http://127.0.0.1:8787/v1/messages", {
        method: "POST",
        body: JSON.stringify({ model: "claude-3-7-sonnet-20250219", messages: [] }),
      });
      const res1 = await POST(reqNoKey);
      expect(res1.status).toBe(401);

      const reqBadKey = new NextRequest("http://127.0.0.1:8787/v1/messages", {
        method: "POST",
        headers: { "x-api-key": "bad-key" },
        body: JSON.stringify({ model: "claude-3-7-sonnet-20250219", messages: [] }),
      });
      const res2 = await POST(reqBadKey);
      expect(res2.status).toBe(401);
    });

    it("accepts valid proxy key via x-api-key or Authorization Bearer", async () => {
      accounts.upsertAccount("claude-code", "acc1@x.com", makeToken("tok1"), { email: "acc1@x.com" });
      mockFetch(() => json({ id: "msg_1", type: "message", role: "assistant", content: [{ type: "text", text: "hi" }], usage: { input_tokens: 10, output_tokens: 2 } }));

      const req1 = new NextRequest("http://127.0.0.1:8787/v1/messages", {
        method: "POST",
        headers: { "x-api-key": validKey },
        body: JSON.stringify({ model: "claude-3-7-sonnet-20250219", messages: [{ role: "user", content: "hello" }] }),
      });
      const res1 = await POST(req1);
      expect(res1.status).toBe(200);

      const req2 = new NextRequest("http://127.0.0.1:8787/v1/messages", {
        method: "POST",
        headers: { Authorization: `Bearer ${validKey}` },
        body: JSON.stringify({ model: "claude-3-7-sonnet-20250219", messages: [{ role: "user", content: "hello" }] }),
      });
      const res2 = await POST(req2);
      expect(res2.status).toBe(200);
    });

    it("returns 400 on malformed body or missing model", async () => {
      const reqBadJson = new NextRequest("http://127.0.0.1:8787/v1/messages", {
        method: "POST",
        headers: { "x-api-key": validKey },
        body: "{ bad json",
      });
      const res1 = await POST(reqBadJson);
      expect(res1.status).toBe(400);

      const reqNoModel = new NextRequest("http://127.0.0.1:8787/v1/messages", {
        method: "POST",
        headers: { "x-api-key": validKey },
        body: JSON.stringify({ messages: [] }),
      });
      const res2 = await POST(reqNoModel);
      expect(res2.status).toBe(400);
    });
  });

  describe("Routing and Account Rotation", () => {
    it("returns 503 when no Claude accounts are configured", async () => {
      const req = new NextRequest("http://127.0.0.1:8787/v1/messages", {
        method: "POST",
        headers: { "x-api-key": validKey },
        body: JSON.stringify({ model: "claude-3-7-sonnet-20250219", messages: [] }),
      });
      const res = await POST(req);
      expect(res.status).toBe(503);
    });

    it("rotates accounts in round-robin mode across requests", async () => {
      accounts.upsertAccount("claude-code", "one@x.com", makeToken("tok1"), { email: "one@x.com" });
      accounts.upsertAccount("claude-code", "two@x.com", makeToken("tok2"), { email: "two@x.com" });
      updateProviderSettings("claude-code", { roundRobin: true, sticky: 1 });

      const capturedAuthTokens: string[] = [];
      mockFetch((url, init) => {
        const auth = (init?.headers as Record<string, string>)?.["Authorization"];
        if (auth) capturedAuthTokens.push(auth);
        return json({ id: "msg_ok", content: [], usage: { input_tokens: 5, output_tokens: 5 } });
      });

      const send = () =>
        POST(
          new NextRequest("http://127.0.0.1:8787/v1/messages", {
            method: "POST",
            headers: { "x-api-key": validKey },
            body: JSON.stringify({ model: "claude-3-7-sonnet-20250219", messages: [{ role: "user", content: "test" }] }),
          })
        );

      await send();
      await send();
      await send();

      // Should cycle: tok1, tok2, tok1
      expect(capturedAuthTokens).toEqual(["Bearer tok1", "Bearer tok2", "Bearer tok1"]);
    });

    it("respects sticky conversation pinning", async () => {
      accounts.upsertAccount("claude-code", "one@x.com", makeToken("tok1"), { email: "one@x.com" });
      accounts.upsertAccount("claude-code", "two@x.com", makeToken("tok2"), { email: "two@x.com" });
      updateProviderSettings("claude-code", { roundRobin: true, sticky: 1 });

      const capturedAuthTokens: string[] = [];
      mockFetch((url, init) => {
        const auth = (init?.headers as Record<string, string>)?.["Authorization"];
        if (auth) capturedAuthTokens.push(auth);
        return json({ id: "msg_ok", content: [], usage: { input_tokens: 5, output_tokens: 5 } });
      });

      const sendWithConv = (convId: string) =>
        POST(
          new NextRequest("http://127.0.0.1:8787/v1/messages", {
            method: "POST",
            headers: { "x-api-key": validKey, "x-conversation-id": convId },
            body: JSON.stringify({ model: "claude-3-7-sonnet-20250219", messages: [{ role: "user", content: "test" }] }),
          })
        );

      // Session A starts on tok1
      await sendWithConv("session-alpha");
      // Session A sends another message -> should stay on tok1 due to sticky
      await sendWithConv("session-alpha");
      // Session B starts -> round robin moves to tok2
      await sendWithConv("session-beta");
      // Session A sends another message -> should still stay on tok1!
      await sendWithConv("session-alpha");

      expect(capturedAuthTokens).toEqual(["Bearer tok1", "Bearer tok1", "Bearer tok2", "Bearer tok1"]);
    });
  });

  describe("Failover on 429 Rate Limit", () => {
    it("fails over to next account and puts rate-limited account into cooldown", async () => {
      accounts.upsertAccount("claude-code", "busy@x.com", makeToken("tok-busy"), { email: "busy@x.com" });
      accounts.upsertAccount("claude-code", "backup@x.com", makeToken("tok-backup"), { email: "backup@x.com" });
      updateProviderSettings("claude-code", { roundRobin: false, sticky: 1 });

      mockFetch((url, init) => {
        const auth = (init?.headers as Record<string, string>)?.["Authorization"];
        if (auth === "Bearer tok-busy") {
          return json({ type: "error", error: { type: "rate_limit_error", message: "busy" } }, 429, { "retry-after": "120" });
        }
        return json({ id: "msg_backup", content: [{ type: "text", text: "success from backup" }], usage: { input_tokens: 20, output_tokens: 15 } });
      });

      const res = await POST(
        new NextRequest("http://127.0.0.1:8787/v1/messages", {
          method: "POST",
          headers: { "x-api-key": validKey },
          body: JSON.stringify({ model: "claude-3-7-sonnet-20250219", messages: [{ role: "user", content: "test" }] }),
        })
      );

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.id).toBe("msg_backup");

      // Verify cooldown on first account
      const accList = listAccounts("claude-code");
      const busyAcc = accList.find((a) => a.meta.email === "busy@x.com");
      expect(busyAcc?.cooldownUntil).toBeGreaterThan(Date.now());

      // Verify traffic log shows failover switch
      const logs = listTraffic(5);
      expect(logs.length).toBe(1);
      expect(logs[0].status).toBe(200);
      expect(logs[0].switched).toBe(1);
      expect(logs[0].account).toBe("backup@x.com");
      const attempts = JSON.parse(logs[0].attempts);
      expect(attempts.length).toBe(1);
      expect(attempts[0].status).toBe(429);
    });
  });

  describe("Streaming and Traffic Logging", () => {
    it("streams SSE chunks and logs token counts upon completion", async () => {
      accounts.upsertAccount("claude-code", "stream@x.com", makeToken("tok-stream"), { email: "stream@x.com" });

      const ssePayload = [
        `event: message_start\ndata: {"type":"message_start","message":{"id":"msg_s","type":"message","role":"assistant","usage":{"input_tokens":32,"output_tokens":1}}}\n\n`,
        `event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello world"}}\n\n`,
        `event: message_delta\ndata: {"type":"message_delta","usage":{"output_tokens":24}}\n\n`,
        `event: message_stop\ndata: {"type":"message_stop"}\n\n`,
      ].join("");

      mockFetch(() => {
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(ssePayload));
            controller.close();
          },
        });
        return new Response(stream, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        });
      });

      const res = await POST(
        new NextRequest("http://127.0.0.1:8787/v1/messages", {
          method: "POST",
          headers: { "x-api-key": validKey },
          body: JSON.stringify({ model: "claude-3-7-sonnet-20250219", stream: true, messages: [{ role: "user", content: "test" }] }),
        })
      );

      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toContain("text/event-stream");

      // Read response stream completely to trigger flush
      const text = await res.text();
      expect(text).toContain("Hello world");

      // Verify traffic log extracted tokens from SSE
      const logs = listTraffic(5);
      expect(logs.length).toBe(1);
      expect(logs[0].status).toBe(200);
      expect(logs[0].tokens_in).toBe(32);
      expect(logs[0].tokens_out).toBe(24);
      expect(logs[0].asked).toBe("claude-3-7-sonnet-20250219");
    });
  });

  describe("Antigravity / Gemini 3.8 Flash Translator", () => {
    it("sanitizes complex JSON schemas, eliminating anyOf/oneOf and adding fallback properties", async () => {
      const { cleanJsonSchemaForGemini } = await import("./proxy/translators/antigravity-request");

      // Schema with anyOf, allOf, empty object
      const schemaWithAnyOf = {
        type: "object",
        properties: {
          path: {
            anyOf: [{ type: "string", description: "a string" }, { type: "null" }],
          },
          options: {
            type: "object",
          },
          tag: {
            allOf: [
              { properties: { name: { type: "string" } }, required: ["name"] },
              { properties: { id: { type: "number" } } },
            ],
          },
        },
        required: ["path", "nonexistent"],
      };

      const cleaned = cleanJsonSchemaForGemini(schemaWithAnyOf);

      // anyOf must be eliminated
      expect(cleaned.anyOf).toBeUndefined();
      expect(cleaned.properties).toBeDefined();
      const props = cleaned.properties as Record<string, any>;
      expect(props.path.type).toBe("string");
      expect(props.path.nullable).toBe(true);

      // empty object must have fallback properties
      expect(props.options.properties).toBeDefined();
      expect(props.options.properties.reason).toBeDefined();
      expect(props.options.required).toEqual(["reason"]);

      // allOf merged
      expect(props.tag.properties.name).toBeDefined();
      expect(props.tag.properties.id).toBeDefined();
      expect(props.tag.required).toEqual(["name"]);

      // required pruned of nonexistent keys
      expect(cleaned.required).toEqual(["path"]);
    });

    it("merges consecutive turns of the same role and ensures valid start/end roles", async () => {
      const { translateClaudeToGemini } = await import("./proxy/translators/antigravity-request");

      const req = translateClaudeToGemini(
        {
          model: "ag/gemini-3.8-flash",
          messages: [
            { role: "user", content: "part 1" },
            { role: "user", content: "part 2" },
            { role: "assistant", content: "response 1" },
          ],
        },
        "proj-test",
        "gemini-3.8-flash-medium"
      );

      expect(req.project).toBe("proj-test");
      expect(req.model).toBe("gemini-3.8-flash-medium");
      expect(req.userAgent).toBe("antigravity");
      expect(req.requestId).toMatch(/^agent-/);
      expect(req.request.sessionId).toBeTruthy();

      // First two user messages should be merged into one turn
      expect(req.request.contents[0].role).toBe("user");
      expect(req.request.contents[0].parts.length).toBe(2);

      // Trailing assistant message must have a synthetic user follow-up turn appended
      const lastTurn = req.request.contents[req.request.contents.length - 1];
      expect(lastTurn.role).toBe("user");
      expect(lastTurn.parts[0].text).toBe("Continue.");
    });
  });
});
