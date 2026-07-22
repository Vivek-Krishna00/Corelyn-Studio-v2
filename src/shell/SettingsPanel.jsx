// The editor settings overlay, plus the two controls only it uses.
import { useState } from "react";
import { CANVAS_TONES, GRID_DENSITIES, LIGHT_CANVAS_TONES, THEME_MODES } from "./editorSettings";

function ThemeModeSelector({ value, resolvedTheme, onChange, compact = false }) {
  return (
    <div className={`theme-mode-selector ${compact ? "theme-mode-selector-compact" : ""}`} role="group" aria-label="Theme mode">
      {Object.entries(THEME_MODES).map(([key, mode]) => (
        <button
          key={key}
          className={value === key ? "theme-mode-active" : ""}
          type="button"
          title={`${mode.label}${key === "system" ? ` (${resolvedTheme})` : ""}`}
          aria-pressed={value === key}
          onClick={() => onChange(key)}
        >
          <span aria-hidden="true">{mode.icon}</span>
          {!compact && <span>{mode.label}</span>}
        </button>
      ))}
    </div>
  );
}

export default function SettingsPanel({ settings, resolvedTheme, onChange, onClose, onReset, onSave, onSignOut }) {
  const [activeSection, setActiveSection] = useState("appearance");

  return (
    <div className="settings-backdrop" role="dialog" aria-modal="true" aria-labelledby="editor-settings-title" onMouseDown={onClose}>
      <div className="settings-panel" onMouseDown={event => event.stopPropagation()}>
        <aside className="settings-nav">
          <div className="settings-nav-title">Settings</div>
          <button className={`settings-nav-item ${activeSection === "appearance" ? "settings-nav-item-active" : ""}`} type="button" onClick={() => setActiveSection("appearance")}>appearance</button>
          <button className={`settings-nav-item ${activeSection === "workspace" ? "settings-nav-item-active" : ""}`} type="button" onClick={() => setActiveSection("workspace")}>workspace</button>
          <button className="settings-nav-item" type="button" onClick={onSignOut}>sign out</button>
        </aside>

        <section className="settings-content">
          <div className="settings-heading-row">
            <div>
              <div className="settings-eyebrow">User Settings</div>
              <h2 id="editor-settings-title">Settings</h2>
              <p>Editor theme and workspace preferences</p>
            </div>
            <button className="settings-back-button" type="button" onClick={onClose}>← Back</button>
          </div>

          {activeSection === "appearance" ? (
            <>
              <div className="settings-card">
                <div className="settings-card-title">Theme mode</div>
                <p className="settings-card-description">
                  Choose the interface theme for the editor shell. System follows your device preference while keeping the workarea grid and canvas tone visible.
                </p>
                <ThemeModeSelector
                  value={settings.themeMode}
                  resolvedTheme={resolvedTheme}
                  onChange={value => onChange("themeMode", value)}
                />
              </div>

              <div className="settings-card">
                <div className="settings-card-title">Canvas tone</div>
                <div className="settings-segmented">
                  {Object.entries(resolvedTheme === "light" ? LIGHT_CANVAS_TONES : CANVAS_TONES).map(([key, tone]) => (
                    <button
                      key={key}
                      className={settings.canvasTone === key ? "settings-segment-active" : ""}
                      type="button"
                      onClick={() => onChange("canvasTone", key)}
                    >
                      {tone.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="settings-card">
                <div className="settings-card-title">Grid density</div>
                <div className="settings-segmented">
                  {Object.entries(GRID_DENSITIES).map(([key, density]) => (
                    <button
                      key={key}
                      className={settings.gridDensity === key ? "settings-segment-active" : ""}
                      type="button"
                      onClick={() => onChange("gridDensity", key)}
                    >
                      {density.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="settings-card">
                <div className="settings-card-title">Display</div>
                <SettingToggle label="show grid" checked={settings.showGrid} onChange={value => onChange("showGrid", value)} />
                <SettingToggle label="minimap" checked={settings.showMinimap} onChange={value => onChange("showMinimap", value)} />
              </div>
            </>
          ) : (
            <div className="settings-card">
              <div className="settings-card-title">Workspace</div>
              <SettingToggle label="compact block sidebar" checked={settings.compactPalette} onChange={value => onChange("compactPalette", value)} />
              <SettingToggle label="sidebar and node animations" checked={settings.animations} onChange={value => onChange("animations", value)} />
              <SettingToggle label="node glow" checked={settings.nodeGlow} onChange={value => onChange("nodeGlow", value)} />
            </div>
          )}

          <div className="settings-actions">
            <button className="settings-reset-button" type="button" onClick={onReset}>Reset defaults</button>
            <button className="settings-save-button" type="button" onClick={onSave}>▣ Save preferences</button>
          </div>
        </section>
      </div>
    </div>
  );
}

function SettingToggle({ label, checked, onChange }) {
  return (
    <label className="settings-toggle-row">
      <span>{label}</span>
      <input type="checkbox" checked={checked} onChange={event => onChange(event.target.checked)} />
      <span className="settings-toggle" aria-hidden="true" />
    </label>
  );
}
