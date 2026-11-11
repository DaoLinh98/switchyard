import { bodyText, newPkce, ReauthError, rememberLogin, takeLogin, type OAuthToken } from "./common";
import type { RemoteModel } from "./claude";

/** Google OAuth + Cloud Code endpoints used by the Antigravity IDE. */
export const AG = {
  authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenUrl: "https://oauth2.googleapis.com/token",
  userInfoUrl: "https://www.googleapis.com/oauth2/v1/userinfo?alt=json",
  codeAssist: "https://cloudcode-pa.googleapis.com/v1internal",
  /** Bases tried in order for model listing and generation. Daily endpoint first (matching Antigravity IDE / 9router). */
  apiBases: ["https://daily-cloudcode-pa.googleapis.com", "https://cloudcode-pa.googleapis.com"],
  userAgent: "antigravity/hub/2.24.0 win32/x64",
  scopes: [
    "https://www.googleapis.com/auth/cloud-platform",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/userinfo.profile",
    "https://www.googleapis.com/auth/cclog",
    "https://www.googleapis.com/auth/experimentsandconfigs",
  ],
};

const PROVIDER = "antigravity";
const clientMetadata = { ideType: "ANTIGRAVITY", platform: "PLATFORM_UNSPECIFIED", pluginType: "GEMINI" };

interface OAuthClient { id: string; secret: string }

/** The Google OAuth client comes from ANTIGRAVITY_CLIENT_ID / ANTIGRAVITY_CLIENT_SECRET (.env.local). */
function requireClient(): OAuthClient {
  const id = process.env.ANTIGRAVITY_CLIENT_ID, secret = process.env.ANTIGRAVITY_CLIENT_SECRET;
  if (!id || !secret) throw new Error("Set ANTIGRAVITY_CLIENT_ID and ANTIGRAVITY_CLIENT_SECRET in .env.local, then restart Switchyard.");
  return { id, secret };
}

export function startAntigravityLogin(redirectUri: string): string {
  const client = requireClient();
  const { state, verifier, challenge } = newPkce();
  rememberLogin(state, { provider: PROVIDER, verifier, redirectUri });
  const q = new URLSearchParams({
    client_id: client.id,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: AG.scopes.join(" "),
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    access_type: "offline",
    prompt: "consent",
  });
  return `${AG.authUrl}?${q}`;
}

async function tokenCall(form: Record<string, string>): Promise<{ access_token: string; refresh_token?: string; expires_in: number }> {
  const client = requireClient();
  const res = await fetch(AG.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ ...form, client_id: client.id, client_secret: client.secret }),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await bodyText(res, 2000);
  let json: { access_token?: string; refresh_token?: string; expires_in?: number; error?: string; error_description?: string } = {};
  try { json = JSON.parse(text); } catch { /* non-JSON */ }
  if (!res.ok || !json.access_token) {
    if (json.error === "invalid_grant" && form.grant_type === "refresh_token") throw new ReauthError("Google");
    throw new Error(`Google token endpoint ${res.status}: ${json.error_description ?? json.error ?? text}`);
  }
  return { access_token: json.access_token, refresh_token: json.refresh_token, expires_in: json.expires_in ?? 3600 };
}

async function googleJson<T>(method: string, url: string, access: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${access}`,
      "User-Agent": AG.userAgent,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`${url} ${res.status}: ${await bodyText(res)}`);
  return (await res.json()) as T;
}

type ProjectField = string | { id?: string } | undefined;
const projectId = (p: ProjectField) => (typeof p === "string" ? p : p?.id ?? "");

/** Finds the Cloud Code project the account is entitled to, onboarding it if needed. */
async function loadProject(access: string): Promise<string> {
  const load = await googleJson<{ cloudaicompanionProject?: ProjectField; allowedTiers?: { id: string; isDefault?: boolean }[] }>(
    "POST", `${AG.codeAssist}:loadCodeAssist`, access, { metadata: clientMetadata });
  const existing = projectId(load.cloudaicompanionProject);
  if (existing) return existing;
  const tier = load.allowedTiers?.find((t) => t.isDefault)?.id ?? "free-tier";
  for (let i = 0; i < 10; i++) {
    const op = await googleJson<{ done?: boolean; response?: { cloudaicompanionProject?: ProjectField } }>(
      "POST", `${AG.codeAssist}:onboardUser`, access, { tierId: tier, metadata: clientMetadata });
    const id = projectId(op.response?.cloudaicompanionProject);
    if (op.done && id) return id;
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error("Google did not finish onboarding this account for Antigravity.");
}

export interface AntigravityLoginResult { token: OAuthToken; email: string; project: string }

export async function finishAntigravityLogin(state: string, code: string): Promise<AntigravityLoginResult> {
  const login = takeLogin(PROVIDER, state);
  const r = await tokenCall({ grant_type: "authorization_code", code, code_verifier: login.verifier, redirect_uri: login.redirectUri });
  if (!r.refresh_token) {
    throw new Error("Google returned no refresh token. Remove the app's access in your Google account settings and connect again.");
  }
  const token: OAuthToken = { access: r.access_token, refresh: r.refresh_token, expiresAt: Date.now() + r.expires_in * 1000 };
  const user = await googleJson<{ email?: string }>("GET", AG.userInfoUrl, token.access);
  return { token, email: user.email ?? "Google account", project: await loadProject(token.access) };
}

export async function refreshAntigravity(t: OAuthToken): Promise<OAuthToken> {
  const r = await tokenCall({ grant_type: "refresh_token", refresh_token: t.refresh });
  return { access: r.access_token, refresh: r.refresh_token ?? t.refresh, expiresAt: Date.now() + r.expires_in * 1000 };
}

export interface AntigravityModels {
  models: RemoteModel[];
  /** Highest share of any model's quota already used, 0–100 (undefined if not reported). */
  usagePct?: number;
}

interface FetchModelsResponse {
  models?: Record<string, { displayName?: string; quotaInfo?: { remainingFraction?: number; resetTime?: string } }>;
}

/** Lists the models this account can use, with its quota usage. */
export async function listAntigravityModels(access: string, project: string): Promise<AntigravityModels> {
  let lastErr: unknown;
  for (const base of AG.apiBases) {
    try {
      const json = await googleJson<FetchModelsResponse>("POST", `${base}/v1internal:fetchAvailableModels`, access, { project });
      const entries = Object.entries(json.models ?? {});
      const used = entries
        .map(([, m]) => m.quotaInfo?.remainingFraction)
        .filter((f): f is number => typeof f === "number")
        .map((f) => (1 - f) * 100);
      return {
        models: entries.map(([id, m]) => ({ id, label: m.displayName ?? id })).sort((a, b) => a.id.localeCompare(b.id)),
        usagePct: used.length ? Math.max(...used) : undefined,
      };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}
