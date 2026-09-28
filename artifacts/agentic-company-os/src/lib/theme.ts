/**
 * Client-side theme engine.
 *
 * The product has one deliberate evidence-desk palette. Color mode remains a separate
 * preference so the same information architecture works in light and dark
 * environments without reintroducing competing brand palettes.
 */

export type ThemeId = "swiss";
export type ColorMode = "light" | "dark" | "system";

interface Palette {
  label: string;
  swatch: [string, string, string];
  props: Record<string, string>;
}

export const THEMES: Record<ThemeId, Palette> = {
  swiss: {
    label: "Evidence desk",
    swatch: ["#8EC1FF", "#17212D", "#202D3A"],
    props: {
      "--primary": "214 94% 76%",
      "--ring": "216 76% 42%",
      "--glow-accent": "214 94% 76%",
      "--glow-violet": "214 94% 76%",
      "--glow-cyan": "199 72% 66%",
      "--sidebar-primary": "214 94% 76%",
    },
  },
};

const STORAGE_KEY = "acos.theme";
const COLOR_MODE_KEY = "acos.color-mode.v2";

export function applyTheme(theme: ThemeId): void {
  const root = document.documentElement;
  // CSS owns both color modes. Clear legacy inline values which otherwise
  // override the light theme and break foreground/button contrast.
  for (const prop of Object.keys(THEMES.swiss.props)) {
    root.style.removeProperty(prop);
  }
  try {
    window.localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Theme switching remains available when storage is blocked or full.
  }
}

export function getSavedTheme(): ThemeId {
  let saved: ThemeId | null = null;
  try {
    saved = window.localStorage.getItem(STORAGE_KEY) as ThemeId | null;
  } catch {
    return "swiss";
  }
  if (saved && saved in THEMES) {
    return saved;
  }
  return "swiss";
}

export function getSavedColorMode(): ColorMode {
  try {
    const saved = window.localStorage.getItem(COLOR_MODE_KEY);
    if (saved === "light" || saved === "dark" || saved === "system") {
      return saved;
    }
  } catch {
    // Follow the operating system until the person makes an explicit choice.
  }
  return "system";
}

function resolveColorMode(mode: ColorMode): "light" | "dark" {
  if (mode !== "system") return mode;
  return window.matchMedia("(prefers-color-scheme: light)").matches
    ? "light"
    : "dark";
}

export function applyColorMode(mode: ColorMode): void {
  const resolved = resolveColorMode(mode);
  const root = document.documentElement;
  root.classList.toggle("light", resolved === "light");
  root.classList.toggle("dark", resolved === "dark");
  root.dataset.colorMode = mode;
  root.style.colorScheme = resolved;
  try {
    window.localStorage.setItem(COLOR_MODE_KEY, mode);
  } catch {
    // The preference remains active for this tab when storage is unavailable.
  }
}

export function loadSavedTheme(): ThemeId {
  const saved = getSavedTheme();
  applyTheme(saved);
  applyColorMode(getSavedColorMode());
  return saved;
}
