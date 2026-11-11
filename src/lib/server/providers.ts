import { db } from "./db";
import { PROVIDERS, type ProviderInfo } from "../catalog";

export interface AccountMeta {
  email?: string;
  plan?: string;
  /** Last known usage of the current quota window, 0–100. */
  usagePct?: number;
}

export interface AccountRow {
  id: string;
  provider: string;
  label: string;
  enabled: boolean;
  position: number;
  meta: AccountMeta;
  cooldownUntil: number | null;
  lastError: string | null;
}

export interface ProviderSettings {
  roundRobin: boolean;
  sticky: number;
}

export function listAccounts(provider?: string): AccountRow[] {
  const sql = "SELECT id, provider, label, enabled, position, meta, cooldown_until, last_error FROM accounts"
    + (provider ? " WHERE provider = ?" : "") + " ORDER BY provider, position";
  const rows = (provider ? db().prepare(sql).all(provider) : db().prepare(sql).all()) as Record<string, unknown>[];
  return rows.map((r) => ({
    id: r.id as string,
    provider: r.provider as string,
    label: r.label as string,
    enabled: r.enabled === 1,
    position: r.position as number,
    meta: JSON.parse(r.meta as string) as AccountMeta,
    cooldownUntil: (r.cooldown_until as number | null) ?? null,
    lastError: (r.last_error as string | null) ?? null,
  }));
}

export function providerSettings(provider: string): ProviderSettings {
  const row = db().prepare("SELECT round_robin, sticky FROM provider_settings WHERE provider = ?").get(provider) as
    | { round_robin: number; sticky: number }
    | undefined;
  return { roundRobin: row ? row.round_robin === 1 : true, sticky: row?.sticky ?? 1 };
}

export function enabledModelCount(provider: string): number {
  const row = db().prepare("SELECT COUNT(*) AS n FROM models WHERE provider = ? AND enabled = 1").get(provider) as { n: number };
  return row.n;
}

export type AccountTone = "ok" | "warn" | "limit" | "off";

export interface ConnectedAccountView {
  label: string;
  note: string;
  pct: number;
  tone: AccountTone;
}

export interface ConnectedProviderView {
  info: ProviderInfo;
  meta: string;
  status: "Active" | "Partly limited" | "Limited" | "Paused";
  accounts: ConnectedAccountView[];
  modelCount: number;
}

function clock(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function accountView(a: AccountRow, info: ProviderInfo, now = Date.now()): ConnectedAccountView {
  if (!a.enabled) return { label: a.label, note: "paused", pct: 0, tone: "off" };
  if (a.cooldownUntil && a.cooldownUntil > now) {
    return { label: a.label, note: `limited · resets ${clock(a.cooldownUntil)}`, pct: 100, tone: "limit" };
  }
  if (a.meta.usagePct === undefined) return { label: a.label, note: "ready", pct: 0, tone: "ok" };
  const pct = Math.round(a.meta.usagePct);
  return { label: a.label, note: `${pct}% of ${info.quotaWindow ?? "quota"}`, pct, tone: pct >= 70 ? "warn" : "ok" };
}

/** Data for the "Connected" cards on the Providers page. */
export function connectedProviders(now = Date.now()): ConnectedProviderView[] {
  const byProvider = new Map<string, AccountRow[]>();
  for (const a of listAccounts()) byProvider.set(a.provider, [...(byProvider.get(a.provider) ?? []), a]);

  return PROVIDERS.filter((p) => byProvider.has(p.id)).map((info) => {
    const accounts = byProvider.get(info.id)!.map((a) => accountView(a, info, now));
    const s = providerSettings(info.id);
    const live = accounts.filter((a) => a.tone !== "off");
    const limited = live.filter((a) => a.tone === "limit").length;
    const status = live.length === 0 ? "Paused" : limited === 0 ? "Active" : limited === live.length ? "Limited" : "Partly limited";
    return {
      info,
      meta: "OAuth · " + (s.roundRobin ? `round robin · sticky ${s.sticky}` : "priority order"),
      status,
      accounts,
      modelCount: enabledModelCount(info.id),
    };
  });
}

/** Connection count per provider, for the OAuth catalog grid. */
export function connectionCounts(): Record<string, number> {
  const rows = db().prepare("SELECT provider, COUNT(*) AS n FROM accounts GROUP BY provider").all() as { provider: string; n: number }[];
  return Object.fromEntries(rows.map((r) => [r.provider, r.n]));
}
