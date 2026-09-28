import { useEffect, useState } from "react";

function documentIsVisible(): boolean {
  return (
    typeof document === "undefined" || document.visibilityState === "visible"
  );
}

export function useDocumentVisible(): boolean {
  const [visible, setVisible] = useState(documentIsVisible);

  useEffect(() => {
    const onVisibilityChange = () => setVisible(documentIsVisible());
    document.addEventListener("visibilitychange", onVisibilityChange);
    onVisibilityChange();
    return () =>
      document.removeEventListener("visibilitychange", onVisibilityChange);
  }, []);

  return visible;
}

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window === "undefined" ? false : window.matchMedia(query).matches,
  );

  useEffect(() => {
    const media = window.matchMedia(query);
    const onChange = (event: MediaQueryListEvent) => setMatches(event.matches);
    setMatches(media.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}
