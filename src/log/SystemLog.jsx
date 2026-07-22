// The LOG tab of the right panel: a reverse-chronological feed of everything
// the editor and the robot have reported this session.

const TYPE_COLORS = {
  success: "#10b981",
  error: "#dc2626",
  warn: "#d97706",
  info: "#3b82f6",
};

export default function SystemLog({ logs, onClear }) {
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <span style={{ fontSize: 14, letterSpacing: "0.08em", color: "var(--text-soft)", fontWeight: 700 }}>SYSTEM LOG</span>
        <button onClick={onClear} style={{ padding: "2px 7px", background: "transparent", border: "1px solid var(--border)", borderRadius: 4, color: "var(--text-soft)", cursor: "pointer", fontSize: 14, fontFamily: "'Inter', sans-serif" }}>CLEAR</button>
      </div>
      {logs.map((l, i) => (
        <div key={i} style={{ display: "flex", gap: 7, padding: "4px 0", borderBottom: "1px solid var(--border-soft)" }}>
          <span className="log-time" style={{ fontSize: 14, color: "var(--text-faint)", flexShrink: 0 }}>{l.time}</span>
          <span style={{ fontSize: 14, color: TYPE_COLORS[l.type] || "var(--text-muted)", lineHeight: 1.5 }}>{l.msg}</span>
        </div>
      ))}
    </div>
  );
}
