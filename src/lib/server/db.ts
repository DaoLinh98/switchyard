import { DatabaseSync } from "node:sqlite";
import crypto from "node:crypto";
import path from "node:path";
import { dataDir } from "./paths";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- One row per connected account. Tokens are sealed (AES-256-GCM).
CREATE TABLE IF NOT EXISTS accounts (
  id             TEXT PRIMARY KEY,
  provider       TEXT NOT NULL,
  label          TEXT NOT NULL,
  enabled        INTEGER NOT NULL DEFAULT 1,
  position       INTEGER NOT NULL,
  token_sealed   TEXT NOT NULL,
  meta           TEXT NOT NULL DEFAULT '{}',
  cooldown_until INTEGER,
  last_error     TEXT,
  created_at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS accounts_provider ON accounts(provider, position);

CREATE TABLE IF NOT EXISTS provider_settings (
  provider    TEXT PRIMARY KEY,
  round_robin INTEGER NOT NULL DEFAULT 1,
  sticky      INTEGER NOT NULL DEFAULT 1,
  thinking    TEXT NOT NULL DEFAULT 'auto',
  headers     TEXT NOT NULL DEFAULT '[]'
);

-- Models loaded from each provider's own API.
CREATE TABLE IF NOT EXISTS models (
  provider   TEXT NOT NULL,
  id         TEXT NOT NULL,
  label      TEXT NOT NULL,
  enabled    INTEGER NOT NULL DEFAULT 1,
  fetched_at INTEGER NOT NULL,
  PRIMARY KEY (provider, id)
);

-- Fallback chain per CLI slot: position 0 serves first.
CREATE TABLE IF NOT EXISTS chains (
  cli      TEXT NOT NULL,
  slot     TEXT NOT NULL,
  position INTEGER NOT NULL,
  model    TEXT NOT NULL,
  PRIMARY KEY (cli, slot, position)
);

-- Which hop/account a conversation is pinned to after a switch.
CREATE TABLE IF NOT EXISTS conversations (
  conv_id    TEXT PRIMARY KEY,
  slot       TEXT NOT NULL,
  hop        INTEGER NOT NULL,
  account_id TEXT,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS traffic (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ts          INTEGER NOT NULL,
  conv        TEXT,
  asked       TEXT NOT NULL,
  provider    TEXT,
  model       TEXT,
  account     TEXT,
  status      INTEGER NOT NULL,
  latency_ms  INTEGER NOT NULL,
  tokens_in   INTEGER,
  tokens_out  INTEGER,
  switched    INTEGER NOT NULL DEFAULT 0,
  attempts    TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS traffic_ts ON traffic(ts DESC);
`;

const globalForDb = globalThis as unknown as { __switchyardDb?: DatabaseSync };

/** Single shared connection (survives Next.js dev hot reloads). */
export function db(): DatabaseSync {
  if (!globalForDb.__switchyardDb) {
    const conn = new DatabaseSync(path.join(dataDir(), "switchyard.db"));
    conn.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
    conn.exec(SCHEMA);
    globalForDb.__switchyardDb = conn;
  }
  return globalForDb.__switchyardDb;
}

export function getSetting(key: string): string | undefined {
  const row = db().prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value;
}

export function setSetting(key: string, value: string): void {
  db().prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
}

/** Key Claude CLI must send to the proxy; generated on first run. */
export function proxyApiKey(): string {
  let key = getSetting("proxy_api_key");
  if (!key) {
    key = "sk-" + crypto.randomBytes(24).toString("hex");
    setSetting("proxy_api_key", key);
  }
  return key;
}
