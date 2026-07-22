// One node on the canvas: header, its declared params inline, and a status
// bar. Placement and interaction come in as props — this draws, it does not
// decide.
import { NODE_W } from "./geometry";

function statusBorder({ isSource, isSelected, status, color }) {
  if (isSource) return "2px solid #3b82f6";
  if (status === "running") return "2px solid #10b981";
  if (status === "done") return `1px solid ${color}55`;
  if (status === "error") return "2px solid #dc2626";
  if (isSelected) return "2px solid #3b82f6";
  return "1px solid var(--border)";
}

function shadow({ glow, isSelected, status }) {
  if (!glow) return "var(--node-shadow-soft)";
  if (isSelected) return "var(--node-selected-shadow)";
  if (status === "running") return "var(--node-running-shadow)";
  return "var(--node-shadow)";
}

export default function NodeCard({
  node, def, isSelected, isSource, isPickingTarget, glow,
  onMouseDown, onDoubleClick, onHoverChange, onDelete,
}) {
  // Hover only repaints the border when the node has no stronger state of its
  // own to show — a running or selected node keeps its own colour.
  const bordersFollowHover = !isSelected && node.status !== "running";

  return (
    <div
      className="node-touch-target"
      data-node-id={node.id}
      data-node-type={node.type}
      data-status={node.status || "idle"}
      onMouseDown={onMouseDown}
      onDoubleClick={onDoubleClick}
      style={{
        position: "absolute", left: node.x, top: node.y, width: NODE_W, height: "auto",
        background: isSelected ? "var(--node-bg-selected)" : "var(--node-bg)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        border: statusBorder({ isSource, isSelected, status: node.status, color: def.color }),
        borderRadius: 14,
        boxShadow: shadow({ glow, isSelected, status: node.status }),
        cursor: isPickingTarget && !isSource ? "pointer" : "grab",
        userSelect: "none",
        overflow: "visible",
        transition: "border-color 0.14s ease, box-shadow 0.14s ease",
        fontFamily: "'Inter', system-ui, sans-serif",
      }}
      onMouseEnter={e => { if (bordersFollowHover) e.currentTarget.style.borderColor = "var(--border-strong)"; onHoverChange(node.id); }}
      onMouseLeave={e => { if (bordersFollowHover) e.currentTarget.style.borderColor = "var(--border)"; onHoverChange(null); }}
    >
      {/* ── Header: emoji + label + status badge + delete ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 14px 10px", borderBottom: "1px solid var(--border-soft)" }}>
        <div style={{ width: 26, height: 26, borderRadius: 6, background: `${def.color}15`, border: `1px solid ${def.color}25`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, flexShrink: 0 }}>
          {def.icon}
        </div>
        <span style={{ fontSize: 14, fontWeight: 600, color: "var(--text-main)", flex: 1, lineHeight: 1.3 }}>{def.label}</span>
        {node.status === "running" && <span style={{ fontSize: 14, padding: "1px 5px", background: "#10b98112", color: "#10b981", borderRadius: 3, border: "1px solid #10b98130", fontWeight: 700, flexShrink: 0 }}>RUN</span>}
        {node.status === "done" && <span style={{ fontSize: 14, padding: "1px 5px", background: "#3b82f615", color: "#3b82f6", borderRadius: 3, border: "1px solid #3b82f630", fontWeight: 700, flexShrink: 0 }}>✓</span>}
        <button
          className="node-del"
          title="Delete node"
          onClick={e => { e.stopPropagation(); onDelete(); }}
          style={{ width: 20, height: 20, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(220,38,38,0.08)", border: "1px solid rgba(220,38,38,0.25)", borderRadius: 4, color: "#dc2626", cursor: "pointer", fontSize: 14, lineHeight: 1, padding: 0, flexShrink: 0, transition: "all 0.2s cubic-bezier(0.4, 0, 0.2, 1)" }}
          onMouseEnter={e => { e.currentTarget.style.background = "#dc2626"; e.currentTarget.style.color = "var(--panel-bg)"; e.currentTarget.style.transform = "scale(1.15)"; }}
          onMouseLeave={e => { e.currentTarget.style.background = "rgba(220,38,38,0.08)"; e.currentTarget.style.color = "#dc2626"; e.currentTarget.style.transform = "scale(1)"; }}
        >×</button>
      </div>

      {/* ── Body: inline params ── */}
      <div style={{ padding: "10px 14px 8px" }}>
        {def.params && Object.entries(def.params).map(([k, spec]) => (
          <div key={k} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, padding: "2px 0", lineHeight: 1.6 }}>
            <span style={{ fontSize: 14, color: "var(--text-soft)", fontWeight: 500, flexShrink: 0 }}>{spec.label}</span>
            <span style={{ fontSize: 14, color: "var(--text-main)", fontWeight: 600, textAlign: "right", maxWidth: "55%", wordBreak: "break-word" }}>{String(node.params[k] ?? spec.default)}</span>
          </div>
        ))}
      </div>

      {/* ── Status progress bar ── */}
      <div style={{ height: 3, background: "rgba(0,0,0,0.04)", borderRadius: "0 0 9px 9px", overflow: "hidden" }}>
        <div style={{ height: "100%", width: node.status === "running" ? "70%" : node.status === "done" ? "100%" : "0%", background: node.status === "running" ? "#10b981" : node.status === "done" ? def.color : "transparent", transition: "width 0.5s ease" }} />
      </div>
    </div>
  );
}
