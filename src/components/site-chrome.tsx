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
              background: "#2D6A4F",
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
            background: "#2D6A4F",
            color: "#FFFDF9",
            fontSize: 11,
            fontWeight: 500,
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
            Dashboard
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

const TOOLS_ITEMS = [
  { label: "Renovation calculator", to: "/tools/renovation-calculator" as const },
  { label: "Find local professionals", to: "/tools/local-businesses" as const },
  { label: "Stamp duty calculator", to: "/tools/stamp-duty" as const },
];

function ToolsDropdown() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="nav-link inline-flex items-center"
        style={{
          fontSize: 13,
          color: "#5F5E5A",
          padding: "6px 10px",
          borderRadius: 6,
          background: "transparent",
          border: "none",
          cursor: "pointer",
          fontFamily: "inherit",
        }}
        aria-expanded={open}
        aria-haspopup="true"
      >
        <span>vett Tools</span>
        <ChevronDown style={{ width: 10, height: 10, opacity: 0.5, marginLeft: 3 }} />
      </button>
      {open && (
        <div
          className="absolute left-0 mt-2 w-52 overflow-hidden"
          style={{
            background: "#FFFDF9",
            borderRadius: 10,
            border: "0.5px solid rgba(26,17,8,0.12)",
            boxShadow: "0 8px 24px rgba(26,17,8,0.08)",
          }}
        >
          {TOOLS_ITEMS.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              onClick={() => setOpen(false)}
              className="flex items-center px-3 py-2.5 transition-colors hover:bg-[#F1EFE8]"
              style={{ fontSize: 13, color: "#1A1108" }}
            >
              {item.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

export function SiteHeader() {
  const { email, hasPass, ready } = useAuthUser();
  const [mobileOpen, setMobileOpen] = useState(false);
  const loggedIn = ready && Boolean(email);

  return (
    <>
      <style>{`
        .nav-link { transition: color 0.12s, background-color 0.12s; }
        .nav-link:hover { color: #1A1108 !important; background-color: rgba(26,17,8,0.05) !important; }
      `}</style>
      <header
        className="sticky top-0 z-40"
        style={{
          background: "#F1EFE8",
          borderBottom: "0.5px solid rgba(26,17,8,0.08)",
        }}
      >
        {/* Desktop bar */}
        <div
          style={{
            maxWidth: 1152,
            margin: "0 auto",
            display: "flex",
            alignItems: "center",
            height: 58,
            paddingLeft: 32,
            paddingRight: 32,
          }}
        >
          {/* Logo */}
          <Link to="/" style={{ display: "flex", alignItems: "center", textDecoration: "none", flexShrink: 0, lineHeight: 1 }}>
            <span style={{ fontFamily: "'Playfair Display', serif", fontSize: 32, fontWeight: 700, color: "#1A1108", letterSpacing: "-2px", lineHeight: 1 }}>
              vett
            </span>
          </Link>

          {/* Nav links — desktop */}
          <nav
            className="hidden md:flex items-center"
            style={{ marginLeft: 28, gap: 2 }}
          >
            <ToolsDropdown />
            <Link
              to="/blog/"
              className="nav-link"
              style={{ fontSize: 13, color: "#5F5E5A", padding: "6px 10px", borderRadius: 6, textDecoration: "none", display: "inline-flex", alignItems: "center" }}
              activeProps={{ style: { fontSize: 13, color: "#1A1108", padding: "6px 10px", borderRadius: 6, textDecoration: "none", display: "inline-flex", alignItems: "center" } }}
              activeOptions={{ includeChildMatches: true }}
            >
              Blog
            </Link>
            <Link
              to="/pricing"
              className="nav-link"
              style={{ fontSize: 13, color: "#5F5E5A", padding: "6px 10px", borderRadius: 6, textDecoration: "none", display: "inline-flex", alignItems: "center" }}
              activeProps={{ style: { fontSize: 13, color: "#1A1108", padding: "6px 10px", borderRadius: 6, textDecoration: "none", display: "inline-flex", alignItems: "center" } }}
            >
              Pricing
            </Link>
          </nav>

          {/* Spacer */}
          <div style={{ flex: 1 }} />

          {/* Action buttons — desktop */}
          <div className="hidden md:flex items-center" style={{ gap: 8 }}>
            {loggedIn ? (
              <>
                <Link
                  to={hasPass ? "/dashboard" : "/my-reports"}
                  style={{
                    fontSize: 13,
                    fontWeight: 500,
                    color: "#F1EFE8",
                    background: "#2D6A4F",
                    borderRadius: 20,
                    padding: "7px 16px",
                    textDecoration: "none",
                    display: "inline-flex",
                    alignItems: "center",
                  }}
                >
                  Dashboard
                </Link>
                <UserMenu email={email!} hasPass={hasPass} />
              </>
            ) : (
              <>
                <Link
                  to="/buyer-login"
                  style={{
                    fontSize: 13,
                    color: "#1A1108",
                    background: "transparent",
                    border: "0.5px solid rgba(26,17,8,0.2)",
                    borderRadius: 20,
                    padding: "7px 14px",
                    textDecoration: "none",
                    display: "inline-flex",
                    alignItems: "center",
                  }}
                >
                  Login
                </Link>
                <Link
                  to="/"
                  style={{
                    fontSize: 13,
                    fontWeight: 500,
                    color: "#F1EFE8",
                    background: "#2D6A4F",
                    borderRadius: 20,
                    padding: "7px 16px",
                    textDecoration: "none",
                    display: "inline-flex",
                    alignItems: "center",
                  }}
                >
                  Get started
                </Link>
              </>
            )}
          </div>

          {/* Hamburger — mobile only */}
          <button
            type="button"
            className="md:hidden"
            onClick={() => setMobileOpen((v) => !v)}
            aria-label="Toggle menu"
            style={{ background: "none", border: "none", cursor: "pointer", padding: 6, color: "#1A1108", marginLeft: "auto" }}
          >
            {mobileOpen ? (
              <X style={{ width: 20, height: 20 }} />
            ) : (
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <path d="M3 5h14M3 10h14M3 15h14" stroke="#1A1108" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            )}
          </button>
        </div>

        {/* Mobile menu */}
        {mobileOpen && (
          <div
            className="md:hidden"
            style={{
              background: "#F1EFE8",
              borderTop: "0.5px solid rgba(26,17,8,0.08)",
              padding: "8px 16px 20px",
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              {/* vett Tools sub-items */}
              <div style={{ fontSize: 11, fontWeight: 500, color: "#888780", textTransform: "uppercase", letterSpacing: "0.06em", padding: "8px 10px 4px" }}>
                vett Tools
              </div>
              {TOOLS_ITEMS.map((item) => (
                <Link
                  key={item.to}
                  to={item.to}
                  onClick={() => setMobileOpen(false)}
                  style={{ fontSize: 13, color: "#5F5E5A", padding: "9px 10px 9px 20px", borderRadius: 8, textDecoration: "none", display: "block" }}
                >
                  {item.label}
                </Link>
              ))}
              <Link
                to="/blog/"
                onClick={() => setMobileOpen(false)}
                style={{ fontSize: 13, color: "#5F5E5A", padding: "10px 10px", borderRadius: 8, textDecoration: "none", display: "block" }}
                activeProps={{ style: { fontSize: 13, color: "#1A1108", padding: "10px 10px", borderRadius: 8, textDecoration: "none", display: "block" } }}
                activeOptions={{ includeChildMatches: true }}
              >
                Blog
              </Link>
              <Link
                to="/pricing"
                onClick={() => setMobileOpen(false)}
                style={{ fontSize: 13, color: "#5F5E5A", padding: "10px 10px", borderRadius: 8, textDecoration: "none", display: "block" }}
                activeProps={{ style: { fontSize: 13, color: "#1A1108", padding: "10px 10px", borderRadius: 8, textDecoration: "none", display: "block" } }}
              >
                Pricing
              </Link>
              {loggedIn ? (
                <Link
                  to={hasPass ? "/dashboard" : "/my-reports"}
                  onClick={() => setMobileOpen(false)}
                  style={{ fontSize: 13, color: "#5F5E5A", padding: "10px 10px", borderRadius: 8, textDecoration: "none", display: "block" }}
                >
                  Dashboard
                </Link>
              ) : (
                <Link
                  to="/buyer-login"
                  onClick={() => setMobileOpen(false)}
                  style={{ fontSize: 13, color: "#5F5E5A", padding: "10px 10px", borderRadius: 8, textDecoration: "none", display: "block" }}
                >
                  Login
                </Link>
              )}
            </div>
            {/* Get started CTA */}
            <div style={{ marginTop: 12 }}>
              <Link
                to="/"
                onClick={() => setMobileOpen(false)}
                style={{
                  display: "block",
                  textAlign: "center",
                  background: "#2D6A4F",
                  color: "#F1EFE8",
                  fontSize: 13,
                  fontWeight: 500,
                  borderRadius: 20,
                  padding: "10px 16px",
                  textDecoration: "none",
                }}
              >
                Get started
              </Link>
            </div>
          </div>
        )}
      </header>
    </>
  );
}

export function SiteFooter() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0, width: "100%", margin: 0, padding: 0, marginTop: "auto" }}>
      <div
        style={{
          background: "#F1EFE8",
          color: "#888780",
          fontSize: 11,
          fontWeight: 300,
          lineHeight: 1.65,
          textAlign: "center",
          padding: "14px 24px",
          width: "100%",
          margin: 0,
          display: "block",
          borderTop: "0.5px solid rgba(26,17,8,0.08)",
        }}
      >
        vett reports are AI-generated and advisory only. Always verify information independently and seek professional advice from a solicitor, surveyor, and mortgage broker before making any offer.
      </div>
      <footer
        style={{
          background: "#F1EFE8",
          margin: 0,
          padding: 0,
          display: "block",
          width: "100%",
          borderTop: "0.5px solid rgba(26,17,8,0.1)",
        }}
      >
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-10 sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <div className="flex items-center gap-2">
            
            <span style={{ fontFamily: "'Playfair Display', serif", fontSize: 22, fontWeight: 700, color: "#1A1108", letterSpacing: "-1px" }}>vett</span>
            <span style={{ fontSize: 12, color: "#888780", marginLeft: 12 }}>© 2026 vett</span>
          </div>
          <div className="flex flex-wrap gap-6" style={{ fontSize: 12, color: "#888780" }}>
            <Link to="/pricing" className="hover:text-[#1A1108] transition-colors">Pricing</Link>
            <Link to="/about" className="hover:text-[#1A1108] transition-colors">About</Link>
            <Link to="/faq" className="hover:text-[#1A1108] transition-colors">FAQ</Link>
            <Link to="/blog/" className="hover:text-[#1A1108] transition-colors">Blog</Link>
            <Link to="/tools/renovation-calculator" className="hover:text-[#1A1108] transition-colors">Renovation calculator</Link>
            <Link to="/privacy" className="hover:text-[#1A1108] transition-colors">Privacy</Link>
            <Link to="/terms" className="hover:text-[#1A1108] transition-colors">Terms</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
