import { db } from "../db";

export interface TrafficAttempt {
  accountId: string;
  accountLabel: string;
  status?: number;
  error?: string;
}

export interface TrafficLogEntry {
  conv?: string | null;
  asked: string;
  provider: string;
  model: string;
  account: string;
  status: number;
  latencyMs: number;
  tokensIn?: number | null;
  tokensOut?: number | null;
  switched: boolean;
  attempts: TrafficAttempt[];
}

export function logTraffic(entry: TrafficLogEntry): number {
  const info = db().prepare(`
    INSERT INTO traffic (
      ts, conv, asked, provider, model, account, status, latency_ms, tokens_in, tokens_out, switched, attempts
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    Date.now(),
    entry.conv ?? null,
    entry.asked,
    entry.provider,
    entry.model,
    entry.account,
    entry.status,
    entry.latencyMs,
    entry.tokensIn ?? null,
    entry.tokensOut ?? null,
    entry.switched ? 1 : 0,
    JSON.stringify(entry.attempts)
  );
  return Number(info.lastInsertRowid);
}

export interface TrafficRow {
  id: number;
  ts: number;
  conv: string | null;
  asked: string;
  provider: string | null;
  model: string | null;
  account: string | null;
  status: number;
  latency_ms: number;
  tokens_in: number | null;
  tokens_out: number | null;
  switched: number;
  attempts: string;
}

export function listTraffic(limit = 50): TrafficRow[] {
  return db().prepare("SELECT * FROM traffic ORDER BY ts DESC LIMIT ?").all(limit) as TrafficRow[];
}
