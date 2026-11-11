import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

const home = fs.mkdtempSync(path.join(os.tmpdir(), "switchyard-test-"));
process.env.SWITCHYARD_HOME = home;

const { seal, unseal } = await import("./crypto");
const { db, proxyApiKey } = await import("./db");
const { connectedProviders, connectionCounts } = await import("./providers");

describe("crypto", () => {
  it("round-trips a token payload and never stores plaintext", () => {
    const token = { access: "secret-access", refresh: "secret-refresh", expiresAt: 123 };
    const sealed = seal(token);
    expect(sealed).not.toContain("secret");
    expect(unseal(sealed)).toEqual(token);
  });

  it("rejects tampered ciphertext", () => {
    const parts = seal({ a: 1 }).split(":");
    parts[3] = Buffer.from("tampered").toString("base64");
    expect(() => unseal(parts.join(":"))).toThrow();
  });

  it("creates the master key file in the data dir", () => {
    expect(fs.statSync(path.join(home, "master.key")).size).toBeGreaterThan(0);
  });
});

describe("db", () => {
  it("generates a stable proxy API key", () => {
    const key = proxyApiKey();
    expect(key).toMatch(/^sk-[0-9a-f]{48}$/);
    expect(proxyApiKey()).toBe(key);
  });
});

describe("connectedProviders", () => {
  const now = Date.UTC(2026, 10, 9, 7, 0);

  beforeAll(() => {
    const insert = db().prepare(
      "INSERT INTO accounts (id, provider, label, enabled, position, token_sealed, meta, cooldown_until, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
    insert.run("a1", "claude-code", "Pro · personal", 1, 0, seal({}), "{}", now + 3_600_000, now);
    insert.run("a2", "claude-code", "Max · team-a", 1, 1, seal({}), JSON.stringify({ usagePct: 48 }), null, now);
    insert.run("a3", "codex", "Plus · personal", 1, 0, seal({}), JSON.stringify({ usagePct: 71 }), null, now);
    db().prepare("INSERT INTO models (provider, id, label, enabled, fetched_at) VALUES ('codex','cx/a','A',1,0),('codex','cx/b','B',0,0)").run();
  });

  it("derives status, notes and tones per account", () => {
    const [cc, cx] = connectedProviders(now);
    expect(cc.info.id).toBe("claude-code");
    expect(cc.status).toBe("Partly limited");
    expect(cc.accounts[0]).toMatchObject({ tone: "limit", pct: 100 });
    expect(cc.accounts[0].note).toMatch(/^limited · resets \d\d:\d\d$/);
    expect(cc.accounts[1]).toMatchObject({ tone: "ok", note: "48% of 5h window" });
    expect(cc.meta).toBe("OAuth · round robin · sticky 1");

    expect(cx.status).toBe("Active");
    expect(cx.accounts[0].tone).toBe("warn");
    expect(cx.modelCount).toBe(1);
  });

  it("counts connections per provider", () => {
    expect(connectionCounts()).toEqual({ "claude-code": 2, codex: 1 });
  });
});
