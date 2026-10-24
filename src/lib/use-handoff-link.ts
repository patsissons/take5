import { useCallback, useEffect, useState } from "react";
import { sealedFromHash } from "./handoff";

function stripHash(): void {
  window.history.replaceState(
    window.history.state,
    "",
    window.location.pathname + window.location.search,
  );
}

/**
 * The sealed payload a `#handoff=` link opened this page with (or switched
 * an open tab to). The fragment leaves the address bar straight away, so a
 * reload never asks again and the tab's own history forgets it.
 */
export function useHandoffLink(): [string | null, () => void] {
  const [sealed, setSealed] = useState<string | null>(() =>
    typeof window === "undefined" ? null : sealedFromHash(window.location.hash),
  );
  useEffect(() => {
    if (sealedFromHash(window.location.hash)) stripHash();
    const onChange = () => {
      const next = sealedFromHash(window.location.hash);
      if (!next) return;
      setSealed(next);
      stripHash();
    };
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  const clear = useCallback(() => setSealed(null), []);
  return [sealed, clear];
}
