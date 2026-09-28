import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { applyColorMode, getSavedColorMode, type ColorMode } from "@/lib/theme";
import { useUiText } from "@/components/i18n/locale-provider";

function currentResolvedMode(): "light" | "dark" {
  return document.documentElement.classList.contains("light")
    ? "light"
    : "dark";
}

export function ThemeToggle() {
  const t = useUiText();
  const [mode, setMode] = useState<ColorMode>(getSavedColorMode);
  const [resolved, setResolved] = useState(currentResolvedMode);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: light)");
    const sync = () => {
      if (mode === "system") applyColorMode("system");
      setResolved(currentResolvedMode());
    };
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, [mode]);

  const next = resolved === "light" ? "dark" : "light";

  return (
    <button
      type="button"
      onClick={() => {
        setMode(next);
        applyColorMode(next);
        setResolved(next);
      }}
      className="inline-flex size-11 md:size-9 items-center justify-center rounded-control border border-border/80 bg-card/65 text-muted-foreground shadow-sm transition-colors hover:border-primary/35 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      aria-label={t(next === "light" ? "switchToLight" : "switchToDark")}
      title={t(next === "light" ? "switchToLight" : "switchToDark")}
    >
      {resolved === "light" ? (
        <Moon size={15} aria-hidden />
      ) : (
        <Sun size={16} aria-hidden />
      )}
    </button>
  );
}
