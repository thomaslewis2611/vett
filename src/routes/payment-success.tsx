import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { z } from "zod";
import { Loader2, CheckCircle2, MailOpen } from "lucide-react";
import { SiteHeader, SiteFooter } from "@/components/site-chrome";
import { verifyCheckoutSession, sendBuyerPassMagicLink } from "@/lib/checkout.functions";

export const Route = createFileRoute("/payment-success")({
  validateSearch: z.object({
    session_id: z.string().optional(),
    tier: z.enum(["single", "pass"]).optional(),
  }),
  head: () => ({ meta: [{ title: "Payment confirmed — Roovr" }] }),
  component: PaymentSuccessPage,
});

function PaymentSuccessPage() {
  const { session_id, tier } = Route.useSearch();
  const navigate = useNavigate();
  const verify = useServerFn(verifyCheckoutSession);
  const resend = useServerFn(sendBuyerPassMagicLink);

  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "single"; email: string | null }
    | { status: "pass"; email: string }
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
        if (effectiveTier === "single") {
          if (res.token) {
            navigate({
              to: "/results",
              search: { url: res.listingUrl ?? undefined, token: res.token },
            });
          } else {
            // Webhook may not have fired yet; poll briefly
            setState({ status: "single", email: res.email });
          }
        } else if (effectiveTier === "pass") {
          setState({ status: "pass", email: res.email ?? "your email" });
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
  }, [session_id, tier, verify, navigate]);

  // Poll for the single-report token if it wasn't ready first time
  useEffect(() => {
    if (state.status !== "single" || !session_id) return;
    const id = setInterval(async () => {
      try {
        const res = await verify({ data: { sessionId: session_id } });
        if (res.paid && res.tier === "single" && res.token) {
          clearInterval(id);
          navigate({ to: "/results", search: { url: res.listingUrl ?? undefined, token: res.token } });
        }
      } catch { /* ignore */ }
    }, 2000);
    return () => clearInterval(id);
  }, [state.status, session_id, verify, navigate]);

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main className="mx-auto max-w-xl px-6 py-24">
        {state.status === "loading" && (
          <div className="text-center">
            <Loader2 className="mx-auto h-8 w-8 animate-spin" style={{ color: "#D85A30" }} />
            <h1 className="mt-6 text-2xl font-semibold tracking-tight">Confirming your payment…</h1>
            <p className="mt-2 text-sm" style={{ color: "#5F5E5A" }}>This usually takes a couple of seconds.</p>
          </div>
        )}

        {state.status === "single" && (
          <div className="text-center">
            <Loader2 className="mx-auto h-8 w-8 animate-spin" style={{ color: "#D85A30" }} />
            <h1 className="mt-6 text-2xl font-semibold tracking-tight">Preparing your report…</h1>
            <p className="mt-2 text-sm" style={{ color: "#5F5E5A" }}>Hang tight — we're generating your access link.</p>
          </div>
        )}

        {state.status === "pass" && (
          <div className="text-center">
            <div className="mx-auto inline-flex h-12 w-12 items-center justify-center" style={{ background: "#FAECE7", borderRadius: 999 }}>
              <CheckCircle2 className="h-6 w-6" style={{ color: "#D85A30" }} />
            </div>
            <h1 className="mt-6 text-3xl font-semibold tracking-tight">You're all set</h1>
            <p className="mt-3 text-base" style={{ color: "#1A1108" }}>
              We've sent a magic link to <span style={{ fontWeight: 500 }}>{state.email}</span>. Click it to activate your Buyer Pass and get unlimited access.
            </p>
            <p className="mt-2 text-sm" style={{ color: "#888780" }}>Can't find it? Check your spam folder.</p>
            <button
              type="button"
              onClick={async () => {
                setResendMsg(null);
                try {
                  const r = await resend({ data: { email: state.email } });
                  setResendMsg(r.found ? "Magic link resent — check your inbox." : "We couldn't find a Buyer Pass for that email yet. Wait a moment and try again.");
                } catch {
                  setResendMsg("Could not resend right now. Try again shortly.");
                }
              }}
              className="mt-6 inline-flex items-center gap-2"
              style={{ background: "#1A1108", color: "#FFFDF9", fontSize: 13, fontWeight: 500, borderRadius: 100, padding: "12px 24px" }}
            >
              <MailOpen className="h-4 w-4" /> Resend magic link
            </button>
            {resendMsg && (
              <p className="mt-3 text-sm" style={{ color: "#5F5E5A" }}>{resendMsg}</p>
            )}
          </div>
        )}

        {state.status === "error" && (
          <div className="text-center">
            <h1 className="text-2xl font-semibold tracking-tight">Something went wrong</h1>
            <p className="mt-3 text-sm" style={{ color: "#5F5E5A" }}>{state.message}</p>
            <p className="mt-4 text-sm" style={{ color: "#5F5E5A" }}>
              Need help? Email <a href="mailto:help@roovr.co" style={{ color: "#D85A30" }}>help@roovr.co</a>
            </p>
          </div>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
