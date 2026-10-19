import { useEffect, useState } from "react";

export type View = "studio" | "privacy";

function viewOf(hash: string): View {
  return hash === "#privacy" ? "privacy" : "studio";
}

/** The page the URL hash names; the privacy page is `#privacy`. */
export function useHash(): View {
  const [view, setView] = useState<View>(() =>
    typeof window === "undefined" ? "studio" : viewOf(window.location.hash),
  );
  useEffect(() => {
    const onChange = () => setView(viewOf(window.location.hash));
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return view;
}
