import { useState, useMemo } from "react";

const modalBackdrop = {
  position: "fixed", inset: 0, zIndex: 500,
  background: "rgba(0,0,0,0.35)",
  display: "flex", alignItems: "center", justifyContent: "center",
  fontFamily: "'Inter', -apple-system, sans-serif",
};

const modalCard = {
  background: "#1e1e1e", borderRadius: 14, width: 720, maxWidth: "90vw",
  maxHeight: "85vh", display: "flex", flexDirection: "column",
  boxShadow: "0 16px 48px rgba(0,0,0,0.18)",
  overflow: "hidden",
};

export default function DeployModal({ mission, apiOnline, robotConnected, onClose, onDeploy, onLog }) {
  const [tab, setTab] = useState("preview");
  const [copied, setCopied] = useState(false);
  const [deploying, setDeploying] = useState(false);
  const [deployResult, setDeployResult] = useState(null);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(mission, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (_) {}
  };

  const handleDownload = () => {
    const blob = new Blob([JSON.stringify(mission, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${mission.mission_id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDeploy = async () => {
    setDeploying(true);
    setDeployResult(null);
    try {
      const res = await onDeploy(mission);
      if (res?.status === "deployed_no_robot") {
        const msg = "Deployed, but no robot is connected — the mission will not run.";
        setDeployResult({ warn: true, msg });
        onLog?.("Deploy accepted but no robot is connected — mission will not run.", "warn");
      } else {
        setDeployResult({ ok: true, msg: "Mission deployed successfully" });
      }
    } catch (err) {
      setDeployResult({ ok: false, msg: err.message || "Deploy failed" });
    } finally {
      setDeploying(false);
    }
  };

  return (
    <div style={modalBackdrop} onClick={onClose}>
      <div style={modalCard} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "18px 22px", borderBottom: "1px solid #2c2c2c" }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#f5f5f5" }}>Deploy Mission</div>
            <div style={{ fontSize: 11, color: "#A0B4BE", marginTop: 2 }}>{mission.mission_id} · {mission.nodes.length} nodes · {mission.connections.length} connections</div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#7A929C", cursor: "pointer", fontSize: 20, padding: "4px 8px", borderRadius: 6 }}
            onMouseEnter={e => { e.currentTarget.style.background = "#262626"; e.currentTarget.style.color = "#f2f2f2"; }}
            onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "#7A929C"; }}>✕</button>
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", borderBottom: "1px solid #2c2c2c", padding: "0 22px" }}>
          {[
            ["preview", "JSON Preview"],
            ["summary", "Execution Summary"],
          ].map(([id, label]) => (
            <button key={id} onClick={() => setTab(id)}
              style={{ padding: "10px 14px", fontSize: 11, fontWeight: 600, letterSpacing: "0.03em", fontFamily: "'Inter', sans-serif", border: "none", background: "transparent", cursor: "pointer", color: tab === id ? "#3b82f6" : "#7A929C", borderBottom: `2px solid ${tab === id ? "#3b82f6" : "transparent"}`, transition: "all 0.15s" }}>
              {label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflow: "auto", padding: 22 }}>
          {tab === "preview" ? (
            <pre style={{ fontSize: 11, color: "#f2f2f2", background: "#1a1a1a", border: "1px solid #2c2c2c", borderRadius: 8, padding: 16, maxHeight: 360, overflow: "auto", whiteSpace: "pre", fontFamily: "'SF Mono', 'Fira Code', 'Consolas', monospace", lineHeight: 1.5 }}>
              {JSON.stringify(mission, null, 2)}
            </pre>
          ) : (
            <div>
              <SummaryRow label="Mission ID" value={mission.mission_id} />
              <SummaryRow label="Spec Version" value={mission.spec_version} />
              <SummaryRow label="Created" value={new Date(mission.created_at).toLocaleString()} />
              <SummaryRow label="Total Nodes" value={String(mission.nodes.length)} />
              <SummaryRow label="Total Connections" value={String(mission.connections.length)} />
              <SummaryRow label="Execution Order" value={mission.topological_order.map((id, i) => {
                const n = mission.nodes.find(x => x.id === id);
                return `${i + 1}. ${n?.label || id}`;
              }).join("  │  ")} />
              <SummaryRow label="Required Capabilities" value={mission.robot_requirements.required_capabilities.join(", ")} />
              <div style={{ marginTop: 14 }}>
                <div style={{ fontSize: 10, color: "#A0B4BE", fontWeight: 700, letterSpacing: "0.06em", marginBottom: 8 }}>NODES</div>
                {mission.nodes.map(n => (
                  <div key={n.id} style={{ display: "flex", justifyContent: "space-between", padding: "6px 10px", background: "#1a1a1a", borderRadius: 6, marginBottom: 4, fontSize: 11, color: "#8BA2AC" }}>
                    <span>{n.label}</span>
                    <span style={{ color: "#7A929C" }}>{n.type} · ({n.position.x}, {n.position.y})</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Deploy result */}
          {deployResult && (
            <div style={{ marginTop: 12, padding: "10px 14px", borderRadius: 8, fontSize: 11, fontWeight: 600, background: deployResult.warn ? "rgba(217,119,6,0.08)" : deployResult.ok ? "rgba(16,185,129,0.08)" : "rgba(220,38,38,0.08)", border: `1px solid ${deployResult.warn ? "rgba(217,119,6,0.2)" : deployResult.ok ? "rgba(16,185,129,0.2)" : "rgba(220,38,38,0.2)"}`, color: deployResult.warn ? "#d97706" : deployResult.ok ? "#10b981" : "#dc2626" }}>
              {deployResult.warn ? "⚠ " : deployResult.ok ? "✓ " : "✗ "}{deployResult.msg}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 22px", borderTop: "1px solid #2c2c2c", background: "#1a1a1a" }}>
          <div style={{ display: "flex", gap: 6 }}>
            <button onClick={handleCopy}
              style={{ padding: "7px 14px", background: "#1e1e1e", border: "1px solid #2c2c2c", borderRadius: 7, color: "#8BA2AC", cursor: "pointer", fontSize: 11, fontFamily: "'Inter', sans-serif", fontWeight: 600, transition: "all 0.15s" }}
              onMouseEnter={e => { e.currentTarget.style.background = "#262626"; }}
              onMouseLeave={e => { e.currentTarget.style.background = "#1e1e1e"; }}>
              {copied ? "✓ Copied" : "Copy JSON"}
            </button>
            <button onClick={handleDownload}
              style={{ padding: "7px 14px", background: "#1e1e1e", border: "1px solid #2c2c2c", borderRadius: 7, color: "#8BA2AC", cursor: "pointer", fontSize: 11, fontFamily: "'Inter', sans-serif", fontWeight: 600, transition: "all 0.15s" }}
              onMouseEnter={e => { e.currentTarget.style.background = "#262626"; }}
              onMouseLeave={e => { e.currentTarget.style.background = "#1e1e1e"; }}>
              Download
            </button>
          </div>
          <button onClick={handleDeploy}
            disabled={!apiOnline || deploying}
            style={{ padding: "8px 20px", background: apiOnline && !deploying ? "#2563eb" : "#3a3a3a", border: "none", borderRadius: 8, color: "#1e1e1e", cursor: apiOnline && !deploying ? "pointer" : "not-allowed", fontSize: 12, fontFamily: "'Inter', sans-serif", fontWeight: 700, transition: "all 0.15s" }}
            onMouseEnter={e => { if (apiOnline && !deploying) e.currentTarget.style.background = "#1d4ed8"; }}
            onMouseLeave={e => { if (apiOnline && !deploying) e.currentTarget.style.background = "#2563eb"; }}>
            {deploying ? "Deploying..." : robotConnected ? "Deploy via ROS" : "Deploy (no robot)"}
          </button>
        </div>
      </div>
    </div>
  );
}

function SummaryRow({ label, value }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 10, padding: "5px 0", borderBottom: "1px solid #262626" }}>
      <span style={{ fontSize: 10, color: "#A0B4BE", fontWeight: 700, letterSpacing: "0.06em", minWidth: 130, flexShrink: 0 }}>{label.toUpperCase()}</span>
      <span style={{ fontSize: 11, color: "#f2f2f2" }}>{value}</span>
    </div>
  );
}
