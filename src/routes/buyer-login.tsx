import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Mail, ArrowRight, Loader2 } from "lucide-react";
import { SiteHeader, SiteFooter } from "@/components/site-chrome";
import { sendBuyerPassMagicLink } from "@/lib/checkout.functions";

export const Route = createFileRoute("/buyer-login")({
  head: () => ({
    meta: [
      { title: "Buyer Login — Roovr" },
      { name: "description", content: "Sign in to access your Roovr Buyer Pass or property report." },
    ],
  }),
  component: BuyerLoginPage,
});

function BuyerLoginPage() {
  const send = useServerFn(sendBuyerPassMagicLink);
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "warn" | "err"; text: string } | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setLoading(true);
    setMsg(null);
    try {
      const r = await send({ data: { email: email.trim() } });
      if (!r.found) {
        setMsg({
          kind: "warn",
          text: "No account found for that email. If you've made a purchase, check the email address you used at checkout.",
        });
      } else if (r.ok) {
        setMsg({ kind: "ok", text: "Magic link sent — check your inbox (and spam folder)." });
      } else {
        setMsg({ kind: "err", text: "We couldn't send the link right now. Please try again shortly." });
      }
    } catch {
      setMsg({ kind: "err", text: "Could not send right now. Try again shortly." });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <SiteHeader />
      <main className="mx-auto max-w-md px-6 py-20">
        <div className="text-center">
          <div className="mx-auto inline-flex h-12 w-12 items-center justify-center" style={{ background: "#FAECE7", borderRadius: 999 }}>
            <Mail className="h-5 w-5" style={{ color: "#D85A30" }} />
          </div>
          <h1 className="mt-6 text-3xl font-semibold tracking-tight">Buyer Login</h1>
          <p className="mt-2 text-sm" style={{ color: "#5F5E5A" }}>
            Enter the email you used at checkout and we'll send you a magic link.
          </p>
        </div>

        <form onSubmit={onSubmit} className="mt-8 flex flex-col gap-3">
          <input
            type="email"
            required
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="w-full px-4 py-3 outline-none"
            style={{ background: "#F1EFE8", borderRadius: 12, fontSize: 14, color: "#1A1108" }}
          />
          <button
            type="submit"
            disabled={loading}
            className="inline-flex items-center justify-center gap-2 transition-opacity hover:opacity-90 disabled:opacity-50"
            style={{
              background: "#1A1108",
              color: "#FFFDF9",
              fontSize: 13,
              fontWeight: 500,
              borderRadius: 100,
              padding: "12px 24px",
            }}
          >
            {loading ? <><Loader2 className="h-4 w-4 animate-spin" /> Sending…</> : <>Send magic link <ArrowRight className="h-4 w-4" /></>}
          </button>
        </form>

        {msg && (
          <p
            className="mt-4 text-center text-sm"
            style={{ color: msg.kind === "ok" ? "#1A1108" : msg.kind === "warn" ? "#993C1D" : "#B91C1C" }}
          >
            {msg.text}
          </p>
        )}

        <p className="mt-8 text-center text-sm" style={{ color: "#5F5E5A" }}>
          Don't have a pass yet?{" "}
          <Link to="/pricing" style={{ color: "#D85A30" }}>
            See plans
          </Link>
        </p>
      </main>
      <SiteFooter />
    </div>
  );
}
