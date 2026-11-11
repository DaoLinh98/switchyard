import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { db, proxyApiKey } from "./db";

export interface SlotChainHop {
  position: number;
  model: string;
}

export interface CliSlotMapping {
  slot: "fable" | "opus" | "sonnet" | "haiku";
  label: string;
  defaultModel: string;
  hops: SlotChainHop[];
}

export interface AvailableModelOption {
  fullId: string;
  provider: string;
  id: string;
  label: string;
}

const DEFAULT_SLOTS: { slot: "fable" | "opus" | "sonnet" | "haiku"; label: string; defaultModel: string }[] = [
  { slot: "fable", label: "Fable", defaultModel: "ag/claude-sonnet-5-5-high" },
  { slot: "opus", label: "Opus", defaultModel: "ag/claude-sonnet-5-5-high" },
  { slot: "sonnet", label: "Sonnet", defaultModel: "ag/claude-sonnet-5-5-high" },
  { slot: "haiku", label: "Haiku", defaultModel: "ag/gemini-3.8-flash" },
];

export function listAvailableModels(): AvailableModelOption[] {
  const rows = db().prepare(`
    SELECT provider, id, label FROM models WHERE enabled = 1 ORDER BY provider, label
  `).all() as { provider: string; id: string; label: string }[];

  return rows.map((r) => {
    const prefix = r.provider === "antigravity" ? "ag/" : r.provider === "claude-code" ? "cc/" : "";
    return {
      fullId: prefix ? `${prefix}${r.id}` : r.id,
      provider: r.provider,
      id: r.id,
      label: `${r.label} (${r.provider === "antigravity" ? "Antigravity" : "Claude"})`,
    };
  });
}

export function getSlotMappings(cli = "claude-code"): CliSlotMapping[] {
  // Migrate obsolete / non-existent model IDs in stored DB chains
  try {
    db().prepare(
      "UPDATE chains SET model = 'ag/claude-sonnet-5-5-high' WHERE model = 'ag/claude-opus-5-5-medium'"
    ).run();
    db().prepare(
      "UPDATE chains SET model = 'ag/gemini-3.8-flash' WHERE model = 'ag/gemini-3.8-flash-tiered'"
    ).run();
  } catch {
    // Ignore migration errors
  }

  const chainRows = db().prepare(
    "SELECT slot, position, model FROM chains WHERE cli = ? ORDER BY slot, position ASC"
  ).all(cli) as { slot: string; position: number; model: string }[];

  return DEFAULT_SLOTS.map((def) => {
    const hops = chainRows
      .filter((r) => r.slot === def.slot)
      .map((r) => ({ position: r.position, model: r.model }));

    if (hops.length === 0) {
      hops.push({ position: 0, model: def.defaultModel });
    }

    return {
      slot: def.slot,
      label: def.label,
      defaultModel: def.defaultModel,
      hops,
    };
  });
}

export function saveSlotHops(cli: string, slot: string, hops: string[]): void {
  const conn = db();
  conn.exec("BEGIN");
  try {
    conn.prepare("DELETE FROM chains WHERE cli = ? AND slot = ?").run(cli, slot);
    const ins = conn.prepare("INSERT INTO chains (cli, slot, position, model) VALUES (?, ?, ?, ?)");
    hops.forEach((model, pos) => {
      if (model.trim()) {
        ins.run(cli, slot, pos, model.trim());
      }
    });
    conn.exec("COMMIT");
  } catch (e) {
    conn.exec("ROLLBACK");
    throw e;
  }
}

export function claudeSettingsPath(): string {
  return path.join(os.homedir(), ".claude", "settings.json");
}

export interface ApplySettingsResult {
  applied: boolean;
  settingsPath: string;
  endpoint: string;
  apiKey: string;
  env: Record<string, string>;
}

export function applyClaudeSettings(port = 8787): ApplySettingsResult {
  const file = claudeSettingsPath();
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });

  let existing: Record<string, unknown> = {};
  if (fs.existsSync(file)) {
    try {
      existing = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      existing = {};
    }
  }

  const existingEnv = (existing.env as Record<string, string>) ?? {};
  const apiKey = proxyApiKey();
  const endpoint = `http://127.0.0.1:${port}/v1`;

  const slots = getSlotMappings("claude-code");
  const slotEnvMap: Record<string, string> = {};

  for (const s of slots) {
    const firstHop = s.hops[0]?.model ?? s.defaultModel;
    if (s.slot === "fable") slotEnvMap["ANTHROPIC_DEFAULT_FABLE_MODEL"] = firstHop;
    if (s.slot === "opus") slotEnvMap["ANTHROPIC_DEFAULT_OPUS_MODEL"] = firstHop;
    if (s.slot === "sonnet") slotEnvMap["ANTHROPIC_DEFAULT_SONNET_MODEL"] = firstHop;
    if (s.slot === "haiku") slotEnvMap["ANTHROPIC_DEFAULT_HAIKU_MODEL"] = firstHop;
  }

  const newEnv: Record<string, string> = {
    ...existingEnv,
    ANTHROPIC_BASE_URL: endpoint,
    ANTHROPIC_AUTH_TOKEN: apiKey,
    ...slotEnvMap,
  };

  const updated = {
    ...existing,
    env: newEnv,
  };

  fs.writeFileSync(file, JSON.stringify(updated, null, 2), "utf8");

  return {
    applied: true,
    settingsPath: file,
    endpoint,
    apiKey,
    env: newEnv,
  };
}
