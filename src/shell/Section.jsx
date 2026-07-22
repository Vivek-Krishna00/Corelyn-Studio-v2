// A labelled group of controls in the right panel.

export default function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 14, letterSpacing: "0.08em", color: "var(--text-soft)", fontWeight: 700, marginBottom: 8, textTransform: "uppercase" }}>{title}</div>
      {children}
    </div>
  );
}
