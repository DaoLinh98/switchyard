import { NextRequest } from "next/server";
import { proxyApiKey } from "../../../lib/server/db";
import { resolveHops, getCandidateAccounts, setAccountCooldown, pinConversation } from "../../../lib/server/proxy/router";
import { forwardToClaude } from "../../../lib/server/proxy/claude-forwarder";
import { forwardToAntigravity } from "../../../lib/server/proxy/antigravity-forwarder";
import { logTraffic, type TrafficAttempt } from "../../../lib/server/proxy/traffic";
import { tapSseStream } from "../../../lib/server/proxy/stream";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function verifyApiKey(req: NextRequest): boolean {
  const expected = proxyApiKey();
  const headerKey = req.headers.get("x-api-key");
  if (headerKey && headerKey === expected) return true;

  const auth = req.headers.get("authorization");
  if (auth) {
    const [bearer, token] = auth.split(" ");
    if (bearer?.toLowerCase() === "bearer" && token === expected) return true;
  }
  return false;
}

function extractConvId(req: NextRequest, body: Record<string, unknown>): string | null {
  const fromHeader = req.headers.get("x-conversation-id");
  if (fromHeader) return fromHeader;

  const metadata = body.metadata as Record<string, unknown> | undefined;
  if (metadata) {
    if (typeof metadata.conversation_id === "string") return metadata.conversation_id;
    if (typeof metadata.user_id === "string") return metadata.user_id;
  }
  return null;
}

function formatGoogleError(status: number, rawText: string): string {
  try {
    const json = JSON.parse(rawText);
    const googleMsg = json?.error?.message ?? json?.message ?? rawText;
    let errType = "api_error";
    if (status === 401 || status === 403) errType = "permission_error";
    else if (status === 404) errType = "not_found_error";
    else if (status === 429 || status === 529) errType = "rate_limit_error";
    else if (status === 400) errType = "invalid_request_error";

    return JSON.stringify({
      type: "error",
      error: {
        type: errType,
        message: googleMsg,
      },
    });
  } catch {
    return JSON.stringify({
      type: "error",
      error: {
        type: "api_error",
        message: rawText,
      },
    });
  }
}

