// A single control in the top command bar.

export default function TopBtn({ children, onClick, disabled, accent, title }) {
  const disabledColor = accent || "var(--text-soft)";
  const color = disabled ? disabledColor : accent || "var(--text-soft)";
  const disabledBackground = disabled && accent ? `${accent}16` : "transparent";
  return (
    <button onClick={onClick} disabled={disabled} title={title}
      style={{ padding: "5px 12px", borderRadius: 6, border: disabled && accent ? `1px solid ${accent}30` : "none", background: disabledBackground, color, cursor: disabled ? "not-allowed" : "pointer", fontSize: 14, fontFamily: "'Inter', sans-serif", fontWeight: 600, letterSpacing: "0.02em", whiteSpace: "nowrap", transition: "all 0.2s cubic-bezier(0.4, 0, 0.2, 1)", opacity: disabled ? 0.72 : 1 }}
      onMouseEnter={e => { if (!disabled) { e.currentTarget.style.background = "var(--button-hover)"; e.currentTarget.style.color = accent || "var(--text-main)"; } }}
      onMouseLeave={e => { e.currentTarget.style.background = disabledBackground; e.currentTarget.style.color = color; }}>
      {children}
    </button>
  );
}
