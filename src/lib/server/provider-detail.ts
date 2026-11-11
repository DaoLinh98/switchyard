import { db } from "./db";
import { providerById, type ProviderInfo } from "../catalog";
import { accountView, listAccounts, providerSettings, type AccountTone } from "./providers";

export type Thinking = "auto" | "low" | "medium" | "high";
export interface HeaderPair { name: string; value: string }

function ensureSettingsRow(provider: string): void {
  db().prepare("INSERT OR IGNORE INTO provider_settings (provider) VALUES (?)").run(provider);
}

export function updateProviderSettings(provider: string, patch: { roundRobin?: boolean; sticky?: number; thinking?: Thinking; headers?: HeaderPair[] }): void {
  ensureSettingsRow(provider);
  if (patch.roundRobin !== undefined) db().prepare("UPDATE provider_settings SET round_robin = ? WHERE provider = ?").run(patch.roundRobin ? 1 : 0, provider);
  if (patch.sticky !== undefined) {
    const n = Math.floor(patch.sticky);
    if (!(n >= 1 && n <= 1000)) throw new Error("Sticky must be between 1 and 1000");
    db().prepare("UPDATE provider_settings SET sticky = ? WHERE provider = ?").run(n, provider);
  }
  if (patch.thinking !== undefined) db().prepare("UPDATE provider_settings SET thinking = ? WHERE provider = ?").run(patch.thinking, provider);
  if (patch.headers !== undefined) db().prepare("UPDATE provider_settings SET headers = ? WHERE provider = ?").run(JSON.stringify(patch.headers), provider);
}

function extraSettings(provider: string): { thinking: Thinking; headers: HeaderPair[] } {
  const row = db().prepare("SELECT thinking, headers FROM provider_settings WHERE provider = ?").get(provider) as
    | { thinking: Thinking; headers: string } | undefined;
  return { thinking: row?.thinking ?? "auto", headers: row ? (JSON.parse(row.headers) as HeaderPair[]) : [] };
}

export function setModelEnabled(provider: string, id: string, enabled: boolean): void {
  db().prepare("UPDATE models SET enabled = ? WHERE provider = ? AND id = ?").run(enabled ? 1 : 0, provider, id);
}

export function setAllModelsEnabled(provider: string, enabled: boolean): void {
  db().prepare("UPDATE models SET enabled = ? WHERE provider = ?").run(enabled ? 1 : 0, provider);
}

const SLOT_LABEL: Record<string, string> = { fable: "Fable", opus: "Opus", sonnet: "Sonnet", haiku: "Haiku" };

export interface DetailAccount {
  id: string;
  label: string;
  rank: number;
  enabled: boolean;
  state: "active" | "limited" | "paused" | "error";
  error: string | null;
  note: string;
  pct: number;
  tone: AccountTone;
}

export interface DetailModel { id: string; fullId: string; label: string; enabled: boolean; mappedTo: string | null }

export interface ProviderDetailData {
  info: ProviderInfo;
  roundRobin: boolean;
  sticky: number;
  thinking: Thinking;
  headers: HeaderPair[];
  accounts: DetailAccount[];
  models: DetailModel[];
}

export function providerDetail(id: string, now = Date.now()): ProviderDetailData | null {
  const info = providerById(id);
  if (!info) return null;
  const s = providerSettings(id);
  const extra = extraSettings(id);

  const accounts = listAccounts(id).map((a, i): DetailAccount => {
    const v = accountView(a, info, now);
    const state = !a.enabled ? "paused" : a.lastError ? "error" : v.tone === "limit" ? "limited" : "active";
    return { id: a.id, label: a.label, rank: i + 1, enabled: a.enabled, state, error: a.lastError, note: v.note, pct: v.pct, tone: v.tone };
  });

  // Slots of any CLI whose chain uses each model, for the "mapped → Opus · Fable" pill.
  const chainRows = db().prepare("SELECT DISTINCT slot, model FROM chains").all() as { slot: string; model: string }[];
  const models = (db().prepare("SELECT id, label, enabled FROM models WHERE provider = ? ORDER BY id").all(id) as { id: string; label: string; enabled: number }[])
    .map((m): DetailModel => {
      const fullId = info.prefix + m.id;
      const slots = chainRows.filter((c) => c.model === fullId).map((c) => SLOT_LABEL[c.slot] ?? c.slot);
      return { id: m.id, fullId, label: m.label, enabled: m.enabled === 1, mappedTo: slots.length ? slots.join(" · ") : null };
    });

  return { info, roundRobin: s.roundRobin, sticky: s.sticky, thinking: extra.thinking, headers: extra.headers, accounts, models };
}
