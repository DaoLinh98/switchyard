import { accessToken } from "../accounts";
import { CLAUDE_OAUTH, claudeApiHeaders } from "../oauth/claude";
import { db } from "../db";

export interface ForwardOptions {
  accountId: string;
  model: string;
  body: Record<string, unknown>;
  clientHeaders?: Headers;
  signal?: AbortSignal;
}

export interface ForwardResult {
  response: Response;
  status: number;
}

function getProviderCustomHeaders(provider: string): Record<string, string> {
  const row = db().prepare("SELECT headers FROM provider_settings WHERE provider = ?").get(provider) as
    | { headers: string }
    | undefined;
  if (!row?.headers) return {};
  try {
    const list = JSON.parse(row.headers) as { name: string; value: string }[];
    const res: Record<string, string> = {};
    for (const h of list) {
      if (h.name && h.value) res[h.name] = h.value;
    }
    return res;
  } catch {
    return {};
  }
}

export async function forwardToClaude(opts: ForwardOptions): Promise<ForwardResult> {
  const access = await accessToken(opts.accountId);
  const baseHeaders = claudeApiHeaders(access);

  const customHeaders = getProviderCustomHeaders("claude-code");

  // Merge client's anthropic-beta with oauth-2025-04-20
  const clientBeta = opts.clientHeaders?.get("anthropic-beta");
  let beta = CLAUDE_OAUTH.oauthBeta;
  if (clientBeta) {
    const parts = clientBeta.split(",").map((s) => s.trim()).filter(Boolean);
    if (!parts.includes(CLAUDE_OAUTH.oauthBeta)) {
      parts.push(CLAUDE_OAUTH.oauthBeta);
    }
    beta = parts.join(",");
  }

  const clientVersion = opts.clientHeaders?.get("anthropic-version") ?? "2023-06-01";

  const headers: Record<string, string> = {
    ...baseHeaders,
    "Content-Type": "application/json",
    "anthropic-version": clientVersion,
    "anthropic-beta": beta,
    ...customHeaders,
  };

  const payload = {
    ...opts.body,
    model: opts.model,
  };

  const res = await fetch(`${CLAUDE_OAUTH.apiBase}/v1/messages`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
    signal: opts.signal,
  });

  return {
    response: res,
    status: res.status,
  };
}
