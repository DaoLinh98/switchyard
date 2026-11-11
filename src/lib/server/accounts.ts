import crypto from "node:crypto";
import { db } from "./db";
import { seal, unseal } from "./crypto";
import { listAccounts, type AccountMeta, type AccountRow } from "./providers";
import { ReauthError, type OAuthToken } from "./oauth/common";
import { listClaudeModels, refreshClaude, type RemoteModel } from "./oauth/claude";
import { listAntigravityModels, refreshAntigravity } from "./oauth/antigravity";

export interface AccountMetaFull extends AccountMeta {
  /** Antigravity Cloud Code project. */
  project?: string;
  lastTestedAt?: number;
}

function getAccount(id: string): AccountRow {
  const a = listAccounts().find((x) => x.id === id);
  if (!a) throw new Error("Account not found");
  return a;
}

/** Adds an account, or refreshes the credentials of the same login (keeping its position). */
export function upsertAccount(provider: string, label: string, token: OAuthToken, meta: AccountMetaFull): string {
  const existing = listAccounts(provider).find((a) => a.meta.email && a.meta.email.toLowerCase() === meta.email?.toLowerCase());
  if (existing) {
    db().prepare("UPDATE accounts SET token_sealed = ?, meta = ?, last_error = NULL, cooldown_until = NULL WHERE id = ?")
      .run(seal(token), JSON.stringify({ ...existing.meta, ...meta }), existing.id);
    return existing.id;
  }
  const id = crypto.randomUUID();
  const { next } = db().prepare("SELECT COALESCE(MAX(position) + 1, 0) AS next FROM accounts WHERE provider = ?").get(provider) as { next: number };
  db().prepare("INSERT INTO accounts (id, provider, label, enabled, position, token_sealed, meta, created_at) VALUES (?, ?, ?, 1, ?, ?, ?, ?)")
    .run(id, provider, label, next, seal(token), JSON.stringify(meta), Date.now());
  return id;
}

export function setAccountEnabled(id: string, enabled: boolean): void {
  db().prepare("UPDATE accounts SET enabled = ? WHERE id = ?").run(enabled ? 1 : 0, id);
}

export function renameAccount(id: string, label: string): void {
  if (!label.trim()) throw new Error("Name cannot be empty");
  db().prepare("UPDATE accounts SET label = ? WHERE id = ?").run(label.trim(), id);
}

export function deleteAccount(id: string): void {
  const a = getAccount(id);
  db().prepare("DELETE FROM accounts WHERE id = ?").run(id);
  db().prepare("UPDATE accounts SET position = position - 1 WHERE provider = ? AND position > ?").run(a.provider, a.position);
}

/** Swaps an account with its neighbour; `delta` is -1 (up) or +1 (down). */
export function moveAccount(id: string, delta: -1 | 1): void {
  const list = listAccounts(getAccount(id).provider);
  const i = list.findIndex((a) => a.id === id), j = i + delta;
  if (j < 0 || j >= list.length) return;
  const swap = db().prepare("UPDATE accounts SET position = ? WHERE id = ?");
  swap.run(list[j].position, list[i].id);
  swap.run(list[i].position, list[j].id);
}

function updateMeta(id: string, patch: Partial<AccountMetaFull>, lastError: string | null): void {
  const a = getAccount(id);
  db().prepare("UPDATE accounts SET meta = ?, last_error = ? WHERE id = ?").run(JSON.stringify({ ...a.meta, ...patch }), lastError, id);
}

const REFRESH = { "claude-code": refreshClaude, antigravity: refreshAntigravity } as Record<string, (t: OAuthToken) => Promise<OAuthToken>>;

/** Valid access token for an account, refreshing (and persisting) it when close to expiry. */
export async function accessToken(id: string): Promise<string> {
  const row = db().prepare("SELECT provider, token_sealed FROM accounts WHERE id = ?").get(id) as { provider: string; token_sealed: string } | undefined;
  if (!row) throw new Error("Account not found");
  const token = unseal<OAuthToken>(row.token_sealed);
  if (token.expiresAt - 60_000 > Date.now()) return token.access;
  const refresh = REFRESH[row.provider];
  if (!refresh) throw new Error(`No token refresh for provider ${row.provider}`);
  try {
    const next = await refresh(token);
    db().prepare("UPDATE accounts SET token_sealed = ? WHERE id = ?").run(seal(next), id);
    return next.access;
  } catch (e) {
    if (e instanceof ReauthError) db().prepare("UPDATE accounts SET last_error = ? WHERE id = ?").run(e.message, id);
    throw e;
  }
}

/** Calls the provider's model list with one account; also refreshes its usage when reported. */
async function fetchModelsWith(a: AccountRow): Promise<RemoteModel[]> {
  const access = await accessToken(a.id);
  if (a.provider === "claude-code") return listClaudeModels(access);
  if (a.provider === "antigravity") {
    const project = (a.meta as AccountMetaFull).project;
    if (!project) throw new Error("Account has no Cloud Code project; reconnect it.");
    const r = await listAntigravityModels(access, project);
    if (r.usagePct !== undefined) updateMeta(a.id, { usagePct: r.usagePct }, null);
    return r.models;
  }
  throw new Error(`Provider ${a.provider} is not supported yet`);
}

/** Replaces the provider's model list with the live one, keeping each model's on/off choice. */
export function saveModels(provider: string, models: RemoteModel[]): void {
  const old = new Map((db().prepare("SELECT id, enabled FROM models WHERE provider = ?").all(provider) as { id: string; enabled: number }[])
    .map((m) => [m.id, m.enabled]));
  const now = Date.now();
  const conn = db();
  conn.exec("BEGIN");
  try {
    conn.prepare("DELETE FROM models WHERE provider = ?").run(provider);
    const ins = conn.prepare("INSERT INTO models (provider, id, label, enabled, fetched_at) VALUES (?, ?, ?, ?, ?)");
    for (const m of models) ins.run(provider, m.id, m.label, old.get(m.id) ?? 1, now);
    conn.exec("COMMIT");
  } catch (e) {
    conn.exec("ROLLBACK");
    throw e;
  }
}

/** Loads models with the first enabled account that answers. */
export async function reloadModels(provider: string): Promise<number> {
  const accounts = listAccounts(provider).filter((a) => a.enabled);
  if (!accounts.length) throw new Error("Connect an account first.");
  let lastErr: unknown;
  for (const a of accounts) {
    try {
      const models = await fetchModelsWith(a);
      saveModels(provider, models);
      return models.length;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

export interface TestResult { id: string; label: string; ok: boolean; message: string }

/** "Test one by one": checks every account's login and API access in order. */
export async function testAccounts(provider: string): Promise<TestResult[]> {
  const results: TestResult[] = [];
  for (const a of listAccounts(provider)) {
    try {
      const models = await fetchModelsWith(a);
      updateMeta(a.id, { lastTestedAt: Date.now() }, null);
      results.push({ id: a.id, label: a.label, ok: true, message: `OK · ${models.length} models` });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      updateMeta(a.id, { lastTestedAt: Date.now() }, message);
      results.push({ id: a.id, label: a.label, ok: false, message });
    }
  }
  return results;
}
