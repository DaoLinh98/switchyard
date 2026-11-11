"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { tintBg } from "@/lib/catalog";
import type { DetailAccount, ProviderDetailData, Thinking } from "@/lib/server/provider-detail";
import { Switch } from "@/components/Switch";
import * as act from "./actions";
import s from "./detail.module.css";

type Notice = { tone: "ok" | "error"; text: string } | null;

const STATE_STYLE: Record<DetailAccount["state"], React.CSSProperties> = {
  active: { background: "rgba(127,217,160,0.12)", color: "#7FD9A0" },
  limited: { background: "rgba(255,92,122,0.10)", color: "#FF5C7A" },
  error: { background: "rgba(255,92,122,0.10)", color: "#FF5C7A" },
  paused: { background: "#1E232B", color: "#9AA3AF" },
};
const BAR = { ok: "#7FD9A0", warn: "#F5D04F", limit: "#FF5C7A", off: "#2A303A" } as const;

export function ProviderDetailView({ data, connected, error }: { data: ProviderDetailData; connected?: string; error?: string }) {
  const { info } = data;
  const router = useRouter();
  const [pending, start] = useTransition();
  const [notice, setNotice] = useState<Notice>(
    error ? { tone: "error", text: error } : connected ? { tone: "ok", text: `Connected ${connected}.` } : null);

  /** Runs a server action and surfaces its error (or success text) in the notice bar. */
  function call<T>(fn: () => Promise<act.Result<T>>, okText?: (d: T) => string) {
    start(async () => {
      const r = await fn();
      if (!r.ok) setNotice({ tone: "error", text: r.error });
      else if (okText) setNotice({ tone: "ok", text: okText(r.data) });
    });
  }

  if (!info.supported) {
    return (
      <>
        <BackLink />
        <Header data={data} />
        <section className={s.panel}><p className="hint">{info.name} is not supported yet. Claude Code and Antigravity are available now.</p></section>
      </>
    );
  }

  const enabledCount = data.models.filter((m) => m.enabled).length;

  return (
    <>
      <BackLink />
      <Header data={data} />
      {notice && (
        <div role="status" className={s.notice} data-tone={notice.tone}>
          <span>{notice.text}</span>
          <button type="button" aria-label="Dismiss" onClick={() => { setNotice(null); router.replace(`/providers/${info.id}`); }}>×</button>
        </div>
      )}

      {/* Connections */}
      <section aria-labelledby="h-conn" className={s.panel}>
        <div className={s.panelHead}>
          <h2 id="h-conn" className="h2">Connections</h2>
          <div className={s.controls}>
            <button type="button" className={s.btnGhost} disabled={pending || !data.accounts.length}
              onClick={() => call(() => act.testAll(info.id), (res) => {
                const bad = res.filter((x) => !x.ok).length;
                return `Tested ${res.length} account${res.length === 1 ? "" : "s"} · ${res.length - bad} OK${bad ? ` · ${bad} failed` : ""}`;
              })}>
              {pending ? "Working…" : "Test one by one"}
            </button>
            <span className={s.inline}>Round robin
              <Switch checked={data.roundRobin} label="Round robin" onChange={(v) => call(() => act.setRoundRobin(info.id, v))} />
            </span>
            <label className={s.inline}>Sticky
              <StickyInput value={data.sticky} onCommit={(n) => call(() => act.setSticky(info.id, n))} />
            </label>
          </div>
        </div>
        <p className={s.help}>Order sets priority. With round robin on, each account serves the sticky number of requests before handing over; a limited account is skipped until its window resets.</p>

        <div className={s.accountList}>
          {data.accounts.length === 0 && <div className={s.accountEmpty}>No accounts yet. Add a connection to start routing through {info.name}.</div>}
          {data.accounts.map((a, i) => (
            <AccountRowView key={a.id} a={a} first={i === 0} last={i === data.accounts.length - 1} provider={info.id} call={call} />
          ))}
        </div>

        <AddConnection provider={info.id} accountCount={data.accounts.length} call={call} setNotice={setNotice} />
      </section>

      <CustomHeaders provider={info.id} headers={data.headers} call={call} />

      {/* Models */}
      <section aria-labelledby="h-models" className={s.panel}>
        <div className={s.panelHead}>
          <h2 id="h-models" className="h2">Available models</h2>
          <label className={s.inline}>Thinking
            <select className={s.select} value={data.thinking} onChange={(e) => call(() => act.setThinking(info.id, e.target.value as Thinking))}>
              <option value="auto">Auto</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option>
            </select>
          </label>
          <span className="hint">{enabledCount} / {data.models.length} enabled</span>
          <div className={s.pushRight}>
            <button type="button" className={s.btnGhost} disabled={pending || !data.accounts.length}
              onClick={() => call(() => act.reloadModelsAction(info.id), (n) => `Loaded ${n} models from ${info.name}.`)}>Reload</button>
            <button type="button" className={s.btnGhost} disabled={pending || enabledCount === 0}
              onClick={() => call(() => act.setAllModels(info.id, false))}>Disable all</button>
          </div>
        </div>
        {data.models.length === 0 ? (
          <div className={s.accountEmpty}>No models loaded yet. They are fetched from {info.name} once an account is connected.</div>
        ) : (
          <div className={s.modelGrid}>
            {data.models.map((m) => (
              <div key={m.id} className={s.model} data-off={!m.enabled}>
                <div className={s.modelText}>
                  <span className={s.modelId}>{m.fullId}</span>
                  <span className={s.modelMeta}>{m.label}
                    {m.mappedTo && <Link href="/cli-tools/claude-code" className={s.mapped}>mapped → {m.mappedTo}</Link>}
                  </span>
                </div>
                <button type="button" aria-label={`Copy ${m.fullId}`} className={s.copy} onClick={() => navigator.clipboard?.writeText(m.fullId)}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" /></svg>
                </button>
                <Switch size="sm" checked={m.enabled} label={`Enable ${m.fullId}`} onChange={(v) => call(() => act.toggleModel(info.id, m.id, v))} />
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  );
}

function BackLink() {
  return <div className={s.back}><Link href="/providers">← Providers</Link></div>;
}

function Header({ data }: { data: ProviderDetailData }) {
  const n = data.accounts.length;
  return (
    <header className={s.header}>
      <span aria-hidden="true" className={`tile ${s.tile}`} style={{ color: data.info.tint, background: tintBg(data.info.tint) }}>{data.info.mono}</span>
      <div className={s.headerText}>
        <h1 className={s.title}>{data.info.name}</h1>
        <span className={s.sub}>{n} connection{n === 1 ? "" : "s"} · OAuth · prefix <span className="mono" style={{ color: "var(--text)" }}>{data.info.prefix}</span></span>
      </div>
    </header>
  );
}

function StickyInput({ value, onCommit }: { value: number; onCommit: (n: number) => void }) {
  const [v, setV] = useState(String(value));
  useEffect(() => setV(String(value)), [value]);
  const commit = () => { const n = Number(v); if (n !== value) onCommit(n); };
  return <input type="number" min={1} value={v} className={s.sticky} onChange={(e) => setV(e.target.value)} onBlur={commit}
    onKeyDown={(e) => { if (e.key === "Enter") commit(); }} />;
}

type Call = <T>(fn: () => Promise<act.Result<T>>, okText?: (d: T) => string) => void;

function AccountRowView({ a, first, last, provider, call }: { a: DetailAccount; first: boolean; last: boolean; provider: string; call: Call }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(a.label);
  const [confirmDelete, setConfirmDelete] = useState(false);
  return (
    <div className={s.accountRow}>
      <div className={s.arrows}>
        <button type="button" aria-label={`Move ${a.label} up`} disabled={first} onClick={() => call(() => act.moveAccountAction(provider, a.id, -1))}>▲</button>
        <button type="button" aria-label={`Move ${a.label} down`} disabled={last} onClick={() => call(() => act.moveAccountAction(provider, a.id, 1))}>▼</button>
      </div>
      <span className={s.rank}>#{a.rank}</span>
      <div className={s.accountMain}>
        <div className={s.accountTop}>
          {editing ? (
            <form className={s.renameForm} onSubmit={(e) => { e.preventDefault(); setEditing(false); call(() => act.renameAccountAction(provider, a.id, name)); }}>
              <input aria-label="Account name" value={name} autoFocus onChange={(e) => setName(e.target.value)} className={s.renameInput} />
              <button type="submit" className={s.btnSmall}>Save</button>
              <button type="button" className={s.btnSmall} onClick={() => { setName(a.label); setEditing(false); }}>Cancel</button>
            </form>
          ) : (
            <span className={s.email}>{a.label}</span>
          )}
          <span className={s.pill} style={STATE_STYLE[a.state]} title={a.error ?? undefined}>{a.state}</span>
          <span className={s.pill} style={{ background: "#1E232B", color: "#C9CED6" }}>OAuth</span>
        </div>
        <div className={s.quota}>
          <span className={s.quotaBar}><span style={{ width: `${a.pct}%`, background: BAR[a.tone] }} /></span>
          <span className={s.quotaText}>{a.note}</span>
        </div>
        {a.error && <span className={s.rowError}>{a.error}</span>}
      </div>
      <div className={s.rowActions}>
        {!editing && <button type="button" className={s.btnRow} onClick={() => setEditing(true)}>Edit</button>}
        {confirmDelete ? (
          <>
            <button type="button" className={s.btnRow} style={{ color: "#FF5C7A" }} onClick={() => call(() => act.deleteAccountAction(provider, a.id))}>Confirm delete</button>
            <button type="button" className={s.btnRow} onClick={() => setConfirmDelete(false)}>Keep</button>
          </>
        ) : (
          <button type="button" className={s.btnRow} style={{ color: "#FF5C7A" }} onClick={() => setConfirmDelete(true)}>Delete</button>
        )}
        <span style={{ marginLeft: 6, display: "flex" }}>
          <Switch checked={a.enabled} label={`Enable ${a.label}`} onChange={(v) => call(() => act.toggleAccount(provider, a.id, v))} />
        </span>
      </div>
    </div>
  );
}

function AddConnection({ provider, accountCount, call, setNotice }: {
  provider: string; accountCount: number; call: Call; setNotice: (n: Notice) => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [code, setCode] = useState("");
  const [startCount] = useState(accountCount);

  // Antigravity: the Google callback lands in the other tab; poll until the new account shows up.
  useEffect(() => {
    if (!waiting) return;
    const t = setInterval(() => router.refresh(), 2000);
    return () => clearInterval(t);
  }, [waiting, router]);
  useEffect(() => {
    if (waiting && accountCount > startCount) { setWaiting(false); setOpen(false); setNotice({ tone: "ok", text: "Account connected." }); }
  }, [waiting, accountCount, startCount, setNotice]);

  function openBrowser() {
    call(() => act.startLogin(provider), ({ authUrl }) => {
      window.open(authUrl, "_blank", "noopener");
      if (provider === "antigravity") setWaiting(true);
      return "Sign-in page opened in a new tab.";
    });
  }

  if (!open) {
    return <button type="button" className={s.addBtn} onClick={() => setOpen(true)}>+ Add connection</button>;
  }

  const cancel = <button type="button" className={s.btnGhost} style={{ alignSelf: "flex-start" }} onClick={() => { setOpen(false); setWaiting(false); }}>Cancel</button>;

  const isClaude = provider === "claude-code";
  return (
    <div className={s.addPanel}>
      <div className={s.addCol}>
        <span className={s.addTitle}>{isClaude ? "Sign in with Claude" : "Sign in with Google"}</span>
        <span className={s.addHelp}>
          {isClaude
            ? "Opens claude.ai in your browser. After you approve, Claude shows a code: paste it on the right."
            : "Opens the login page in your browser. The refresh token stays on this machine."}
        </span>
        <button type="button" className={s.btnLight} onClick={openBrowser}>Open browser</button>
      </div>
      {isClaude ? (
        <form className={s.addCol} onSubmit={(e) => {
          e.preventDefault();
          call(() => act.finishClaude(code), (d) => {
            setOpen(false); setCode("");
            return d.modelsError ? `Connected ${d.email}, but loading models failed: ${d.modelsError}` : `Connected ${d.email}.`;
          });
        }}>
          <span className={s.addTitle}>Paste the code</span>
          <input aria-label="Authorization code" placeholder="code#state" value={code} onChange={(e) => setCode(e.target.value)} className={s.codeInput} autoComplete="off" />
          <button type="submit" className={s.btnLight} disabled={!code.trim()}>Connect</button>
        </form>
      ) : (
        <div className={s.addCol}>
          <span className={s.addTitle}>Approve in the new tab</span>
          {waiting
            ? <span className={s.waiting}><span className={s.waitDot} />Waiting for approval…</span>
            : <span className={s.addHelp}>Google sends you back to Switchyard when you are done.</span>}
        </div>
      )}
      {cancel}
    </div>
  );
}

function CustomHeaders({ provider, headers, call }: { provider: string; headers: { name: string; value: string }[]; call: Call }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const hint = open ? "Hide" : `${headers.length ? `${headers.length} set` : "None set"} · Show`;
  return (
    <section className={s.panelFlat}>
      <button type="button" aria-expanded={open} className={s.collapse} onClick={() => setOpen(!open)}>
        Custom headers<span className={s.collapseHint}>{hint}</span>
      </button>
      {open && (
        <div className={s.headersBody}>
          {headers.map((h, i) => (
            <div key={h.name + i} className={s.headerRow}>
              <span className="mono">{h.name}</span><span className={`mono ${s.headerValue}`}>{h.value}</span>
              <button type="button" className={s.btnRow} onClick={() => call(() => act.setHeaders(provider, headers.filter((_, j) => j !== i)))}>Remove</button>
            </div>
          ))}
          <form className={s.headerForm} onSubmit={(e) => {
            e.preventDefault();
            call(() => act.setHeaders(provider, [...headers, { name: name.trim(), value }]));
            setName(""); setValue("");
          }}>
            <input aria-label="Header name" placeholder="Header name" value={name} onChange={(e) => setName(e.target.value)} className={s.hName} />
            <input aria-label="Header value" placeholder="Value" value={value} onChange={(e) => setValue(e.target.value)} className={s.hValue} />
            <button type="submit" className={s.btnGhostLg} disabled={!name.trim()}>Add</button>
          </form>
        </div>
      )}
    </section>
  );
}
