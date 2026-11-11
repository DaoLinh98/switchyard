"use server";

import { revalidatePath } from "next/cache";
import { applyClaudeSettings, saveSlotHops } from "@/lib/server/cli-tools";

export async function saveSlotAction(slot: string, hops: string[]) {
  saveSlotHops("claude-code", slot, hops);
  revalidatePath("/cli-tools");
  return { success: true };
}

export async function applySettingsAction() {
  const result = applyClaudeSettings();
  revalidatePath("/cli-tools");
  return { success: true, result };
}
