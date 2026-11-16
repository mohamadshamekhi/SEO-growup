"use client";
// Thin progress bar at the top of the window from the moment an internal link is clicked
// until the new route (path or query) has rendered. Complements the route loading.tsx
// skeletons, which don't appear for query-only changes like ?status=ignored.
import { useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

export default function NavProgress() {
  const pathname = usePathname();
  const search = useSearchParams();
  const key = `${pathname}?${search.toString()}`;
  // The route a navigation started from; once the route differs, the bar hides by itself.
  const [from, setFrom] = useState<string | null>(null);
  const active = from !== null && from === key;
  const keyRef = useRef(key);
  useEffect(() => { keyRef.current = key; }, [key]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a");
      if (!a || !a.href || a.target === "_blank" || a.hasAttribute("download")) return;
      const url = new URL(a.href, location.href);
      if (url.origin !== location.origin) return;
      if (url.pathname === location.pathname && url.search === location.search) return;
      setFrom(keyRef.current);
      // Never leave the bar stuck if navigation is cancelled.
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setFrom(null), 15000);
    }
    document.addEventListener("click", onClick, true);
    return () => {
      document.removeEventListener("click", onClick, true);
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  return (
    <div className={`nav-progress${active ? " on" : ""}`} role="progressbar" aria-label="در حال بارگذاری صفحه" aria-hidden={!active} aria-busy={active}>
      <span />
    </div>
  );
}
