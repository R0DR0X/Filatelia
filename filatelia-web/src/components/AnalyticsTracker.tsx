"use client";
import { useEffect } from "react";
import { usePathname } from "next/navigation";

const API = "https://filatelia-api.rodrigopianto2005.workers.dev";

export default function AnalyticsTracker() {
  const pathname = usePathname();
  useEffect(() => {
    if (pathname?.startsWith("/admin")) return;
    fetch(`${API}/analytics/visit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: pathname, referrer: document.referrer }),
    }).catch(() => {});
  }, [pathname]);
  return null;
}
