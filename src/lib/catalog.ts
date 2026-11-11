/** Static provider catalog. `supported` providers have a working adapter in the MVP. */
export type ProviderId =
  | "claude-code" | "antigravity" | "codex" | "gemini-cli" | "copilot" | "cursor" | "qoder" | "kilo"
  | "cline" | "qwen" | "kimi" | "zai" | "minimax" | "grok" | "mimo" | "codebuddy";

export interface ProviderInfo {
  id: ProviderId;
  name: string;
  mono: string;
  tint: string;
  prefix: string;
  supported: boolean;
  /** Unit the provider's quota is measured in, shown next to usage bars. */
  quotaWindow?: string;
}

export const PROVIDERS: ProviderInfo[] = [
  { id: "claude-code", name: "Claude Code", mono: "CC", tint: "#E8916B", prefix: "cc/", supported: true, quotaWindow: "5h window" },
  { id: "antigravity", name: "Antigravity", mono: "AG", tint: "#7FA8FF", prefix: "ag/", supported: true, quotaWindow: "daily quota" },
  { id: "codex", name: "OpenAI Codex", mono: "CX", tint: "#D7DBE0", prefix: "cx/", supported: true, quotaWindow: "5h window" },
  { id: "gemini-cli", name: "Gemini CLI", mono: "GC", tint: "#B39CFF", prefix: "gc/", supported: false },
  { id: "copilot", name: "GitHub Copilot", mono: "GH", tint: "#9AA3AF", prefix: "gh/", supported: false },
  { id: "cursor", name: "Cursor IDE", mono: "CU", tint: "#D7DBE0", prefix: "cu/", supported: false },
  { id: "qoder", name: "Qoder", mono: "QD", tint: "#8FD6A8", prefix: "qd/", supported: false },
  { id: "kilo", name: "Kilo Code", mono: "KC", tint: "#F2D35C", prefix: "kc/", supported: false },
  { id: "cline", name: "Cline", mono: "CL", tint: "#B39CFF", prefix: "cl/", supported: false },
  { id: "qwen", name: "Qwen Code", mono: "QW", tint: "#8FD6C4", prefix: "qw/", supported: false },
  { id: "kimi", name: "Kimi", mono: "KM", tint: "#D7DBE0", prefix: "km/", supported: false },
  { id: "zai", name: "Zai GLM Coding", mono: "ZG", tint: "#D7DBE0", prefix: "zg/", supported: false },
  { id: "minimax", name: "MiniMax Code", mono: "MM", tint: "#FF7AA8", prefix: "mm/", supported: false },
  { id: "grok", name: "Grok CLI", mono: "GK", tint: "#9AA3AF", prefix: "gk/", supported: false },
  { id: "mimo", name: "Xiaomi MiMo", mono: "MI", tint: "#F2A45C", prefix: "mi/", supported: false },
  { id: "codebuddy", name: "CodeBuddy", mono: "CB", tint: "#7FA8FF", prefix: "cb/", supported: false },
];

export function providerById(id: string): ProviderInfo | undefined {
  return PROVIDERS.find((p) => p.id === id);
}

/** "#RRGGBB" + alpha -> "rgba(r,g,b,a)", used for tinted monogram tiles. */
export function tintBg(hex: string, alpha = 0.14): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${alpha})`;
}
