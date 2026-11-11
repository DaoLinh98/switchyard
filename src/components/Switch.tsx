"use client";

/** Pill switch from the design: accent track when on, dark knob. */
export function Switch({ checked, onChange, label, size = "md", disabled }: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  size?: "md" | "sm";
  disabled?: boolean;
}) {
  const w = size === "md" ? 44 : 40, h = size === "md" ? 26 : 24, k = size === "md" ? 20 : 18;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      style={{
        width: w, height: h, borderRadius: h / 2, border: 0, padding: 3, cursor: disabled ? "default" : "pointer", display: "flex",
        flexShrink: 0, background: checked ? "var(--accent)" : "var(--line-2)", justifyContent: checked ? "flex-end" : "flex-start",
      }}
    >
      <span style={{ width: k, height: k, borderRadius: "50%", background: "var(--bg)" }} />
    </button>
  );
}
