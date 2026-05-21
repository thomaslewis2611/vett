// GA4 event tracking helper
// Use this instead of calling window.gtag directly so types are enforced
// and we can swap providers later without touching call sites

import { getConsentFromCookie } from "./consent";

export const GA_MEASUREMENT_ID = "G-B01ZMLED3N";

export function trackEvent(
  eventName: string,
  params?: Record<string, string | number | boolean>
): void {
  if (typeof window === "undefined") return;

  // Don't track if analytics consent denied
  const consent = getConsentFromCookie();
  if (!consent?.analytics) return;

  if (typeof window.gtag !== "function") return;

  window.gtag("event", eventName, params);
}

export function trackPageview(path: string): void {
  if (typeof window === "undefined") return;
  if (typeof window.gtag !== "function") return;

  window.gtag("event", "page_view", {
    page_path: path,
    page_location: window.location.href,
  });
}