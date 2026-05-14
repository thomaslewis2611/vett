import { Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { LogOut, LayoutDashboard, Mail, ChevronDown, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { checkBuyerPassByEmail } from "@/lib/access.functions";
import { sendBuyerPassMagicLink } from "@/lib/checkout.functions";

function truncateEmail(email: string, max = 14) {
  const [name, domain] = email.split("@");
  if (!domain) return email;
  if (name.length <= max) return email;
  return `${name.slice(0, max)}…@${domain.split(".")[0]}`;
}

function useAuthUser() {
  const [state, setState] = useState<{ email: string | null; hasPass: boolean; ready: boolean }>({
    email: null,
    hasPass: false,
    ready: false,
  });
  const checkPass = useServerFn(checkBuyerPassByEmail);

  useEffect(() => {
    let cancelled = false;
    const resolve = async (email: string | null) => {
      if (!email) {
        if (!cancelled) setState({ email: null, hasPass: false, ready: true });
        return;
      }
      try {
        const r = await checkPass({ data: { email } });
        if (cancelled) return;
        setState({ email, hasPass: r.hasPass, ready: true });
      } catch {
        if (!cancelled) setState({ email, hasPass: false, ready: true });
      }
    };
    supabase.auth.getUser().then(({ data }) => resolve(data.user?.email ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      resolve(session?.user?.email ?? null);
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [checkPass]);

  return state;
}

function MagicLinkModal({ onClose }: { onClose: () => void }) {
  const send = useServerFn(sendBuyerPassMagicLink);
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setLoading(true);
    setMsg(null);
    try {
      const r = await send({ data: { email: email.trim() } });
      setMsg(
        r.found
          ? "Magic link sent — check your inbox (and spam folder)."
          : "We couldn't find a purchase for that email. If you just paid, wait a moment and try again."
      );
    } catch {
      setMsg("Could not send right now. Try again shortly.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(26,17,8,0.4)" }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl p-6"
        style={{ background: "#FFFDF9" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <div>
            <h2 style={{ fontSize: 18, fontWeight: 500, color: "#1A1108" }}>
              Buyer Login
            </h2>
            <p className="mt-1" style={{ fontSize: 13, color: "#5F5E5A" }}>
              Enter the email you used at checkout (Buyer Pass or single report).
            </p>
          </div>
          <button onClick={onClose} aria-label="Close" style={{ color: "#888780" }}>
            <X className="h-4 w-4" />
          </button>
        </div>
        <form onSubmit={onSubmit} className="mt-4 flex flex-col gap-2">
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="w-full px-4 py-3 outline-none"
            style={{
              background: "#F1EFE8",
              borderRadius: 12,
              fontSize: 14,
              color: "#1A1108",
            }}
          />
          <button
            type="submit"
            disabled={loading}
            className="inline-flex items-center justify-center gap-2 transition-opacity hover:opacity-90 disabled:opacity-50"
            style={{
              background: "#D85A30",
              color: "#FFFDF9",
              fontSize: 13,
              fontWeight: 500,
              borderRadius: 100,
              padding: "12px 20px",
            }}
          >
            <Mail className="h-4 w-4" /> {loading ? "Sending…" : "Send magic link"}
          </button>
        </form>
        {msg && (
          <p className="mt-3" style={{ fontSize: 13, color: "#5F5E5A" }}>
            {msg}
          </p>
        )}
      </div>
    </div>
  );
}

function UserMenu({ email, hasPass }: { email: string; hasPass: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const onSignOut = async () => {
    await supabase.auth.signOut();
    setOpen(false);
    navigate({ to: "/" });
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-2 transition-opacity hover:opacity-90"
        style={{
          background: "#F1EFE8",
          borderRadius: 100,
          padding: "6px 10px 6px 6px",
          fontSize: 13,
          color: "#1A1108",
        }}
      >
        <span
          aria-hidden
          className="inline-flex items-center justify-center"
          style={{
            width: 24,
            height: 24,
            borderRadius: 999,
            background: "#D85A30",
            color: "#FFFDF9",
            fontSize: 11,
            fontWeight: 600,
          }}
        >
          {email[0]?.toUpperCase() ?? "?"}
        </span>
        <span style={{ maxWidth: 140 }} className="hidden sm:inline truncate">
          {truncateEmail(email)}
        </span>
        <ChevronDown className="h-3.5 w-3.5" style={{ color: "#5F5E5A" }} />
      </button>
      {open && (
        <div
          className="absolute right-0 mt-2 w-56 overflow-hidden"
          style={{
            background: "#FFFDF9",
            borderRadius: 12,
            border: "0.5px solid rgba(26,17,8,0.12)",
            boxShadow: "0 8px 24px rgba(26,17,8,0.08)",
          }}
        >
          <div className="px-3 py-2" style={{ fontSize: 11, color: "#888780" }}>
            Signed in as
            <div className="truncate" style={{ fontSize: 12, color: "#1A1108" }}>
              {email}
            </div>
          </div>
          <Link
            to={hasPass ? "/dashboard" : "/my-reports"}
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 px-3 py-2 transition-colors hover:bg-[#F1EFE8]"
            style={{ fontSize: 13, color: "#1A1108" }}
          >
            <LayoutDashboard className="h-4 w-4" style={{ color: "#5F5E5A" }} />{" "}
            {hasPass ? "My reports" : "My report"}
          </Link>
          <button
            type="button"
            onClick={onSignOut}
            className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-[#F1EFE8]"
            style={{ fontSize: 13, color: "#1A1108" }}
          >
            <LogOut className="h-4 w-4" style={{ color: "#5F5E5A" }} /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}

export function SiteHeader() {
  const { email, hasPass, ready } = useAuthUser();
  const [magicOpen, setMagicOpen] = useState(false);
  const loggedIn = ready && Boolean(email);

  return (
    <header
      className="bg-background sticky top-0 z-40"
      style={{ borderBottom: "0.5px solid rgba(26,17,8,0.12)" }}
    >
      <div className="mx-auto flex max-w-6xl items-center justify-between px-8" style={{ height: 56 }}>
        <Link to="/" className="flex items-center gap-2">
          <span
            aria-hidden
            className="inline-block"
            style={{ width: 8, height: 8, borderRadius: 9999, background: "#D85A30" }}
          />
          <span style={{ fontSize: 20, fontWeight: 500, color: "#1A1108", letterSpacing: "-0.3px" }}>
            Roovr
          </span>
        </Link>
        <nav className="flex items-center gap-4 sm:gap-6">
          {!loggedIn && (
            <Link
              to="/pricing"
              style={{ fontSize: 13, color: "#888780" }}
              className="hover:text-foreground transition-colors"
              activeProps={{ style: { fontSize: 13, color: "#1A1108" } }}
            >
              Pricing
            </Link>
          )}

          {loggedIn ? (
            <>
              <Link
                to={hasPass ? "/dashboard" : "/my-reports"}
                className="inline-flex items-center justify-center transition-opacity hover:opacity-90"
                style={{
                  background: "#1A1108",
                  color: "#FFFDF9",
                  fontSize: 13,
                  fontWeight: 500,
                  borderRadius: 100,
                  padding: "10px 20px",
                }}
              >
                {hasPass ? "My reports" : "My report"}
              </Link>
              <UserMenu email={email!} hasPass={hasPass} />
            </>
          ) : (
            <>
              <Link
                to="/buyer-login"
                className="hidden sm:inline transition-colors hover:text-foreground"
                style={{ fontSize: 13, color: "#888780" }}
                activeProps={{ style: { fontSize: 13, color: "#1A1108" } }}
              >
                Buyer Login
              </Link>
              {/* Mobile: filled dark Login pill */}
              <Link
                to="/buyer-login"
                className="inline-flex sm:hidden items-center justify-center transition-opacity hover:opacity-90"
                style={{
                  background: "#1A1108",
                  color: "#FFFDF9",
                  fontSize: 13,
                  fontWeight: 500,
                  borderRadius: 100,
                  padding: "6px 12px",
                }}
              >
                Login
              </Link>
            </>
          )}
        </nav>
      </div>
      {magicOpen && <MagicLinkModal onClose={() => setMagicOpen(false)} />}
    </header>
  );
}

export function SiteFooter() {
  return (
    <div style={{ display: "flex", flexDirection: "column", marginTop: "auto" }}>
      <div
        style={{
          background: "#F1EFE8",
          color: "#888780",
          fontSize: 12,
          textAlign: "center",
          padding: "14px 24px",
          width: "100%",
          margin: 0,
        }}
      >
        Roovr reports are AI-generated and advisory only. Always verify information independently and seek professional advice from a solicitor, surveyor, and mortgage broker before making any offer.
      </div>
      <footer style={{ background: "#1A1108", margin: 0 }}>
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-8 py-10 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <span
              aria-hidden
              className="inline-block"
              style={{ width: 8, height: 8, borderRadius: 9999, background: "#D85A30" }}
            />
            <span style={{ fontSize: 18, fontWeight: 500, color: "#FFFDF9" }}>Roovr</span>
            <span style={{ fontSize: 13, color: "#888780", marginLeft: 12 }}>© 2026 Roovr</span>
          </div>
          <div className="flex gap-6" style={{ fontSize: 13, color: "#888780" }}>
            <Link to="/pricing" className="hover:text-[#FFFDF9] transition-colors">Pricing</Link>
            <Link to="/about" className="hover:text-[#FFFDF9] transition-colors">About</Link>
            <Link to="/privacy" className="hover:text-[#FFFDF9] transition-colors">Privacy</Link>
            <Link to="/terms" className="hover:text-[#FFFDF9] transition-colors">Terms</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
