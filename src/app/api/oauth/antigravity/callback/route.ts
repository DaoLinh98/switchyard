import { NextResponse, type NextRequest } from "next/server";
import { reloadModels, upsertAccount } from "@/lib/server/accounts";
import { finishAntigravityLogin } from "@/lib/server/oauth/antigravity";

export const dynamic = "force-dynamic";

/** Google redirects here after consent; we store the account and return to the provider page. */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  // Use the Host the browser called (127.0.0.1 vs localhost) so the dashboard tab keeps its origin.
  const back = new URL("/providers/antigravity", `http://${req.headers.get("host") ?? "127.0.0.1:8787"}`);
  try {
    if (q.get("error")) throw new Error(`Google sign-in failed: ${q.get("error")}`);
    const state = q.get("state"), code = q.get("code");
    if (!state || !code) throw new Error("Google did not return a code.");
    const r = await finishAntigravityLogin(state, code);
    upsertAccount("antigravity", r.email, r.token, { email: r.email, project: r.project });
    back.searchParams.set("connected", r.email);
    try {
      await reloadModels("antigravity");
    } catch (e) {
      back.searchParams.set("error", `Connected, but loading models failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  } catch (e) {
    back.searchParams.set("error", e instanceof Error ? e.message : String(e));
  }
  return NextResponse.redirect(back);
}
