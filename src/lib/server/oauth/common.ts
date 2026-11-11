import crypto from "node:crypto";

export interface OAuthToken {
  access: string;
  refresh: string;
  /** Epoch ms when the access token expires. */
  expiresAt: number;
}

/** Thrown when the refresh token is rejected: the user must reconnect. */
export class ReauthError extends Error {
  constructor(provider: string) {
    super(`${provider} login expired or was revoked; reconnect the account`);
  }
}

const b64url = (buf: Buffer) => buf.toString("base64url");

export function newPkce() {
  const verifier = b64url(crypto.randomBytes(32));
  return {
    // 32 bytes like the Claude CLI: claude.ai rejects shorter states ("Invalid request format").
    state: b64url(crypto.randomBytes(32)),
    verifier,
    challenge: b64url(crypto.createHash("sha256").update(verifier).digest()),
  };
}

export interface PendingLogin {
  provider: string;
  verifier: string;
  redirectUri: string;
  createdAt: number;
}

const TTL_MS = 15 * 60_000;
const g = globalThis as unknown as { __syPending?: Map<string, PendingLogin> };

/** In-memory logins waiting for their callback/code, keyed by OAuth state. */
function pending(): Map<string, PendingLogin> {
  g.__syPending ??= new Map();
  const now = Date.now();
  for (const [k, v] of g.__syPending) if (now - v.createdAt > TTL_MS) g.__syPending.delete(k);
  return g.__syPending;
}

export function rememberLogin(state: string, login: Omit<PendingLogin, "createdAt">): void {
  pending().set(state, { ...login, createdAt: Date.now() });
}

/** Takes (and forgets) a pending login; without a state, the newest one for the provider. */
export function takeLogin(provider: string, state?: string): PendingLogin {
  const map = pending();
  let key = state;
  if (!key) {
    const newest = [...map.entries()].filter(([, v]) => v.provider === provider).sort((a, b) => b[1].createdAt - a[1].createdAt)[0];
    key = newest?.[0];
  }
  const login = key ? map.get(key) : undefined;
  if (!login || login.provider !== provider) throw new Error("This login has expired or was not started here. Start the connection again.");
  map.delete(key!);
  return login;
}

/** Reads a response body as text, trimmed to a length safe for error messages. */
export async function bodyText(res: Response, max = 500): Promise<string> {
  const t = (await res.text()).trim();
  return t.length > max ? t.slice(0, max) + "…" : t;
}
