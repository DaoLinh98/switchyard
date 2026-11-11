"use client";

import { useState } from "react";
import Link from "next/link";
import type { CliSlotMapping, AvailableModelOption } from "@/lib/server/cli-tools";
import { saveSlotAction, applySettingsAction } from "../actions";
import s from "./claude-detail.module.css";

export function ClaudeCodeDetailView({
  slots,
  availableModels,
  settingsPath,
  apiKey,
}: {
  slots: CliSlotMapping[];
  availableModels: AvailableModelOption[];
  settingsPath: string;
  apiKey: string;
}) {
  const [slotStates, setSlotStates] = useState(
    slots.map((s) => ({
      slot: s.slot,
      label: s.label,
      hops: s.hops.map((h) => h.model),
    }))
  );

  const [activeDropdownSlot, setActiveDropdownSlot] = useState<string | null>(null);
  const [editingHop, setEditingHop] = useState<{ slot: string; index: number } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);

  // Options toggles (matching Image #12 & #13)
  const [keepConversation, setKeepConversation] = useState(true);
  const [enable1MContext, setEnable1MContext] = useState(false);
  const [filterNaming, setFilterNaming] = useState(true);
  const [webSearch, setWebSearch] = useState(false);

  const addHop = (slotKey: string, modelId: string) => {
    setSlotStates((prev) =>
      prev.map((item) => {
        if (item.slot !== slotKey) return item;
        if (item.hops.includes(modelId)) return item;
        return { ...item, hops: [...item.hops, modelId] };
      })
    );
    setActiveDropdownSlot(null);
  };

  const replaceHop = (slotKey: string, index: number, modelId: string) => {
    setSlotStates((prev) =>
      prev.map((item) => {
        if (item.slot !== slotKey) return item;
        const nextHops = [...item.hops];
        nextHops[index] = modelId;
        return { ...item, hops: nextHops };
      })
    );
    setEditingHop(null);
  };

  const removeHop = (slotKey: string, index: number) => {
    setSlotStates((prev) =>
      prev.map((item) => {
        if (item.slot !== slotKey) return item;
        const nextHops = item.hops.filter((_, i) => i !== index);
        return { ...item, hops: nextHops.length ? nextHops : [availableModels[0]?.fullId || ""] };
      })
    );
  };

  const handleApply = async () => {
    setApplying(true);
    try {
      for (const item of slotStates) {
        await saveSlotAction(item.slot, item.hops);
      }
      const res = await applySettingsAction();
      if (res.success) {
        setToast("Applied configuration to ~/.claude/settings.json! Switchyard is now active.");
      }
    } catch (e: any) {
      alert("Failed to apply settings: " + (e?.message || String(e)));
    } finally {
      setApplying(false);
    }
  };

  const handleResetRecommended = () => {
    setSlotStates([
      { slot: "fable", label: "Fable", hops: ["ag/claude-sonnet-5-5-high"] },
      { slot: "opus", label: "Opus", hops: ["ag/claude-sonnet-5-5-high"] },
      { slot: "sonnet", label: "Sonnet", hops: ["ag/claude-sonnet-5-5-high"] },
      { slot: "haiku", label: "Haiku", hops: ["ag/gemini-3.8-flash"] },
    ]);
    setToast("Loaded recommended model mapping (Opus/Sonnet -> Sonnet 5.5, Haiku -> Gemini 3.8). Click Apply to save.");
    setTimeout(() => setToast(null), 4000);
  };

  const handleReset = () => {
    setSlotStates(
      slots.map((s) => ({
        slot: s.slot,
        label: s.label,
        hops: s.hops.map((h) => h.model),
      }))
    );
    setToast("Reset to previous saved slot mappings.");
    setTimeout(() => setToast(null), 3000);
  };

  return (
    <div className={s.detailPage}>
      <div className={s.backRow}>
        <Link href="/cli-tools" className={s.backLink}>
          &larr; Back to CLI Tools
        </Link>
      </div>

      <header className={s.header}>
        <div className={s.intro}>
          <span className="eyebrow">CLI Configuration</span>
          <h1 className="page-title">Claude Code</h1>
          <p className="lede">
            Configure model fallbacks and connection routing for Claude Code CLI.
          </p>
        </div>
        <div className={s.headerActions}>
          <button className={s.resetBtn} onClick={handleResetRecommended} type="button" title="Set recommended model defaults">
            Recommend
          </button>
          <button className={s.resetBtn} onClick={handleReset} type="button">
            Reset
          </button>
          <button className={s.applyBtn} onClick={handleApply} disabled={applying} type="button">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M20 6L9 17l-5-5" />
            </svg>
            {applying ? "Applying..." : "Apply"}
          </button>
        </div>
      </header>

      {toast && (
        <div className={s.toast}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M20 6L9 17l-5-5" />
          </svg>
          {toast}
        </div>
      )}

      {/* Connection Section */}
      <section className={s.section}>
        <h2 className={s.sectionTitle}>Connection</h2>
        <p className={s.sectionDesc}>Proxy server address and authentication key</p>

        <div className={s.connectionGrid}>
          <div className={s.field}>
            <label className={s.fieldLabel}>Endpoint</label>
            <div className={s.fieldInputWrapper}>
              <input
                className={s.fieldInput}
                value="http://127.0.0.1:8787/v1"
                readOnly
              />
            </div>
            <span className={s.fieldHint}>Switchyard local server endpoint</span>
          </div>

          <div className={s.field}>
            <label className={s.fieldLabel}>API Key</label>
            <div className={s.fieldInputWrapper}>
              <input
                className={s.fieldInput}
                value={apiKey ? `${apiKey.slice(0, 10)}...${apiKey.slice(-6)}` : "sy-live-..."}
                readOnly
              />
            </div>
            <span className={s.fieldHint}>Injected into ANTHROPIC_AUTH_TOKEN</span>
          </div>
        </div>
      </section>

      {/* Models Fallback Section */}
      <section className={s.section}>
        <h2 className={s.sectionTitle}>Models</h2>
        <p className={s.sectionDesc}>
          Set model fallback chains for each slot. If an account is rate-limited, Switchyard automatically switches to the next model in chain.
        </p>

        <div className={s.slotList}>
          {slotStates.map((item) => (
            <div key={item.slot} className={s.slotItem}>
              <div className={s.slotHeader}>
                <div className={s.slotNameGroup}>
                  <span className={s.slotBadge}>{item.label}</span>
                  <span className={s.slotTarget}>{item.slot}</span>
                </div>
              </div>

              <div className={s.tagChain}>
                {item.hops.map((hopModel, idx) => {
                  const isPrimary = idx === 0;
                  const isEditing = editingHop?.slot === item.slot && editingHop?.index === idx;
                  return (
                    <div key={idx} style={{ position: "relative" }}>
                      <div
                        className={`${s.hopTag} ${isEditing ? s.hopTagActive : ""}`}
                        onClick={() => {
                          setActiveDropdownSlot(null);
                          setEditingHop(isEditing ? null : { slot: item.slot, index: idx });
                        }}
                        title="Click to change model"
                      >
                        <span className={`${s.hopDot} ${isPrimary ? s.hopDotPrimary : s.hopDotFallback}`} />
                        <span className={s.hopModelName}>{hopModel}</span>
                        <span className={s.changeIcon}>▼</span>
                        {item.hops.length > 1 && (
                          <button
                            type="button"
                            className={s.removeTagBtn}
                            onClick={(e) => {
                              e.stopPropagation();
                              removeHop(item.slot, idx);
                            }}
                            title="Remove model"
                          >
                            &times;
                          </button>
                        )}
                      </div>

                      {isEditing && (
                        <div className={s.modelDropdown}>
                          <div style={{ padding: "6px 10px", fontSize: "11px", color: "var(--muted)", borderBottom: "1px solid var(--line-2)" }}>
                            Select model to replace:
                          </div>
                          {availableModels.map((m) => (
                            <div
                              key={m.fullId}
                              className={s.modelDropdownItem}
                              onClick={() => replaceHop(item.slot, idx, m.fullId)}
                            >
                              <span>{m.label}</span>
                              <span style={{ color: "var(--dim)", fontSize: "11px" }}>{m.provider}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}

                <div className={s.addFallbackPopover}>
                  <button
                    type="button"
                    className={s.addFallbackBtn}
                    onClick={() =>
                      setActiveDropdownSlot(activeDropdownSlot === item.slot ? null : item.slot)
                    }
                  >
                    + Fallback
                  </button>

                  {activeDropdownSlot === item.slot && (
                    <div className={s.modelDropdown}>
                      {availableModels
                        .filter((m) => !item.hops.includes(m.fullId))
                        .map((m) => (
                          <div
                            key={m.fullId}
                            className={s.modelDropdownItem}
                            onClick={() => addHop(item.slot, m.fullId)}
                          >
                            <span>{m.label}</span>
                            <span style={{ color: "var(--dim)", fontSize: "11px" }}>{m.provider}</span>
                          </div>
                        ))}
                      {availableModels.filter((m) => !item.hops.includes(m.fullId)).length === 0 && (
                        <div style={{ padding: "8px", color: "var(--dim)", fontSize: "12px" }}>
                          All models already added
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className={s.legend}>
          <div className={s.legendItem}>
            <span className={`${s.hopDot} ${s.hopDotPrimary}`} />
            <span>Primary model</span>
          </div>
          <div className={s.legendItem}>
            <span className={`${s.hopDot} ${s.hopDotFallback}`} />
            <span>Fallback hop</span>
          </div>
        </div>
      </section>

      {/* Options Section */}
      <section className={s.section}>
        <h2 className={s.sectionTitle}>Options</h2>
        <p className={s.sectionDesc}>Context and conversation behavior</p>

        <div className={s.optionsGrid}>
          <label className={s.optionCard}>
            <input
              type="checkbox"
              className={s.checkbox}
              checked={keepConversation}
              onChange={(e) => setKeepConversation(e.target.checked)}
            />
            <div className={s.optionInfo}>
              <span className={s.optionLabel}>Keep conversation when switching model</span>
              <span className={s.optionDesc}>Retain message context on failover</span>
            </div>
          </label>

          <label className={s.optionCard}>
            <input
              type="checkbox"
              className={s.checkbox}
              checked={enable1MContext}
              onChange={(e) => setEnable1MContext(e.target.checked)}
            />
            <div className={s.optionInfo}>
              <span className={s.optionLabel}>1M context</span>
              <span className={s.optionDesc}>Enable extended context window</span>
            </div>
          </label>

          <label className={s.optionCard}>
            <input
              type="checkbox"
              className={s.checkbox}
              checked={filterNaming}
              onChange={(e) => setFilterNaming(e.target.checked)}
            />
            <div className={s.optionInfo}>
              <span className={s.optionLabel}>Filter naming requests</span>
              <span className={s.optionDesc}>Bypass background session naming calls</span>
            </div>
          </label>

          <label className={s.optionCard}>
            <input
              type="checkbox"
              className={s.checkbox}
              checked={webSearch}
              onChange={(e) => setWebSearch(e.target.checked)}
            />
            <div className={s.optionInfo}>
              <span className={s.optionLabel}>Web search</span>
              <span className={s.optionDesc}>Allow CLI to run web search queries</span>
            </div>
          </label>
        </div>
      </section>
    </div>
  );
}
