// Editor preferences: the defaults, the vocabularies the settings panel
// offers, and the localStorage round-trip. Shared because App reads the
// resolved values while SettingsPanel renders the choices.

export const DEFAULT_EDITOR_SETTINGS = {
  themeMode: "dark",
  canvasTone: "midnight",
  gridDensity: "standard",
  showGrid: true,
  showMinimap: true,
  compactPalette: false,
  animations: true,
  nodeGlow: true,
};

export const THEME_MODES = {
  dark: { label: "Dark", icon: "◐" },
  light: { label: "Light", icon: "☀" },
  system: { label: "System", icon: "◒" },
};

export const CANVAS_TONES = {
  midnight: { label: "Midnight", background: "#111418", dot: "rgba(161,174,187,0.28)", line: "rgba(255,255,255,0.025)" },
  graphite: { label: "Graphite", background: "#17191c", dot: "rgba(164,176,184,0.22)", line: "rgba(255,255,255,0.035)" },
  deep: { label: "Deep Blue", background: "#0d1320", dot: "rgba(96,165,250,0.24)", line: "rgba(96,165,250,0.035)" },
};

export const LIGHT_CANVAS_TONES = {
  midnight: { label: "Frost", background: "#eef3f6", dot: "rgba(69,88,98,0.32)", line: "rgba(41,56,64,0.06)" },
  graphite: { label: "Mist", background: "#f6f7f8", dot: "rgba(76,91,101,0.24)", line: "rgba(38,48,56,0.055)" },
  deep: { label: "Sky", background: "#edf6fb", dot: "rgba(37,99,155,0.26)", line: "rgba(37,99,155,0.055)" },
};

export const GRID_DENSITIES = {
  fine: { label: "Fine", dot: 36, line: 18 },
  standard: { label: "Standard", dot: 48, line: 24 },
  wide: { label: "Wide", dot: 64, line: 32 },
};

export function getSystemTheme() {
  if (typeof window === "undefined" || !window.matchMedia) return "dark";
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

export function readEditorSettings() {
  if (typeof window === "undefined") return DEFAULT_EDITOR_SETTINGS;
  try {
    const saved = window.localStorage.getItem("corelyn_editor_settings");
    return saved ? { ...DEFAULT_EDITOR_SETTINGS, ...JSON.parse(saved) } : DEFAULT_EDITOR_SETTINGS;
  } catch {
    return DEFAULT_EDITOR_SETTINGS;
  }
}
