"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import {
  deleteAccount, moveAccount, reloadModels, renameAccount, setAccountEnabled, testAccounts, upsertAccount, type TestResult,
} from "@/lib/server/accounts";
import { finishClaudeLogin, startClaudeLogin } from "@/lib/server/oauth/claude";
import { startAntigravityLogin } from "@/lib/server/oauth/antigravity";
import { setAllModelsEnabled, setModelEnabled, updateProviderSettings, type HeaderPair, type Thinking } from "@/lib/server/provider-detail";

export type Result<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

function refresh(provider: string) {
  revalidatePath(`/providers/${provider}`);
  revalidatePath("/providers");
}

async function run<T>(provider: string, fn: () => T | Promise<T>): Promise<Result<T>> {
  try {
    const data = await fn();
    refresh(provider);
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function startLogin(provider: string): Promise<Result<{ authUrl: string }>> {
  return run(provider, async () => {
    if (provider === "claude-code") return { authUrl: startClaudeLogin() };
    if (provider === "antigravity") {
      const host = (await headers()).get("host") ?? "127.0.0.1:8787";
      return { authUrl: startAntigravityLogin(`http://${host}/api/oauth/antigravity/callback`) };
    }
    throw new Error("This provider is not supported yet.");
  });
}

/** Claude Code: exchange the pasted code, store the account, then load its models. */
export async function finishClaude(pasted: string): Promise<Result<{ email: string; modelsError?: string }>> {
  return run("claude-code", async () => {
    const r = await finishClaudeLogin(pasted);
    upsertAccount("claude-code", r.email, r.token, { email: r.email, plan: r.organization });
    try {
      await reloadModels("claude-code");
      return { email: r.email };
    } catch (e) {
      return { email: r.email, modelsError: e instanceof Error ? e.message : String(e) };
    }
  });
}

export async function setRoundRobin(provider: string, on: boolean) {
  return run(provider, () => updateProviderSettings(provider, { roundRobin: on }));
}

export async function setSticky(provider: string, n: number) {
  return run(provider, () => updateProviderSettings(provider, { sticky: n }));
}

export async function setThinking(provider: string, thinking: Thinking) {
  return run(provider, () => updateProviderSettings(provider, { thinking }));
}

export async function setHeaders(provider: string, list: HeaderPair[]) {
  return run(provider, () => {
    for (const h of list) if (!/^[A-Za-z0-9-]+$/.test(h.name)) throw new Error(`Invalid header name: ${h.name || "(empty)"}`);
    updateProviderSettings(provider, { headers: list });
  });
}

export async function moveAccountAction(provider: string, id: string, delta: -1 | 1) {
  return run(provider, () => moveAccount(id, delta));
}

export async function toggleAccount(provider: string, id: string, enabled: boolean) {
  return run(provider, () => setAccountEnabled(id, enabled));
}

export async function renameAccountAction(provider: string, id: string, label: string) {
  return run(provider, () => renameAccount(id, label));
}

export async function deleteAccountAction(provider: string, id: string) {
  return run(provider, () => deleteAccount(id));
}

export async function testAll(provider: string): Promise<Result<TestResult[]>> {
  return run(provider, () => testAccounts(provider));
}

export async function reloadModelsAction(provider: string): Promise<Result<number>> {
  return run(provider, () => reloadModels(provider));
}

export async function toggleModel(provider: string, id: string, enabled: boolean) {
  return run(provider, () => setModelEnabled(provider, id, enabled));
}

export async function setAllModels(provider: string, enabled: boolean) {
  return run(provider, () => setAllModelsEnabled(provider, enabled));
}
