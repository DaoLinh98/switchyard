"use client";

import Link from "next/link";
import { useState } from "react";
import { tintBg, type ProviderInfo } from "@/lib/catalog";
import type { AccountTone, ConnectedProviderView } from "@/lib/server/providers";
import s from "./providers.module.css";

type Filter = "all" | "on" | "off";

const BAR: Record<AccountTone, string> = { ok: "#7FD9A0", warn: "#F5D04F", limit: "#FF5C7A", off: "#2A303A" };
const STATUS_BADGE: Record<ConnectedProviderView["status"], string> = {
  Active: "badge-ok", "Partly limited": "badge-warn", Limited: "badge-limit", Paused: "badge-muted",
};

export function ProvidersView({ connected, catalog }: {
  connected: ConnectedProviderView[];
  catalog: { info: ProviderInfo; connections: number }[];
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const matches = (name: string) => !q || name.toLowerCase().includes(q);

  const shownConnected = connected.filter((p) => matches(p.info.name));
  const shownCatalog = catalog.filter(({ info, connections }) =>
    matches(info.name) && (filter === "all" || (filter === "on" ? connections > 0 : connections === 0)));

  const totalConnections = connected.reduce((n, p) => n + p.accounts.length, 0);
  const limited = connected.reduce((n, p) => n + p.accounts.filter((a) => a.tone === "limit").length, 0);

  return (
    <>
      <header className={s.header}>
        <div className={s.intro}>
          <span className="eyebrow">Pool</span>
          <h1 className="page-title">Providers</h1>
          <p className="lede">Connect accounts to any provider below. Each connection joins the pool the proxy draws from when it routes Claude CLI requests.</p>
        </div>
        <label className={`search ${s.search}`}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
          <span className="sr-only">Search providers</span>
          <input type="search" placeholder="Search providers" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
      </header>

      <section aria-labelledby="h-connected" className={s.section}>
        <div className={s.sectionHead}>
          <h2 id="h-connected" className="h2">Connected</h2>
          <span className="hint">
            {connected.length} provider{connected.length === 1 ? "" : "s"} · {totalConnections} connection{totalConnections === 1 ? "" : "s"}
            {limited > 0 && ` · ${limited} rate-limited`}
          </span>
        </div>
        {connected.length === 0 ? (
          <div className="empty">No accounts connected yet. Pick a provider below and sign in to add it to the pool.</div>
        ) : (
          <div className={s.connectedGrid}>
            {shownConnected.map((p) => (
              <Link key={p.info.id} href={`/providers/${p.info.id}`} className={s.card}>
                <span className={s.cardHead}>
                  <span aria-hidden="true" className={`tile ${s.tileLg}`} style={{ color: p.info.tint, background: tintBg(p.info.tint) }}>{p.info.mono}</span>
                  <span className={s.cardTitle}>
                    <span className={s.cardName}>{p.info.name}</span>
                    <span className="hint">{p.meta}</span>
                  </span>
                  <span className={`badge ${STATUS_BADGE[p.status]}`}><span className="badge-dot" />{p.status}</span>
                </span>
                <span className={s.accounts}>
                  {p.accounts.map((a, i) => (
                    <span key={i} className={s.account}>
                      <span className={s.accountLine}>
                        <span className={s.ellipsis}>{a.label}</span>
                        <span className={s.accountNote} style={{ color: a.tone === "limit" ? "#FF5C7A" : "#9AA3AF" }}>{a.note}</span>
                      </span>
                      <span className="bar"><span style={{ width: `${a.pct}%`, background: BAR[a.tone] }} /></span>
                    </span>
                  ))}
                </span>
                <span className={s.cardFoot}>
                  <span><span className={s.footValue}>{p.modelCount}</span> models · prefix <span className={s.footValue}>{p.info.prefix}</span></span>
                  <span className={s.open}>Open →</span>
                </span>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section aria-labelledby="h-oauth" className={s.section}>
        <div className={s.sectionHeadCenter}>
          <h2 id="h-oauth" className="h2">OAuth providers</h2>
          <span className="hint">Sign in with an existing subscription</span>
          <div role="group" aria-label="Filter" className={`segmented ${s.filter}`}>
            {([["all", "All"], ["on", "Connected"], ["off", "Not connected"]] as const).map(([id, label]) => (
              <button key={id} type="button" aria-pressed={filter === id} onClick={() => setFilter(id)}>{label}</button>
            ))}
          </div>
        </div>
        <div className={s.oauthGrid}>
          {shownCatalog.map(({ info, connections }) => (
            <Link key={info.id} href={`/providers/${info.id}`} className={s.oauthItem}>
              <span aria-hidden="true" className={`tile ${s.tileSm}`} style={{ color: info.tint, background: tintBg(info.tint) }}>{info.mono}</span>
              <span className={s.cardTitle}>
                <span className={`${s.oauthName} ${s.ellipsis}`}>{info.name}</span>
                <span className={s.oauthSub} style={{ color: connections ? "#7FD9A0" : "#9AA3AF" }}>
                  {connections ? `${connections} connected` : "No connections"}
                </span>
              </span>
              <span aria-hidden="true" className={s.plus}>+</span>
            </Link>
          ))}
        </div>
      </section>

      <section aria-labelledby="h-custom" className={s.section}>
        <div className={s.sectionHeadCenter}>
          <h2 id="h-custom" className="h2">Custom providers</h2>
          <span className="badge badge-muted">Coming soon</span>
        </div>
      </section>
    </>
  );
}
