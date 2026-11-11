import { db, getSetting, setSetting } from "../db";
import { listAccounts, providerSettings, type AccountRow } from "../providers";

export interface ResolvedHop {
  provider: string;
  model: string;
  slot: string;
  hopIndex: number;
}

/**
 * Resolves a requested model name (or slot alias) to one or more chain hops.
 * If configured in `chains`, returns the chain hops.
 * Otherwise defaults to routing directly to `claude-code` with the given model name.
 */
export function resolveHops(cli: string, rawModel: string): ResolvedHop[] {
  // Claude Code may tag 1M-context models with a "[1m]" suffix.
  const requestedModel = rawModel.replace(/\[1m\]$/i, "");

  // Claude Code sends the value of ANTHROPIC_DEFAULT_*_MODEL, i.e. the slot's
  // primary hop (e.g. "ag/claude-opus-5-5-medium"), so match by slot name or primary hop.
  let rows = db().prepare(
    "SELECT slot, position, model FROM chains WHERE cli = ? AND slot = ? ORDER BY position ASC"
  ).all(cli, requestedModel) as { slot: string; position: number; model: string }[];

  if (rows.length === 0) {
    const primary = db().prepare(
      "SELECT slot FROM chains WHERE cli = ? AND model = ? ORDER BY position ASC LIMIT 1"
    ).get(cli, requestedModel) as { slot: string } | undefined;
    if (primary) {
      rows = db().prepare(
        "SELECT slot, position, model FROM chains WHERE cli = ? AND slot = ? ORDER BY position ASC"
      ).all(cli, primary.slot) as { slot: string; position: number; model: string }[];
      // Start the chain at the requested model so earlier hops are not tried first.
      rows = rows.slice(rows.findIndex((r) => r.model === requestedModel));
    }
  }

  if (rows.length > 0) {
    return rows.map((r, i) => ({ ...splitModel(r.model), slot: r.slot, hopIndex: i }));
  }

  if (requestedModel.startsWith("cc/") || requestedModel.startsWith("claude/")) {
    return [{ ...splitModel(requestedModel), slot: requestedModel, hopIndex: 0 }];
  }

  if (requestedModel.startsWith("ag/")) {
    return [{
      provider: "antigravity",
      model: requestedModel.slice(3),
      slot: requestedModel,
      hopIndex: 0,
    }];
  }

  // Also check if model ID matches known Antigravity model prefix like gemini
  if (requestedModel.startsWith("gemini-")) {
    return [{
      provider: "antigravity",
      model: requestedModel,
      slot: requestedModel,
      hopIndex: 0,
    }];
  }

  return [{
    provider: "claude-code",
    model: requestedModel,
    slot: requestedModel,
    hopIndex: 0,
  }];
}

/** "ag/x" -> antigravity, "cc/x" or "claude/x" -> claude-code, bare id -> claude-code. */
function splitModel(full: string): { provider: string; model: string } {
  if (full.startsWith("ag/")) return { provider: "antigravity", model: full.slice(3) };
  if (full.startsWith("cc/")) return { provider: "claude-code", model: full.slice(3) };
  if (full.startsWith("claude/")) return { provider: "claude-code", model: full.slice(7) };
  return { provider: "claude-code", model: full };
}

export function setAccountCooldown(accountId: string, cooldownUntil: number): void {
  db().prepare("UPDATE accounts SET cooldown_until = ? WHERE id = ?").run(cooldownUntil, accountId);
}

export function clearAccountCooldown(accountId: string): void {
  db().prepare("UPDATE accounts SET cooldown_until = NULL WHERE id = ?").run(accountId);
}

export function pinConversation(convId: string, slot: string, hop: number, accountId: string): void {
  db().prepare(`
    INSERT INTO conversations (conv_id, slot, hop, account_id, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(conv_id) DO UPDATE SET
      slot = excluded.slot,
      hop = excluded.hop,
      account_id = excluded.account_id,
      updated_at = excluded.updated_at
  `).run(convId, slot, hop, accountId, Date.now());
}

export function getPinnedAccountId(convId: string): string | null {
  const row = db().prepare("SELECT account_id FROM conversations WHERE conv_id = ?").get(convId) as
    | { account_id: string }
    | undefined;
  return row?.account_id ?? null;
}

/**
 * Returns candidate accounts for a provider in priority order:
 * 1. Pinned sticky account (if valid, enabled, and not in cooldown)
 * 2. Available accounts (not in cooldown), ordered by round-robin cursor or position
 * 3. Accounts in cooldown (as a last-ditch fallback before failing)
 */
export function getCandidateAccounts(provider: string, convId?: string | null): AccountRow[] {
  const allAccounts = listAccounts(provider).filter((a) => a.enabled);
  if (!allAccounts.length) return [];

  const now = Date.now();
  const available = allAccounts.filter((a) => !a.cooldownUntil || a.cooldownUntil <= now);
  const cooling = allAccounts.filter((a) => a.cooldownUntil && a.cooldownUntil > now);

  const settings = providerSettings(provider);

  // Check sticky
  if (convId && settings.sticky > 0) {
    const pinnedId = getPinnedAccountId(convId);
    if (pinnedId) {
      const pinnedAcc = available.find((a) => a.id === pinnedId);
      if (pinnedAcc) {
        const others = available.filter((a) => a.id !== pinnedId);
        return [pinnedAcc, ...others, ...cooling];
      }
    }
  }

  // Round-robin or priority order
  let orderedAvailable = [...available];
  if (settings.roundRobin && available.length > 1) {
    const key = `rr_cursor_${provider}`;
    const cursor = parseInt(getSetting(key) ?? "0", 10);
    const startIdx = cursor % available.length;
    orderedAvailable = [...available.slice(startIdx), ...available.slice(0, startIdx)];
    setSetting(key, String((cursor + 1) % available.length));
  }

  return [...orderedAvailable, ...cooling];
}
