import { bodyText, newPkce, ReauthError, rememberLogin, takeLogin, type OAuthToken } from "./common";

/**
 * Claude Code's own OAuth client (public, PKCE). Values copied from the installed
 * Claude CLI (v2.1.319, "Login with Claude.ai" + manual paste flow). Not an official,
 * documented API: if login breaks after a CLI update, re-check these first.
 */
export const CLAUDE_OAUTH = {
  clientId: "9d1c250a-e61b-44d9-88ed-5944d1962f5e",
  authorizeUrl: "https://claude.com/cai/oauth/authorize",
  tokenUrl: "https://platform.claude.com/v1/oauth/token",
  redirectUri: "https://platform.claude.com/oauth/code/callback",
  /** Scopes requested at login. */
  loginScopes: [
    "org:create_api_key", "user:profile", "user:inference", "user:sessions:claude_code",
    "user:mcp_servers", "user:file_upload", "user:plugins",
  ],
  /** Scopes sent with a refresh (the CLI drops org:create_api_key here). */
  refreshScopes: ["user:profile", "user:inference", "user:sessions:claude_code", "user:mcp_servers", "user:file_upload", "user:plugins"],
  apiBase: "https://api.anthropic.com",
  oauthBeta: "oauth-2025-04-20",
};

const PROVIDER = "claude-code";

/** Starts a login; the user signs in on claude.ai and pastes back the "code#state" shown. */
export function startClaudeLogin(): string {
  const { state, verifier, challenge } = newPkce();
  rememberLogin(state, { provider: PROVIDER, verifier, redirectUri: CLAUDE_OAUTH.redirectUri });
  const q = new URLSearchParams({
    code: "true",
    client_id: CLAUDE_OAUTH.clientId,
    response_type: "code",
    redirect_uri: CLAUDE_OAUTH.redirectUri,
    scope: CLAUDE_OAUTH.loginScopes.join(" "),
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
  });
  return `${CLAUDE_OAUTH.authorizeUrl}?${q}`;
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  account?: { uuid?: string; email_address?: string };
  organization?: { uuid?: string; name?: string };
  /** OAuth-style string, or Anthropic API style { type, message } (e.g. rate_limit_error). */
  error?: string | { type?: string; message?: string };
  error_description?: string;
}

function errorText(r: TokenResponse, raw: string): string {
  if (typeof r.error === "object") return [r.error.type, r.error.message].filter(Boolean).join(": ") || raw;
  return r.error_description ?? r.error ?? raw;
}

async function tokenCall(form: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(CLAUDE_OAUTH.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ ...form, client_id: CLAUDE_OAUTH.clientId }),
    signal: AbortSignal.timeout(60_000),
  });
  const text = await bodyText(res, 2000);
  let json: TokenResponse = {};
  try { json = JSON.parse(text) as TokenResponse; } catch { /* non-JSON error page */ }
  if (!res.ok || !json.access_token) {
    if (json.error === "invalid_grant" && form.grant_type === "refresh_token") throw new ReauthError("Claude");
    throw new Error(`Claude token endpoint ${res.status}: ${errorText(json, text)}`);
  }
  return json;
}

function toToken(r: TokenResponse, previousRefresh?: string): OAuthToken {
  return {
    access: r.access_token!,
    refresh: r.refresh_token ?? previousRefresh ?? "",
    expiresAt: Date.now() + (r.expires_in ?? 3600) * 1000,
  };
}

export interface ClaudeLoginResult {
  token: OAuthToken;
  email: string;
  organization?: string;
}

/** Exchanges the pasted "code#state" (or bare code) for tokens. */
export async function finishClaudeLogin(pasted: string): Promise<ClaudeLoginResult> {
  const [code, state] = pasted.trim().split("#");
  if (!code) throw new Error("Paste the code shown after signing in.");
  const login = takeLogin(PROVIDER, state || undefined);
  const r = await tokenCall({
    grant_type: "authorization_code",
    code,
    redirect_uri: login.redirectUri,
    code_verifier: login.verifier,
    ...(state ? { state } : {}),
  });
  if (!r.refresh_token) throw new Error("Claude returned no refresh token; try connecting again.");
  return { token: toToken(r), email: r.account?.email_address ?? "Claude account", organization: r.organization?.name };
}

export async function refreshClaude(t: OAuthToken): Promise<OAuthToken> {
  return toToken(await tokenCall({
    grant_type: "refresh_token", refresh_token: t.refresh, scope: CLAUDE_OAUTH.refreshScopes.join(" "),
  }), t.refresh);
}

/** Headers for api.anthropic.com calls made with an OAuth access token. */
export function claudeApiHeaders(access: string): Record<string, string> {
  return {
    Authorization: `Bearer ${access}`,
    "anthropic-version": "2023-06-01",
    "anthropic-beta": CLAUDE_OAUTH.oauthBeta,
  };
}

export interface RemoteModel { id: string; label: string }

export async function listClaudeModels(access: string): Promise<RemoteModel[]> {
  const res = await fetch(`${CLAUDE_OAUTH.apiBase}/v1/models?limit=100`, {
    headers: claudeApiHeaders(access),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`Claude /v1/models ${res.status}: ${await bodyText(res)}`);
  const json = (await res.json()) as { data?: { id: string; display_name?: string }[] };
  return (json.data ?? []).map((m) => ({ id: m.id, label: m.display_name ?? m.id }));
}
