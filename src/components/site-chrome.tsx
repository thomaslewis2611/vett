import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useRef, useState } from "react";
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
          cursor: "pointer",
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

// ── Nav constants ──────────────────────────────────────────────────────────────
const NAV_ITEMS: { label: string; to: string }[] = [
  { label: "Home",    to: "/" },
  { label: "Tools",   to: "/tools" },
  { label: "Pricing", to: "/pricing" },
  { label: "Blog",    to: "/blog/" },
];

function isNavActive(to: string, pathname: string): boolean {
  if (to === "/") return pathname === "/";
  if (to === "/blog/") return pathname === "/blog" || pathname.startsWith("/blog/");
  if (to === "/tools") return pathname === "/tools" || pathname.startsWith("/tools/");
  return pathname === to;
}

// ── Floating pill nav (desktop) + hamburger (mobile) ──────────────────────────
function NavPill({
  loggedIn,
  email,
  hasPass,
}: {
  loggedIn: boolean;
  email: string | null;
  hasPass: boolean;
}) {
  const routerState = useRouterState();
  const pathname = routerState.location.pathname;
  const navigate = useNavigate();

  const containerRef = useRef<HTMLDivElement>(null);
  const linkRefs = useRef<(HTMLAnchorElement | null)[]>([]);
  const [slider, setSlider] = useState({ left: 0, width: 0, opacity: 0 });
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(max-width: 767px)");
    setIsMobile(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  const moveSliderTo = (el: HTMLElement | null) => {
    if (!el || !containerRef.current) return;
    const cr = containerRef.current.getBoundingClientRect();
    const er = el.getBoundingClientRect();
    setSlider({ left: er.left - cr.left, width: er.width, opacity: 1 });
  };

  const restSlider = useCallback(() => {
    const activeIdx = NAV_ITEMS.findIndex((item) => isNavActive(item.to, pathname));
    if (activeIdx >= 0) {
      moveSliderTo(linkRefs.current[activeIdx]);
    } else {
      setSlider((s) => ({ ...s, opacity: 0 }));
    }
  }, [pathname]);

  useEffect(() => {
    restSlider();
  }, [restSlider]);

  // Close mobile menu on route change
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  const handleVettClick = () => {
    setMobileOpen(false);
    if (pathname === "/") {
      const form = document.getElementById("vett-form");
      const input = document.getElementById("url-input");
      if (form && input) {
        form.scrollIntoView({ behavior: "smooth", block: "center" });
        setTimeout(() => {
          input.focus();
          form.style.borderColor = "#2D6A4F";
          form.style.boxShadow = "0 0 0 3px rgba(45,106,79,0.2)";
          setTimeout(() => { form.style.borderColor = ""; form.style.boxShadow = ""; }, 900);
        }, 350);
      }
    } else {
      if (typeof sessionStorage !== "undefined") sessionStorage.setItem("vettFocusInput", "1");
      navigate({ to: "/" });
    }
  };

  return (
    <>
      {!isMobile ? (
        /* ── Desktop pill ── */
        <div
          style={{
            display: "flex",
            alignItems: "center",
            background: "rgba(255,253,249,0.95)",
            border: "0.5px solid rgba(26,17,8,0.10)",
            borderRadius: 100,
            padding: "5px 6px",
            gap: 2,
            backdropFilter: "blur(8px)",
          }}
        >
          {/* Magic-line nav links */}
          <div ref={containerRef} style={{ position: "relative", display: "flex", alignItems: "center" }}>
            <div aria-hidden style={{ position: "absolute", top: 0, bottom: 0, left: slider.left, width: slider.width, background: "#EAF3DE", borderRadius: 100, transition: "left 420ms cubic-bezier(0.4, 0.0, 0.2, 1), width 420ms cubic-bezier(0.4, 0.0, 0.2, 1), opacity 200ms ease", opacity: slider.opacity, pointerEvents: "none" }} />
            {NAV_ITEMS.map((item, i) => (
              <Link
                key={item.to}
                to={item.to as any}
                ref={(el) => { linkRefs.current[i] = el; }}
                onMouseEnter={() => moveSliderTo(linkRefs.current[i])}
                onMouseLeave={restSlider}
                style={{ fontSize: 13, fontWeight: isNavActive(item.to, pathname) ? 500 : 400, color: "#1A1108", padding: "7px 14px", borderRadius: 100, textDecoration: "none", position: "relative", zIndex: 1, display: "inline-flex", alignItems: "center", whiteSpace: "nowrap" }}
              >
                {item.label}
              </Link>
            ))}
          </div>

          <div style={{ width: 1, height: 16, background: "rgba(26,17,8,0.12)", margin: "0 4px", flexShrink: 0 }} />

          {loggedIn ? (
            <>
              <Link to={hasPass ? "/dashboard" : "/my-reports"} className="nav-acct-link" style={{ fontSize: 13, fontWeight: 500, color: "#2D6A4F", padding: "7px 12px", borderRadius: 100, textDecoration: "none", display: "inline-flex", alignItems: "center" }}>
                Dashboard
              </Link>
              <UserMenu email={email!} hasPass={hasPass} />
            </>
          ) : (
            <>
              <Link to="/buyer-login" className="nav-signin-link" style={{ fontSize: 13, color: "#888780", padding: "7px 12px", borderRadius: 100, textDecoration: "none", display: "inline-flex", alignItems: "center" }}>
                Sign in
              </Link>
              <button type="button" onClick={handleVettClick} className="nav-vett-cta" style={{ fontSize: 13, fontWeight: 500, color: "#1A1108", padding: "7px 14px", borderRadius: 100, display: "inline-flex", alignItems: "center", border: "0.5px solid rgba(26,17,8,0.15)", background: "transparent" }}>
                Vett a property →
              </button>
            </>
          )}
        </div>
      ) : (
        /* ── Mobile: hamburger + dropdown ── */
        <>
          <button
            type="button"
            onClick={() => setMobileOpen((v) => !v)}
            aria-label="Toggle menu"
            style={{ background: "rgba(255,253,249,0.95)", border: "0.5px solid rgba(26,17,8,0.10)", borderRadius: 100, padding: "9px 14px", display: "flex", alignItems: "center", cursor: "pointer", backdropFilter: "blur(8px)" }}
          >
            {mobileOpen ? (
              <X style={{ width: 18, height: 18, color: "#1A1108" }} />
            ) : (
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
                <path d="M2 5h14M2 9h14M2 13h14" stroke="#1A1108" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            )}
          </button>

          {mobileOpen && (
            <div style={{ position: "fixed", top: 72, left: 16, right: 16, zIndex: 50, background: "#FFFDF9", border: "0.5px solid rgba(26,17,8,0.10)", borderRadius: 16, padding: "10px 8px 14px", boxShadow: "0 8px 32px rgba(26,17,8,0.10)" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                {NAV_ITEMS.map((item) => (
                  <Link
                    key={item.to}
                    to={item.to as any}
                    onClick={() => setMobileOpen(false)}
                    style={{ fontSize: 14, color: isNavActive(item.to, pathname) ? "#1A1108" : "#5F5E5A", fontWeight: isNavActive(item.to, pathname) ? 500 : 400, padding: "10px 14px", borderRadius: 10, textDecoration: "none", display: "block", background: isNavActive(item.to, pathname) ? "#EAF3DE" : "transparent" }}
                  >
                    {item.label}
                  </Link>
                ))}
                <div style={{ height: "0.5px", background: "rgba(26,17,8,0.08)", margin: "6px 14px" }} />
                {loggedIn ? (
                  <Link to={hasPass ? "/dashboard" : "/my-reports"} onClick={() => setMobileOpen(false)} style={{ fontSize: 14, color: "#5F5E5A", padding: "10px 14px", borderRadius: 10, textDecoration: "none", display: "block" }}>
                    Dashboard
                  </Link>
                ) : (
                  <Link to="/buyer-login" onClick={() => setMobileOpen(false)} style={{ fontSize: 14, color: "#5F5E5A", padding: "10px 14px", borderRadius: 10, textDecoration: "none", display: "block" }}>
                    Sign in
                  </Link>
                )}
              </div>
              <div style={{ padding: "8px 6px 0" }}>
                <button type="button" onClick={handleVettClick} style={{ display: "block", width: "100%", textAlign: "center", background: "#1A1108", color: "#F1EFE8", fontSize: 13, fontWeight: 500, borderRadius: 100, padding: "11px 16px", border: "none" }}>
                  Vett a property →
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </>
  );
}

// ── SiteHeader ─────────────────────────────────────────────────────────────────
export function SiteHeader() {
  const { email, hasPass, ready } = useAuthUser();
  const loggedIn = ready && Boolean(email);
  const [wordmarkHovered, setWordmarkHovered] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(max-width: 767px)");
    setIsMobile(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  return (
    <>
      <style>{`
        .nav-acct-link { transition: background 150ms ease; }
        .nav-acct-link:hover { background: #EAF3DE !important; }
        .nav-signin-link { transition: color 150ms ease; }
        .nav-signin-link:hover { color: #1A1108 !important; }
        .nav-vett-cta { transition: background 150ms ease, color 150ms ease, border-color 150ms ease; }
        .nav-vett-cta:hover { background: #2D6A4F !important; color: #F1EFE8 !important; border-color: #2D6A4F !important; }
      `}</style>
      <header
        className="sticky top-0 z-40"
        style={{
          background: "transparent",
          pointerEvents: "none",
          height: 72,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            padding: "14px 20px",
            height: "100%",
            boxSizing: "border-box",
          }}
        >
          {/* Floating wordmark */}
          <Link
            to="/"
            onMouseEnter={() => setWordmarkHovered(true)}
            onMouseLeave={() => setWordmarkHovered(false)}
            style={{
              pointerEvents: "all",
              textDecoration: "none",
              display: "inline-flex",
              alignItems: "flex-start",
              lineHeight: 1,
            }}
          >
            <span
              style={{
                fontFamily: "'Playfair Display', Georgia, serif",
                fontSize: isMobile ? 40 : 64,
                fontWeight: 700,
                color: "#1A1108",
                letterSpacing: "-4px",
                lineHeight: 1,
                fontStyle: wordmarkHovered ? "italic" : "normal",
              }}
            >
              vett
            </span>
          </Link>

          {/* Floating pill nav */}
          <div style={{ pointerEvents: "all" }}>
            <NavPill loggedIn={loggedIn} email={email} hasPass={hasPass} />
          </div>
        </div>
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
