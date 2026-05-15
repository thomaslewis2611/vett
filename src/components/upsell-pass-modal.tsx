import { useEffect, useState } from "react";
import { X } from "lucide-react";

const PURCHASED_KEY = "roovr_purchased_single";
const DISMISSED_KEY = "roovr_upsell_pass_dismissed";

/**
 * Returns true when the visitor has previously purchased a Single Report
 * (flag set on payment-success) AND has not dismissed the upsell this session.
 */
export function shouldShowPassUpsell(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const purchased = window.localStorage.getItem(PURCHASED_KEY) === "1";
    const dismissed = window.sessionStorage.getItem(DISMISSED_KEY) === "1";
    return purchased && !dismissed;
  } catch {
    return false;
  }
}

export function markSinglePurchased() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PURCHASED_KEY, "1");
  } catch { /* ignore */ }
}

function markUpsellDismissed() {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(DISMISSED_KEY, "1");
  } catch { /* ignore */ }
}

export type UpsellPassModalProps = {
  open: boolean;
  onClose: () => void;
  onChoosePass: () => void;
  onChooseSingle: () => void;
};

export function UpsellPassModal({
  open,
  onClose,
  onChoosePass,
  onChooseSingle,
}: UpsellPassModalProps) {
  const [submitting, setSubmitting] = useState<"pass" | "single" | null>(null);

  useEffect(() => {
    if (!open) setSubmitting(null);
  }, [open]);

  if (!open) return null;

  const choosePass = () => {
    if (submitting) return;
    setSubmitting("pass");
    markUpsellDismissed();
    onChoosePass();
  };

  const chooseSingle = () => {
    if (submitting) return;
    setSubmitting("single");
    markUpsellDismissed();
    onChooseSingle();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      style={{ background: "rgba(26,17,8,0.55)" }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="upsell-pass-title"
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting) {
          markUpsellDismissed();
          onClose();
        }
      }}
    >
      <div
        className="relative w-full max-w-md p-6 sm:p-8"
        style={{
          background: "#FFFDF9",
          borderRadius: 16,
          border: "0.5px solid rgba(26,17,8,0.12)",
          boxShadow: "0 20px 60px -20px rgba(26,17,8,0.35)",
        }}
      >
        <button
          type="button"
          onClick={() => {
            if (submitting) return;
            markUpsellDismissed();
            onClose();
          }}
          aria-label="Close"
          className="absolute right-4 top-4 p-1"
          style={{ color: "#888780" }}
        >
          <X className="h-4 w-4" />
        </button>

        <div
          className="inline-block uppercase"
          style={{
            background: "#FAECE7",
            color: "#993C1D",
            fontSize: 11,
            fontWeight: 500,
            letterSpacing: "0.06em",
            borderRadius: 100,
            padding: "4px 10px",
          }}
        >
          Better value
        </div>

        <h2
          id="upsell-pass-title"
          className="mt-4"
          style={{ fontSize: 22, fontWeight: 500, color: "#1A1108", lineHeight: 1.25, letterSpacing: "-0.5px" }}
        >
          You've already bought a report — want unlimited for 90 days?
        </h2>

        <p className="mt-3" style={{ fontSize: 14, color: "#5F5E5A", lineHeight: 1.6 }}>
          Upgrade to Buyer Pass for £24.99 and analyse as many properties as you like for 90 days,
          plus AI chat on every property. You've already spent £4.99 — it's just £20 more for unlimited access.
        </p>

        <button
          type="button"
          onClick={choosePass}
          disabled={!!submitting}
          className="mt-6 inline-flex w-full items-center justify-center transition-colors hover:bg-[#993C1D] disabled:opacity-60"
          style={{
            background: "#D85A30",
            color: "#FFFDF9",
            fontSize: 14,
            fontWeight: 500,
            borderRadius: 100,
            padding: "12px 20px",
          }}
        >
          {submitting === "pass" ? "Starting checkout…" : "Upgrade to Buyer Pass — £24.99 →"}
        </button>

        <button
          type="button"
          onClick={chooseSingle}
          disabled={!!submitting}
          className="mt-3 inline-flex w-full items-center justify-center disabled:opacity-60"
          style={{
            background: "transparent",
            color: "#5F5E5A",
            fontSize: 13,
            padding: "8px 12px",
            textDecoration: "underline",
          }}
        >
          {submitting === "single" ? "Starting checkout…" : "No thanks, just get this report — £4.99"}
        </button>
      </div>
    </div>
  );
}
