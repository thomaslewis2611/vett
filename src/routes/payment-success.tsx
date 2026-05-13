import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { Loader2, CheckCircle2, MailOpen, Copy, Check, Bookmark, ArrowRight } from "lucide-react";
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
    | { status: "single-pending"; email: string | null }
    | { status: "single-ready"; token: string; listingUrl: string | null }
    | { status: "pass"; email: string }
    | { status: "error"; message: string }
  >({ status: "loading" });
  const [resendMsg, setResendMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

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
            setState({ status: "single-ready", token: res.token, listingUrl: res.listingUrl });
          } else {
            setState({ status: "single-pending", email: res.email });
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
  }, [session_id, tier, verify]);

  // Poll for the single-report token until webhook fires
  useEffect(() => {
    if (state.status !== "single-pending" || !session_id) return;
    const id = setInterval(async () => {
      try {
        const res = await verify({ data: { sessionId: session_id } });
        if (res.paid && res.tier === "single" && res.token) {
          clearInterval(id);
          setState({ status: "single-ready", token: res.token, listingUrl: res.listingUrl });
        }
      } catch { /* ignore */ }
    }, 2000);
    return () => clearInterval(id);
  }, [state.status, session_id, verify]);

  const reportUrl = useMemo(() => {
    if (state.status !== "single-ready" || typeof window === "undefined") return "";
    const u = new URL("/results", window.location.origin);
    if (state.listingUrl) u.searchParams.set("url", state.listingUrl);
    u.searchParams.set("token", state.token);
    return u.toString();
  }, [state]);

  const onCopy = async () => {
    if (!reportUrl) return;
    try {
      await navigator.clipboard.writeText(reportUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* ignore */ }
  };

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

        {state.status === "single-pending" && (
          <div className="text-center">
            <Loader2 className="mx-auto h-8 w-8 animate-spin" style={{ color: "#D85A30" }} />
            <h1 className="mt-6 text-2xl font-semibold tracking-tight">Preparing your report…</h1>
            <p className="mt-2 text-sm" style={{ color: "#5F5E5A" }}>Hang tight — we're generating your access link.</p>
          </div>
        )}

        {state.status === "single-ready" && (
          <div>
            <div className="text-center">
              <div className="mx-auto inline-flex h-12 w-12 items-center justify-center" style={{ background: "#FAECE7", borderRadius: 999 }}>
                <CheckCircle2 className="h-6 w-6" style={{ color: "#D85A30" }} />
              </div>
              <h1 className="mt-6 text-3xl font-semibold tracking-tight">Payment confirmed</h1>
            </div>

            <div
              className="mt-8 p-5"
              style={{
                background: "#FAECE7",
                borderRadius: 16,
                border: "0.5px solid rgba(153,60,29,0.2)",
              }}
            >
              <div className="flex items-start gap-3">
                <Bookmark className="h-5 w-5 mt-0.5 flex-shrink-0" style={{ color: "#993C1D" }} />
                <div>
                  <h2 style={{ fontSize: 15, fontWeight: 600, color: "#993C1D" }}>
                    Important — bookmark this page
                  </h2>
                  <p className="mt-1" style={{ fontSize: 13, color: "#993C1D", lineHeight: 1.5 }}>
                    Your full report lives at a unique link. Save it to your bookmarks now so you can return to it any time.
                  </p>
                </div>
              </div>
            </div>

            <div className="mt-4">
              <label style={{ fontSize: 11, color: "#888780" }}>Your report URL</label>
              <div
                className="mt-1 flex items-center gap-2 px-3 py-2"
                style={{
                  background: "#F1EFE8",
                  borderRadius: 12,
                  border: "0.5px solid rgba(26,17,8,0.12)",
                }}
              >
                <input
                  readOnly
                  value={reportUrl}
                  onFocus={(e) => e.currentTarget.select()}
                  className="flex-1 bg-transparent outline-none truncate"
                  style={{ fontSize: 13, color: "#1A1108" }}
                />
                <button
                  type="button"
                  onClick={onCopy}
                  className="inline-flex items-center gap-1 transition-opacity hover:opacity-90"
                  style={{
                    background: copied ? "#1A1108" : "#D85A30",
                    color: "#FFFDF9",
                    fontSize: 12,
                    fontWeight: 500,
                    borderRadius: 100,
                    padding: "6px 12px",
                  }}
                >
                  {copied ? <><Check className="h-3.5 w-3.5" /> Copied</> : <><Copy className="h-3.5 w-3.5" /> Copy</>}
                </button>
              </div>
              <p className="mt-2" style={{ fontSize: 12, color: "#5F5E5A" }}>
                Tip: press {typeof navigator !== "undefined" && /Mac/i.test(navigator.platform) ? "⌘" : "Ctrl"}+D to bookmark this page now.
              </p>
            </div>

            <div className="mt-6 flex flex-col items-center gap-3">
              <button
                type="button"
                onClick={() => navigate({ to: "/results", search: { url: state.listingUrl ?? undefined, token: state.token } })}
                className="inline-flex items-center gap-2 transition-opacity hover:opacity-90"
                style={{
                  background: "#1A1108",
                  color: "#FFFDF9",
                  fontSize: 13,
                  fontWeight: 500,
                  borderRadius: 100,
                  padding: "12px 24px",
                }}
              >
                Open my report <ArrowRight className="h-4 w-4" />
              </button>
            </div>
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
            <Link to="/" className="mt-6 inline-block" style={{ fontSize: 13, color: "#D85A30" }}>← Back to home</Link>
          </div>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
