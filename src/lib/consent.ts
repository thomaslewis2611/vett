// Consent Mode v2 state management for GA4
// Stores user choice in a first-party cookie, exposes helpers for read/write/subscribe

export type ConsentChoice = {
  analytics: boolean;
  marketing: boolean;
  // necessary is always true, not stored
  timestamp: number;
  version: number;
};

const COOKIE_NAME = "vett_consent";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year
const CONSENT_VERSION = 1; // bump to re-prompt all users if policy changes

export function getConsentFromCookie(cookieString?: string): ConsentChoice | null {
  // Works on both server (pass document.cookie or request cookie header) and client
  const source = cookieString ?? (typeof document !== "undefined" ? document.cookie : "");
  if (!source) return null;

  const match = source.split("; ").find((row) => row.startsWith(`${COOKIE_NAME}=`));
  if (!match) return null;

  try {
    const value = decodeURIComponent(match.split("=")[1]);
    const parsed = JSON.parse(value) as ConsentChoice;
    if (parsed.version !== CONSENT_VERSION) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function setConsent(choice: Omit<ConsentChoice, "timestamp" | "version">): void {
  if (typeof document === "undefined") return;

  const fullChoice: ConsentChoice = {
    ...choice,
    timestamp: Date.now(),
    version: CONSENT_VERSION,
  };

  const value = encodeURIComponent(JSON.stringify(fullChoice));
  document.cookie = `${COOKIE_NAME}=${value}; max-age=${COOKIE_MAX_AGE}; path=/; SameSite=Lax; Secure`;

  // Fire consent update to gtag
  if (typeof window !== "undefined" && typeof window.gtag === "function") {
    window.gtag("consent", "update", {
      analytics_storage: choice.analytics ? "granted" : "denied",
      ad_storage: choice.marketing ? "granted" : "denied",
      ad_user_data: choice.marketing ? "granted" : "denied",
      ad_personalization: choice.marketing ? "granted" : "denied",
    });
  }

  // Notify listeners
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("vett:consent-change", { detail: fullChoice }));
  }
}

export function clearConsent(): void {
  if (typeof document === "undefined") return;
  document.cookie = `${COOKIE_NAME}=; max-age=0; path=/; SameSite=Lax; Secure`;
}

// Type augmentation for gtag
declare global {
  interface Window {
    gtag: (...args: unknown[]) => void;
    dataLayer: unknown[];
  }
}
