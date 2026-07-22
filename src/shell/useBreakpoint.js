// Tracks a `(max-width: ...)` media query via matchMedia — the same pattern
// App.jsx already uses for its mobile-drawer listener, generalized so the
// compact/narrow top-bar tiers (and any future caller) share one hook instead
// of each hand-rolling a matchMedia effect.
import { useEffect, useState } from "react";

// Top bar goes icon-only / drops the tagline below this width.
export const COMPACT_MAX_WIDTH = 1199;
// Top bar collapses Clear/Export/Import/CHAIN/telemetry into the ⋯ overflow menu below this width.
export const NARROW_MAX_WIDTH = 999;

export default function useBreakpoint(maxWidth) {
  const query = `(max-width: ${maxWidth}px)`;
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);

  useEffect(() => {
    const mql = window.matchMedia(query);
    const handler = (e) => setMatches(e.matches);
    mql.addEventListener("change", handler);
    handler(mql);
    return () => mql.removeEventListener("change", handler);
  }, [query]);

  return matches;
}
