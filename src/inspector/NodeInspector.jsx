// The NODE tab of the right panel. Every field is rendered from the node's
// declared params in shared/nodes.json rather than hardcoded per type, so a
// new node type needs no change here.

function ParamField({ name, spec, value, onChange }) {
  const current = String(value ?? spec.default);

  if (spec.type === "select") {
    return (
      <select value={current} onChange={e => onChange(name, e.target.value)}
        style={{ width: "100%", padding: "6px 8px", background: "var(--input-bg)", border: "1px solid var(--border)", borderRadius: 6, color: "var(--text-main)", fontSize: 14, fontFamily: "'Inter', sans-serif", outline: "none" }}>
        {spec.options?.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  }

  if (spec.type === "boolean") {
    return (
      <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
        <input type="checkbox" checked={Boolean(value ?? spec.default)} onChange={e => onChange(name, e.target.checked)} style={{ accentColor: "#3b82f6" }} />
        <span style={{ fontSize: 14, color: "var(--text-muted)" }}>Enabled</span>
      </label>
    );
  }

  if (spec.type === "number" || spec.type === "text") {
    return (
      <input type={spec.type === "number" ? "number" : "text"} value={current}
        onChange={e => onChange(name, spec.type === "number" ? parseFloat(e.target.value) || 0 : e.target.value)} step="0.1"
        style={{ width: "100%", padding: "6px 8px", background: "var(--input-bg)", border: "1px solid var(--border)", borderRadius: 6, color: "var(--text-main)", fontSize: 14, fontFamily: "'Inter', sans-serif", outline: "none", boxSizing: "border-box" }} />
    );
  }

  // A type this build does not know how to edit. Show the value rather than
  // hiding the field, and refuse the edit rather than writing back something
  // of the wrong shape — the daemon's validator (backend/internal/nodes) lets
  // unrecognised declared types through, so a bad write would reach the robot.
  return (
    <div title={`Unsupported param type "${spec.type}" — read-only`}
      style={{ width: "100%", padding: "6px 8px", background: "var(--input-bg)", border: "1px dashed var(--border)", borderRadius: 6, color: "var(--text-muted)", fontSize: 14, fontFamily: "'Inter', sans-serif", boxSizing: "border-box" }}>
      {current}
    </div>
  );
}

export default function NodeInspector({ node, def, onParamChange, onDelete }) {
  return (
    <div>
      {!node ? (
        <div style={{ textAlign: "center", padding: "30px 10px", color: "var(--text-muted)" }}>
          <div style={{ fontSize: 28, marginBottom: 8, opacity: 0.4 }}>⊙</div>
          <div style={{ fontSize: 14, lineHeight: 1.6 }}>Select a node on the canvas to edit its properties</div>
        </div>
      ) : def && (
        <>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "3px 10px", borderRadius: 20, background: `${def.color}10`, border: `1px solid ${def.color}20`, fontSize: 14, color: def.color, fontWeight: 700, marginBottom: 12 }}>
            {def.icon} {def.label}
          </div>
          {def.params && Object.keys(def.params).length > 0 ? (
            Object.entries(def.params).map(([k, spec]) => (
              <div key={k} style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 14, letterSpacing: "0.08em", color: "var(--text-soft)", textTransform: "uppercase", display: "block", marginBottom: 5, fontWeight: 700 }}>{spec.label}</label>
                <ParamField name={k} spec={spec} value={node.params[k]} onChange={onParamChange} />
              </div>
            ))
          ) : <div style={{ fontSize: 14, color: "var(--text-muted)", padding: "6px 0" }}>No configurable parameters</div>}

          <div style={{ height: 1, background: "var(--border)", margin: "10px 0" }} />
          <div style={{ marginBottom: 8 }}>
            <label style={{ fontSize: 14, letterSpacing: "0.08em", color: "var(--text-soft)", display: "block", marginBottom: 5, fontWeight: 700 }}>ROS TOPIC</label>
            <div style={{ padding: "5px 8px", background: "var(--input-bg)", border: "1px solid var(--border)", borderRadius: 5, fontSize: 14, color: "#0891b2" }}>/robot/{def.type}</div>
          </div>
          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 14, letterSpacing: "0.08em", color: "var(--text-soft)", display: "block", marginBottom: 5, fontWeight: 700 }}>NODE ID</label>
            <div className="inspector-node-id" style={{ padding: "5px 8px", background: "var(--input-bg)", border: "1px solid var(--border)", borderRadius: 5, fontSize: 14, color: "var(--text-muted)" }}>{node.id}</div>
          </div>
          <button onClick={onDelete}
            style={{ width: "100%", padding: "8px", background: "rgba(220,38,38,0.08)", border: "1px solid rgba(220,38,38,0.25)", borderRadius: 6, color: "#dc2626", cursor: "pointer", fontSize: 14, fontFamily: "'Inter', sans-serif", fontWeight: 600, letterSpacing: "0.03em", transition: "all 0.2s cubic-bezier(0.4, 0, 0.2, 1)" }}
            onMouseEnter={e => { e.currentTarget.style.background = "#dc2626"; e.currentTarget.style.color = "white"; }}
            onMouseLeave={e => { e.currentTarget.style.background = "rgba(220,38,38,0.08)"; e.currentTarget.style.color = "#dc2626"; }}>
            ⊠ Delete Node
          </button>
        </>
      )}
    </div>
  );
}
