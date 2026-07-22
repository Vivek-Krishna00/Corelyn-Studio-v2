// The CTL tab of the right panel: mission transport, manual jog, and the
// E-Stop. Every action is a prop — this component knows nothing about the
// daemon, the canvas, or the log.
import Section from "../shell/Section";

const JOG_DIRECTIONS = [["▲", "FWD"], ["▼", "REV"], ["◄", "LEFT"], ["►", "RIGHT"]];
const CALIBRATION_TARGETS = ["IMU", "LiDAR", "Encoders", "Load Cell"];

export default function MissionControl({ running, onRun, onStop, onReset, onStep, onEmergencyStop, onJog, onCalibrate }) {
  const transport = [
    ["▶", "Run", "#10b981", onRun, running],
    ["⏸", "Pause", "#d97706", onStop, !running],
    ["↺", "Reset", "var(--text-soft)", onReset, false],
    ["⇥", "Step", "#0891b2", onStep, false],
  ];

  return (
    <div>
      <Section title="Mission Control">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 8 }}>
          {transport.map(([icon, label, color, fn, dis]) => (
            <button key={label} onClick={fn} disabled={dis} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, padding: "10px 6px", borderRadius: 7, border: "1px solid var(--border)", background: "var(--panel-bg)", cursor: dis ? "not-allowed" : "pointer", opacity: dis ? 0.4 : 1, transition: "all 0.2s cubic-bezier(0.4, 0, 0.2, 1)", fontFamily: "'Inter', sans-serif" }}
              onMouseEnter={e => { if (!dis) e.currentTarget.style.borderColor = color; e.currentTarget.style.boxShadow = "0 1px 3px rgba(0,0,0,0.06)"; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.boxShadow = "none"; }}>
              <span style={{ fontSize: 18, color }}>{icon}</span>
              <span style={{ fontSize: 14, color: "var(--text-soft)", letterSpacing: "0.06em" }}>{label.toUpperCase()}</span>
            </button>
          ))}
        </div>
        <button onClick={onEmergencyStop}
          style={{ width: "100%", padding: 12, borderRadius: 7, border: "2px solid #dc2626", background: "rgba(220,38,38,0.06)", color: "#dc2626", fontFamily: "'Inter', sans-serif", fontWeight: 800, fontSize: 14, letterSpacing: "0.1em", cursor: "pointer", transition: "all 0.2s cubic-bezier(0.4, 0, 0.2, 1)" }}
          onMouseEnter={e => { e.currentTarget.style.background = "#dc2626"; e.currentTarget.style.color = "white"; }}
          onMouseLeave={e => { e.currentTarget.style.background = "rgba(220,38,38,0.06)"; e.currentTarget.style.color = "#dc2626"; }}>
          ⊗ EMERGENCY STOP
        </button>
      </Section>

      <Section title="Manual Jog">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
          {JOG_DIRECTIONS.map(([icon, label]) => (
            <button key={label} onMouseDown={() => onJog(label)}
              style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, padding: "10px", borderRadius: 7, border: "1px solid var(--border)", background: "var(--panel-bg)", cursor: "pointer", fontFamily: "'Inter', sans-serif", transition: "all 0.2s cubic-bezier(0.4, 0, 0.2, 1)" }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = "#3b82f6"; e.currentTarget.style.background = "var(--button-hover)"; e.currentTarget.style.boxShadow = "0 1px 3px rgba(0,0,0,0.06)"; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.background = "var(--panel-bg)"; e.currentTarget.style.boxShadow = "none"; }}>
              <span style={{ fontSize: 14, color: "#3b82f6" }}>{icon}</span>
              <span style={{ fontSize: 14, color: "var(--text-soft)", letterSpacing: "0.06em" }}>{label}</span>
            </button>
          ))}
        </div>
      </Section>

      <Section title="Calibration">
        {CALIBRATION_TARGETS.map(s => (
          <button key={s} onClick={() => onCalibrate(s)}
            style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--panel-bg)", cursor: "pointer", marginBottom: 5, fontFamily: "'Inter', sans-serif", transition: "all 0.2s cubic-bezier(0.4, 0, 0.2, 1)" }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = "#0891b2"; e.currentTarget.style.boxShadow = "0 1px 3px rgba(0,0,0,0.06)"; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.boxShadow = "none"; }}>
            <span style={{ fontSize: 14, color: "var(--text-muted)" }}>{s}</span>
            <span style={{ fontSize: 14, color: "#0891b2", fontWeight: 700 }}>CALIBRATE →</span>
          </button>
        ))}
      </Section>
    </div>
  );
}
