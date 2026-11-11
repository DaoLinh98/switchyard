import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

process.env.SWITCHYARD_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "switchyard-p2-"));
delete process.env.ANTIGRAVITY_CLIENT_ID;
delete process.env.ANTIGRAVITY_CLIENT_SECRET;

const { db } = await import("./db");
const { unseal } = await import("./crypto");
const claude = await import("./oauth/claude");
const ag = await import("./oauth/antigravity");
const accounts = await import("./accounts");
const { providerDetail } = await import("./provider-detail");
const { listAccounts } = await import("./providers");

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>;
function mockFetch(handler: Handler) {
  const fn = vi.fn((input: string | URL | Request, init?: RequestInit) => Promise.resolve(handler(String(input), init)));
  vi.stubGlobal("fetch", fn);
  return fn;
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

afterEach(() => vi.unstubAllGlobals());

describe("Claude Code OAuth", () => {
  it("builds a PKCE authorize URL with the Claude CLI parameters", () => {
    const u = new URL(claude.startClaudeLogin());
    expect(u.origin + u.pathname).toBe("https://claude.com/cai/oauth/authorize");
    expect(u.searchParams.get("scope")).toContain("user:inference");
    expect(u.searchParams.get("client_id")).toBe(claude.CLAUDE_OAUTH.clientId);
    expect(u.searchParams.get("code")).toBe("true");
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
    expect(u.searchParams.get("redirect_uri")).toBe(claude.CLAUDE_OAUTH.redirectUri);
    // Same shape as the Claude CLI: 32 random bytes, base64url (43 chars).
    expect(u.searchParams.get("state")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(u.searchParams.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("exchanges a pasted code#state with the matching verifier", async () => {
    const state = new URL(claude.startClaudeLogin()).searchParams.get("state")!;
    const fetchFn = mockFetch(() => json({
      access_token: "sk-ant-oat01-x", refresh_token: "sk-ant-ort01-y", expires_in: 28800,
      account: { email_address: "dev@example.com" }, organization: { name: "Team A" },
    }));
    const r = await claude.finishClaudeLogin(`the-code#${state}`);
    expect(r).toMatchObject({ email: "dev@example.com", organization: "Team A", token: { access: "sk-ant-oat01-x", refresh: "sk-ant-ort01-y" } });
    const init = fetchFn.mock.calls[0][1]!;
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({ grant_type: "authorization_code", code: "the-code", state, client_id: claude.CLAUDE_OAUTH.clientId });
    expect(body.code_verifier).toBeTruthy();
    // The pending login is single-use.
    await expect(claude.finishClaudeLogin(`the-code#${state}`)).rejects.toThrow(/expired/);
  });

  it("reports the upstream error text when the exchange fails", async () => {
    const state = new URL(claude.startClaudeLogin()).searchParams.get("state")!;
    mockFetch(() => json({ error: "invalid_grant", error_description: "Code expired" }, 400));
    await expect(claude.finishClaudeLogin(`c#${state}`)).rejects.toThrow("Claude token endpoint 400: Code expired");
  });

  it("formats Anthropic API-style errors", async () => {
    const state = new URL(claude.startClaudeLogin()).searchParams.get("state")!;
    mockFetch(() => json({ error: { type: "rate_limit_error", message: "Rate limited. Please try again later." } }, 429));
    await expect(claude.finishClaudeLogin(`c#${state}`)).rejects.toThrow("Claude token endpoint 429: rate_limit_error: Rate limited. Please try again later.");
  });
});

describe("Antigravity OAuth", () => {
  afterEach(() => {
    delete process.env.ANTIGRAVITY_CLIENT_ID;
    delete process.env.ANTIGRAVITY_CLIENT_SECRET;
  });

  it("requires the OAuth client env vars before starting", () => {
    expect(() => ag.startAntigravityLogin("http://127.0.0.1:8787/cb")).toThrow(/ANTIGRAVITY_CLIENT_ID/);
  });

  it("uses the env client and completes a login with project discovery", async () => {
    process.env.ANTIGRAVITY_CLIENT_ID = "cid.apps.googleusercontent.com";
    process.env.ANTIGRAVITY_CLIENT_SECRET = "shh";

    const authUrl = new URL(ag.startAntigravityLogin("http://127.0.0.1:8787/api/oauth/antigravity/callback"));
    expect(authUrl.searchParams.get("client_id")).toBe("cid.apps.googleusercontent.com");
    const state = authUrl.searchParams.get("state")!;
    mockFetch((url, init) => {
      if (url === ag.AG.tokenUrl) {
        expect(String(init?.body)).toContain("client_secret=shh");
        return json({ access_token: "ya29.a", refresh_token: "1//r", expires_in: 3599 });
      }
      if (url === ag.AG.userInfoUrl) return json({ email: "linh@example.com" });
      if (url.endsWith(":loadCodeAssist")) return json({ cloudaicompanionProject: { id: "proj-123" } });
      return json({}, 404);
    });
    const r = await ag.finishAntigravityLogin(state, "code");
    expect(r).toMatchObject({ email: "linh@example.com", project: "proj-123", token: { access: "ya29.a", refresh: "1//r" } });
  });

  it("parses fetchAvailableModels and derives the worst quota usage", async () => {
    mockFetch((url) => url.startsWith(ag.AG.apiBases[0])
      ? json({ models: {
          "gemini-3.8-flash": { displayName: "Gemini 3.8 Flash", quotaInfo: { remainingFraction: 0.9 } },
          "gemini-4-argon-high": { displayName: "Gemini 4 Argon (High)", quotaInfo: { remainingFraction: 0.65 } },
        } })
      : json({}, 500));
    const r = await ag.listAntigravityModels("ya29.a", "proj-123");
    expect(r.models.map((m) => m.id)).toEqual(["gemini-3.8-flash", "gemini-4-argon-high"]);
    expect(r.usagePct).toBeCloseTo(35);
  });
});

describe("accounts", () => {
  const token = (exp = Date.now() + 3_600_000) => ({ access: "acc", refresh: "ref", expiresAt: exp });

  it("adds accounts in order and reconnects the same email in place", () => {
    const a = accounts.upsertAccount("claude-code", "one@x.com", token(), { email: "one@x.com" });
    const b = accounts.upsertAccount("claude-code", "two@x.com", token(), { email: "two@x.com" });
    expect(accounts.upsertAccount("claude-code", "ONE@x.com", token(), { email: "ONE@x.com" })).toBe(a);
    expect(listAccounts("claude-code").map((x) => x.id)).toEqual([a, b]);
    accounts.moveAccount(b, -1);
    expect(listAccounts("claude-code").map((x) => x.id)).toEqual([b, a]);
    accounts.deleteAccount(b);
    expect(listAccounts("claude-code").map((x) => [x.id, x.position])).toEqual([[a, 0]]);
  });

  it("refreshes and re-seals an expired access token", async () => {
    const id = accounts.upsertAccount("claude-code", "exp@x.com", token(Date.now() - 1000), { email: "exp@x.com" });
    mockFetch(() => json({ access_token: "fresh", expires_in: 28800 }));
    expect(await accounts.accessToken(id)).toBe("fresh");
    const sealed = (db().prepare("SELECT token_sealed FROM accounts WHERE id = ?").get(id) as { token_sealed: string }).token_sealed;
    expect(unseal(sealed)).toMatchObject({ access: "fresh", refresh: "ref" });
  });

  it("marks the account for reconnect when the refresh token is revoked", async () => {
    const id = accounts.upsertAccount("claude-code", "dead@x.com", token(Date.now() - 1000), { email: "dead@x.com" });
    mockFetch(() => json({ error: "invalid_grant" }, 400));
    await expect(accounts.accessToken(id)).rejects.toThrow(/reconnect/);
    expect(listAccounts("claude-code").find((x) => x.id === id)!.lastError).toMatch(/reconnect/);
  });

  it("reloads models keeping each model's on/off choice", () => {
    accounts.saveModels("antigravity", [{ id: "m1", label: "M1" }, { id: "m2", label: "M2" }]);
    db().prepare("UPDATE models SET enabled = 0 WHERE provider = 'antigravity' AND id = 'm2'").run();
    accounts.saveModels("antigravity", [{ id: "m2", label: "M2" }, { id: "m3", label: "M3" }]);
    const rows = db().prepare("SELECT id, enabled FROM models WHERE provider = 'antigravity' ORDER BY id").all();
    expect(rows.map((r) => ({ ...r }))).toEqual([{ id: "m2", enabled: 0 }, { id: "m3", enabled: 1 }]);
  });
});

describe("providerDetail", () => {
  it("shows mapped slots and account states", () => {
    db().prepare("INSERT INTO chains (cli, slot, position, model) VALUES ('claude-code','opus',1,'ag/m3'),('claude-code','fable',0,'ag/m3')").run();
    const id = accounts.upsertAccount("antigravity", "ag@x.com", { access: "a", refresh: "r", expiresAt: Date.now() + 1e6 }, { email: "ag@x.com", usagePct: 35 });
    const d = providerDetail("antigravity")!;
    expect(d.models.find((m) => m.id === "m3")).toMatchObject({ fullId: "ag/m3", mappedTo: expect.stringMatching(/Opus|Fable/) });
    expect(d.accounts.find((a) => a.id === id)).toMatchObject({ state: "active", note: "35% of daily quota" });
    expect(providerDetail("nope")).toBeNull();
  });
});
