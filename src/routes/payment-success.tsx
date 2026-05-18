import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { z } from "zod";
import { Loader2, CheckCircle2, MailOpen } from "lucide-react";
import { SiteHeader, SiteFooter } from "@/components/site-chrome";
import { verifyCheckoutSession, sendBuyerPassMagicLink } from "@/lib/checkout.functions";
import { markSinglePurchased } from "@/components/upsell-pass-modal";

export const Route = createFileRoute("/payment-success")({
  validateSearch: z.object({
    session_id: z.string().optional(),
    tier: z.enum(["single", "pass"]).optional(),
  }),
  head: () => ({ meta: [{ title: "Payment confirmed — vett" }] }),
  component: PaymentSuccessPage,
});

function PaymentSuccessPage() {
  const { session_id, tier } = Route.useSearch();
  const verify = useServerFn(verifyCheckoutSession);
  const resend = useServerFn(sendBuyerPassMagicLink);

  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "single"; email: string; hadAnalysisJob: boolean }
    | { status: "pass"; email: string; hadAnalysisJob: boolean }
    | { status: "error"; message: string }
  >({ status: "loading" });
  const [resendMsg, setResendMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!session_id) {
      setState({ status: "error", message: "Missing session reference." });
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await verify({ data: { sessionId: session_id } });
        if (cancelled) return;
        if (!res.paid) {
          setState({ status: "error", message: "Payment not completed yet. If you just paid, refresh in a few seconds." });
          return;
        }
        const effectiveTier = res.tier ?? tier;
        const emailFallback = res.email ?? "your email";
        if (effectiveTier === "single") {
          markSinglePurchased();
          setState({ status: "single", email: emailFallback, hadAnalysisJob: res.hadAnalysisJob });
        } else if (effectiveTier === "pass") {
          setState({ status: "pass", email: emailFallback, hadAnalysisJob: res.hadAnalysisJob });
        } else {
          setState({ status: "error", message: "Unknown purchase type." });
        }
      } catch (err) {
        if (cancelled) return;
        setState({ status: "error", message: (err as Error).message || "Could not confirm payment." });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session_id, tier, verify]);

  const HEADING = "'Playfair Display', Georgia, serif";

  const renderMagicLinkScreen = (opts: {
    title: string;
    body: React.ReactNode;
    email: string;
  }) => (
    <div className="text-center">
      <div className="mx-auto inline-flex h-12 w-12 items-center justify-center" style={{ background: "#F1EFE8", borderRadius: 999 }}>
        <CheckCircle2 className="h-6 w-6" style={{ color: "#2D6A4F" }} />
      </div>
      <h1 className="mt-6" style={{ fontFamily: HEADING, fontWeight: 400, fontSize: 36, color: "#1A1108", letterSpacing: "-0.5px" }}>
        {opts.title}
      </h1>
      <p className="mt-4" style={{ fontSize: 16, fontWeight: 300, color: "#1A1108", lineHeight: 1.6 }}>{opts.body}</p>
      <p className="mt-2" style={{ fontSize: 13, fontWeight: 300, color: "#888780" }}>Can't find it? Check your spam folder.</p>
      <button
        type="button"
        onClick={async () => {
          setResendMsg(null);
          try {
            const r = await resend({ data: { email: opts.email } });
            setResendMsg(r.found ? "Magic link resent — check your inbox." : "We couldn't find your account yet. Wait a moment and try again.");
          } catch {
            setResendMsg("Could not resend right now. Try again shortly.");
          }
        }}
        className="mt-7 inline-flex items-center gap-2 transition-opacity hover:opacity-90"
        style={{ background: "#2D6A4F", color: "#FFFDF9", fontSize: 14, fontWeight: 500, borderRadius: 100, padding: "13px 24px" }}
      >
        <MailOpen className="h-4 w-4" /> Resend magic link
      </button>
      {resendMsg && (
        <p className="mt-3" style={{ fontSize: 13, fontWeight: 300, color: "#5F5E5A" }}>{resendMsg}</p>
      )}
    </div>
  );

  return (
    <div className="flex min-h-screen flex-col" style={{ background: "#F1EFE8" }}>
      <SiteHeader />
      <main className="mx-auto w-full max-w-xl px-6 py-20 sm:py-24 flex-1">
        <div
          className="p-8 sm:p-10"
          style={{ background: "#FFFDF9", border: "0.5px solid rgba(26,17,8,0.1)", borderRadius: 16 }}
        >
          {state.status === "loading" && (
            <div className="text-center">
              <Loader2 className="mx-auto h-8 w-8 animate-spin" style={{ color: "#2D6A4F" }} />
              <h1 className="mt-6" style={{ fontFamily: HEADING, fontWeight: 400, fontSize: 28, color: "#1A1108", letterSpacing: "-0.4px" }}>
                Confirming your payment…
              </h1>
              <p className="mt-3" style={{ fontSize: 14, fontWeight: 300, color: "#5F5E5A" }}>This usually takes a couple of seconds.</p>
            </div>
          )}

          {state.status === "single" && renderMagicLinkScreen({
            title: "Payment confirmed",
            body: (
              <>
                {state.hadAnalysisJob
                  ? "Your report is saved. Click your magic link to view it with full Single Report access."
                  : "Your report is saved to your account."}{" "}
                We've sent a magic link to{" "}
                <span style={{ fontWeight: 500 }}>{state.email}</span> — click it to access your report from any device.
              </>
            ),
            email: state.email,
          })}

          {state.status === "pass" && (() => {
            const expiry = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
            const expiryLabel = expiry.toLocaleDateString("en-GB", {
              day: "2-digit",
              month: "long",
              year: "numeric",
            });
            return renderMagicLinkScreen({
              title: "You're all set",
              body: (
                <>
                  {state.hadAnalysisJob
                    ? "Your report is saved. Click your magic link to view it with full Buyer Pass access. "
                    : ""}
                  Your Buyer Pass is active until <span style={{ fontWeight: 500 }}>{expiryLabel}</span>. We've sent a magic link to{" "}
                  <span style={{ fontWeight: 500 }}>{state.email}</span> — click it to start analysing properties.
                </>
              ),
              email: state.email,
            });
          })()}

          {state.status === "error" && (
            <div className="text-center">
              <h1 style={{ fontFamily: HEADING, fontWeight: 400, fontSize: 28, color: "#1A1108", letterSpacing: "-0.4px" }}>
                Something went wrong
              </h1>
              <p className="mt-4" style={{ fontSize: 14, fontWeight: 300, color: "#5F5E5A" }}>{state.message}</p>
              <p className="mt-3" style={{ fontSize: 14, fontWeight: 300, color: "#5F5E5A" }}>
                Need help? Email <a href="mailto:support@roovr.co" style={{ color: "#2D6A4F", fontWeight: 500 }}>support@roovr.co</a>
              </p>
              <Link
                to="/"
                className="mt-6 inline-flex items-center justify-center transition-opacity hover:opacity-90"
                style={{
                  background: "#2D6A4F",
                  color: "#FFFDF9",
                  fontSize: 14,
                  fontWeight: 500,
                  borderRadius: 100,
                  padding: "12px 22px",
                }}
              >
                Back to home
              </Link>
            </div>
          )}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
