import { getSlotMappings, listAvailableModels, claudeSettingsPath } from "@/lib/server/cli-tools";
import { proxyApiKey } from "@/lib/server/db";
import { ClaudeCodeDetailView } from "./ClaudeCodeDetailView";

export const dynamic = "force-dynamic";

export default function ClaudeCodeDetailPage() {
  const slots = getSlotMappings("claude-code");
  const availableModels = listAvailableModels();
  const settingsPath = claudeSettingsPath();
  const apiKey = proxyApiKey();

  return (
    <ClaudeCodeDetailView
      slots={slots}
      availableModels={availableModels}
      settingsPath={settingsPath}
      apiKey={apiKey}
    />
  );
}
