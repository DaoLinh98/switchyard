"use client";

import { useState } from "react";
import type { CliSlotMapping, AvailableModelOption } from "@/lib/server/cli-tools";
import { saveSlotAction, applySettingsAction } from "./actions";
import s from "./cli-tools.module.css";

export function CliToolsView({
  slots,
  availableModels,
  settingsPath,
}: {
  slots: CliSlotMapping[];
  availableModels: AvailableModelOption[];
  settingsPath: string;
}) {
  const [slotStates, setSlotStates] = useState(
    slots.map((s) => ({
      slot: s.slot,
      label: s.label,
      hops: s.hops.map((h) => h.model),
    }))
  );

  const [toast, setToast] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [savingSlot, setSavingSlot] = useState<string | null>(null);

  const updateHop = (slotKey: string, index: number, value: string) => {
    setSlotStates((prev) =>
      prev.map((item) => {
        if (item.slot !== slotKey) return item;
        const nextHops = [...item.hops];
        nextHops[index] = value;
        return { ...item, hops: nextHops };
      })
    );
  };

  const addHop = (slotKey: string) => {
    const defaultModel = availableModels[0]?.fullId || "ag/gemini-3.8-flash-tiered";
    setSlotStates((prev) =>
      prev.map((item) => {
        if (item.slot !== slotKey) return item;
        return { ...item, hops: [...item.hops, defaultModel] };
      })
    );
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

  const handleSaveSlot = async (slotKey: string) => {
    setSavingSlot(slotKey);
    const item = slotStates.find((s) => s.slot === slotKey);
    if (item) {
      await saveSlotAction(item.slot, item.hops);
      setToast(`Saved slot ${item.label} fallback chain.`);
      setTimeout(() => setToast(null), 3000);
    }
    setSavingSlot(null);
  };

  const handleApply = async () => {
    setApplying(true);
    try {
      // First save all slots
      for (const item of slotStates) {
        await saveSlotAction(item.slot, item.hops);
      }
      const res = await applySettingsAction();
      if (res.success) {
        setToast(`Successfully updated ~/.claude/settings.json! Switchyard is now active.`);
      }
    } catch (e: any) {
      alert("Failed to apply settings: " + (e?.message || String(e)));
    } finally {
      setApplying(false);
    }
  };

  return (
    <>
      <header className={s.header}>
        <div className={s.intro}>
          <span className="eyebrow">Integration</span>
          <h1 className="page-title">CLI Tools Mapping</h1>
          <p className="lede">
            Configure model mapping chains for Claude CLI slots (Fable, Opus, Sonnet, Haiku).
            Click <strong>Apply to Claude CLI</strong> to write directly to your <code>{settingsPath}</code>,
            redirecting all Claude CLI traffic through Switchyard without 9router.
          </p>
        </div>
        <div className={s.actions}>
          <button className={s.applyBtn} onClick={handleApply} disabled={applying}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M20 6L9 17l-5-5" />
            </svg>
            {applying ? "Applying..." : "Apply to Claude CLI"}
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

      <div className={s.grid}>
        {slotStates.map((slotItem) => (
          <div key={slotItem.slot} className={s.slotCard}>
            <div className={s.slotHead}>
              <div className={s.slotTitle}>
                {slotItem.label}
                <span className={s.slotTag}>Slot: {slotItem.slot}</span>
              </div>
              <button
                className={s.saveSlotBtn}
                onClick={() => handleSaveSlot(slotItem.slot)}
                disabled={savingSlot === slotItem.slot}
              >
                {savingSlot === slotItem.slot ? "Saving..." : "Save Chain"}
              </button>
            </div>

            <div className={s.chainList}>
              {slotItem.hops.map((hopModel, idx) => (
                <div key={idx} className={s.hopRow}>
                  <span className={s.hopNumber}>#{idx + 1}</span>
                  <select
                    className={s.modelSelect}
                    value={hopModel}
                    onChange={(e) => updateHop(slotItem.slot, idx, e.target.value)}
                  >
                    {availableModels.map((m) => (
                      <option key={m.fullId} value={m.fullId}>
                        {m.label} ({m.fullId})
                      </option>
                    ))}
                    {!availableModels.some((m) => m.fullId === hopModel) && (
                      <option value={hopModel}>{hopModel} (Custom)</option>
                    )}
                  </select>
                  {slotItem.hops.length > 1 && (
                    <button
                      className={s.removeHopBtn}
                      onClick={() => removeHop(slotItem.slot, idx)}
                      title="Remove hop"
                    >
                      &times;
                    </button>
                  )}
                </div>
              ))}
            </div>

            <button className={s.addHopBtn} onClick={() => addHop(slotItem.slot)}>
              + Add Fallback Hop
            </button>
          </div>
        ))}
      </div>
    </>
  );
}
