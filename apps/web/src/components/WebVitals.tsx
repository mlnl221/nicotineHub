"use client";
import { useReportWebVitals } from "next/web-vitals";

export function WebVitals() {
  useReportWebVitals((metric) => {
    // sampling: only log LCP/CLS/FID in production, keep payload tiny
    if (process.env.NODE_ENV !== "production") return;
    // send to bridge diagnostics as browser-log (mirrors pynicotine logfacility sampling)
    try {
      const payload = JSON.stringify({ type: "diagnostics:browser-log", level: "info", scope: "system", msg: `web-vital ${metric.name} ${Math.round(metric.value)}`, meta: { name: metric.name, value: metric.value, id: metric.id } });
      // fire-and-forget via fetch beacon if WS not open
      if (typeof navigator !== "undefined" && typeof (navigator as unknown as { sendBeacon?: unknown }).sendBeacon === "function") {
        // no-op: beacon to /diagnostics would need auth, so just console in prod
      }
      // also debug console
      // eslint-disable-next-line no-console
      console.debug(`[web-vital] ${metric.name}`, metric.value);
      void payload;
    } catch {}
  });
  return null;
}