export async function POST(req: NextRequest) {
  if (!verifyApiKey(req)) {
    return Response.json(
      {
        type: "error",
        error: {
          type: "authentication_error",
          message: "invalid x-api-key",
        },
      },
      { status: 401 }
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json(
      {
        type: "error",
        error: {
          type: "invalid_request_error",
          message: "Malformed JSON body",
        },
      },
      { status: 400 }
    );
  }

  const requestedModel = typeof body.model === "string" ? body.model : "";
  if (!requestedModel) {
    return Response.json(
      {
        type: "error",
        error: {
          type: "invalid_request_error",
          message: "model is required",
        },
      },
      { status: 400 }
    );
  }

  const convId = extractConvId(req, body);
  const startTime = Date.now();
  const hops = resolveHops("claude-code", requestedModel);
  const attempts: TrafficAttempt[] = [];
  let switched = false;

  for (let h = 0; h < hops.length; h++) {
    const hop = hops[h];
    const isLastHop = h === hops.length - 1;
    const provider = hop.provider;
    const candidates = getCandidateAccounts(provider, convId);
    if (!candidates.length) {
      if (!isLastHop) continue;
      logTraffic({
        conv: convId,
        asked: requestedModel,
        provider,
        model: hop.model,
        account: "none",
        status: 503,
        latencyMs: Date.now() - startTime,
        switched: false,
        attempts: [],
      });
      return Response.json(
        {
          type: "error",
          error: {
            type: "api_error",
            message: `No active accounts configured for provider '${provider}' in Switchyard`,
          },
        },
        { status: 503 }
      );
    }

    for (let i = 0; i < candidates.length; i++) {
      const account = candidates[i];
      if (attempts.length > 0) {
        switched = true;
      }

      try {
        if (provider === "antigravity") {
          const agResult = await forwardToAntigravity({
            accountId: account.id,
            model: hop.model,
            body,
            signal: req.signal,
          });

          const status = agResult.status;
          if (status === 429 || status === 529 || status === 401 || status === 403) {
            const cooldownMs = 60_000;
            setAccountCooldown(account.id, Date.now() + cooldownMs);

            attempts.push({
              accountId: account.id,
              accountLabel: account.label,
              status,
              error: status === 429 ? "Rate limited" : "Auth/Service error",
            });

            if (i < candidates.length - 1) continue;

            if (!isLastHop) {
              break; // Try next fallback hop in chain
            }

            const errBody = await agResult.response.text();
            logTraffic({
              conv: convId,
              asked: requestedModel,
              provider,
              model: hop.model,
              account: account.label,
              status,
              latencyMs: Date.now() - startTime,
              switched,
              attempts,
            });

            return new Response(formatGoogleError(status, errBody), {
              status,
              headers: { "Content-Type": "application/json" },
            });
          }

          if (agResult.sseStream) {
            if (convId) {
              pinConversation(convId, hop.slot, hop.hopIndex, account.id);
            }

            agResult.onStreamDone?.((usage) => {
              logTraffic({
                conv: convId,
                asked: requestedModel,
                provider,
                model: hop.model,
                account: account.label,
                status: 200,
                latencyMs: Date.now() - startTime,
                tokensIn: usage.inputTokens,
                tokensOut: usage.outputTokens,
                switched,
                attempts,
              });
            });

            return new Response(agResult.sseStream, {
              status: 200,
              headers: {
                "Content-Type": "text/event-stream; charset=utf-8",
                "Cache-Control": "no-cache, no-transform",
                Connection: "keep-alive",
              },
            });
          }

          if (agResult.response.ok) {
            if (convId) {
              pinConversation(convId, hop.slot, hop.hopIndex, account.id);
            }
            const data = (await agResult.response.json()) as { usage?: { input_tokens?: number; output_tokens?: number } };
            logTraffic({
              conv: convId,
              asked: requestedModel,
              provider,
              model: hop.model,
              account: account.label,
              status: 200,
              latencyMs: Date.now() - startTime,
              tokensIn: data.usage?.input_tokens,
              tokensOut: data.usage?.output_tokens,
              switched,
              attempts,
            });
            return Response.json(data, { status: 200 });
          }

          const errText = await agResult.response.text();
          logTraffic({
            conv: convId,
            asked: requestedModel,
            provider,
            model: hop.model,
            account: account.label,
            status,
            latencyMs: Date.now() - startTime,
            switched,
            attempts,
          });
          return new Response(formatGoogleError(status, errText), { status, headers: { "Content-Type": "application/json" } });
        }

        // Claude Code Provider
        const { response: res, status } = await forwardToClaude({
          accountId: account.id,
          model: hop.model,
          body,
          clientHeaders: req.headers,
          signal: req.signal,
        });

        // Failover on rate limits (429), overloaded (529), or auth/permission errors
        if (status === 429 || status === 529 || status === 401 || status === 403) {
          const retryAfter = res.headers.get("retry-after");
          const cooldownMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : 60_000;
          setAccountCooldown(account.id, Date.now() + cooldownMs);

          attempts.push({
            accountId: account.id,
            accountLabel: account.label,
            status,
            error: status === 429 ? "Rate limited" : status === 529 ? "Overloaded" : "Auth error",
          });

          // If there is another account to try, loop continues
          if (i < candidates.length - 1) {
            continue;
          }

          if (!isLastHop) {
            break; // Try next fallback hop in chain
          }

          // Otherwise all accounts failed, return the upstream response
          const errBody = await res.text();
          logTraffic({
            conv: convId,
            asked: requestedModel,
            provider: "claude-code",
            model: hop.model,
            account: account.label,
            status,
            latencyMs: Date.now() - startTime,
            switched,
            attempts,
          });

          return new Response(errBody, {
            status,
            headers: { "Content-Type": res.headers.get("content-type") ?? "application/json" },
          });
        }

        // On 200 OK
        if (res.ok) {
          if (convId) {
            pinConversation(convId, hop.slot, hop.hopIndex, account.id);
          }

          if (body.stream) {
            if (!res.body) {
              return Response.json(
                { type: "error", error: { type: "api_error", message: "Upstream stream empty" } },
                { status: 502 }
              );
            }

            const tappedStream = tapSseStream(res.body, {
              onDone: (usage) => {
                logTraffic({
                  conv: convId,
                  asked: requestedModel,
                  provider: "claude-code",
                  model: hop.model,
                  account: account.label,
                  status: 200,
                  latencyMs: Date.now() - startTime,
                  tokensIn: usage.inputTokens,
                  tokensOut: usage.outputTokens,
                  switched,
                  attempts,
                });
              },
            });

            return new Response(tappedStream, {
              status: 200,
              headers: {
                "Content-Type": "text/event-stream; charset=utf-8",
                "Cache-Control": "no-cache, no-transform",
                Connection: "keep-alive",
              },
            });
          }

          // Non-streaming response
          const data = (await res.json()) as { usage?: { input_tokens?: number; output_tokens?: number } };
          logTraffic({
            conv: convId,
            asked: requestedModel,
            provider: "claude-code",
            model: hop.model,
            account: account.label,
            status: 200,
            latencyMs: Date.now() - startTime,
            tokensIn: data.usage?.input_tokens,
            tokensOut: data.usage?.output_tokens,
            switched,
            attempts,
          });

          return Response.json(data, { status: 200 });
        }

        // Other client/server error from upstream (e.g. 400 Bad Request) - return directly without failover
        const errText = await res.text();
        logTraffic({
          conv: convId,
          asked: requestedModel,
          provider: "claude-code",
          model: hop.model,
          account: account.label,
          status,
          latencyMs: Date.now() - startTime,
          switched,
          attempts,
        });

        return new Response(errText, {
          status,
          headers: { "Content-Type": res.headers.get("content-type") ?? "application/json" },
        });
      } catch (err) {
        attempts.push({
          accountId: account.id,
          accountLabel: account.label,
          error: err instanceof Error ? err.message : String(err),
        });
        if (i < candidates.length - 1) {
          continue;
        }
        throw err;
      }
    }
  }

  // All hops and candidates exhausted
  logTraffic({
    conv: convId,
    asked: requestedModel,
    provider: hops[0]?.provider ?? "unknown",
    model: requestedModel,
    account: "failed",
    status: 502,
    latencyMs: Date.now() - startTime,
    switched,
    attempts,
  });

  return Response.json(
    {
      type: "error",
      error: {
        type: "api_error",
        message: "All candidate accounts or chain hops failed",
      },
    },
    { status: 502 }
  );
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, x-api-key, anthropic-version, anthropic-beta, x-conversation-id",
    },
  });
}
