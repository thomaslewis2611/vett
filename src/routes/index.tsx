import { createFileRoute, useNavigate } from "@tanstack/react-router";
import React, { useEffect, useState } from "react";
import {
  ArrowRight,
  Link2,
  Check,
  AlertTriangle,
  PoundSterling,
  MessageSquare,
  Droplets,
  GraduationCap,
  BarChart3,
  Zap,
  ClipboardCheck,
  Wrench,
  UserCheck,
  Shield,
  Wifi,
  Train,
  MessageCircle,
  ListChecks,
  TrendingUp,
} from "lucide-react";
import { SiteHeader, SiteFooter } from "@/components/site-chrome";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "vett — Every listing. Analysed. Instantly." },
      {
        name: "description",
        content:
          "Paste any Rightmove listing and get an instant AI analysis. Red flags, true costs, value score and negotiation strategy in minutes. From £4.99.",
      },
      { property: "og:title", content: "vett — AI property analysis for smarter buyers" },
      {
        property: "og:description",
        content:
          "Paste any Rightmove listing and get an instant AI analysis. Red flags, true costs, value score and negotiation strategy in minutes. From £4.99.",
      },
      {
        name: "twitter:description",
        content:
          "Paste any Rightmove listing and get an instant AI analysis. Red flags, true costs, value score and negotiation strategy in minutes. From £4.99.",
      },
    ],
    links: [
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,500;0,700;1,400&family=Inter:wght@300;400;500&display=swap",
      },
    ],
  }),
  component: Index,
});

const HEADING_FONT = "'Playfair Display', Georgia, serif";
const BODY_FONT = "'Inter', -apple-system, BlinkMacSystemFont, sans-serif";

const COLORS = {
  bg: "#F1EFE8",
  card: "#FFFDF9",
  dark: "#1A1108",
  green: "#2D6A4F",
  greenLight: "#40916C",
  greenTint: "#EAF3DE",
  muted: "#5F5E5A",
  veryMuted: "#888780",
  border: "rgba(26,17,8,0.12)",
};

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 10,
        fontWeight: 500,
        textTransform: "uppercase",
        letterSpacing: "0.08em",
        color: COLORS.veryMuted,
        marginTop: 20,
        marginBottom: 10,
      }}
    >
      {children}
    </div>
  );
}

function Index() {
  const navigate = useNavigate();
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const handleAnalyse = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    const trimmed = url.trim();
    if (!trimmed) return;

    if (trimmed.length > 2000) {
      setError("That doesn't look like a valid listing URL");
      return;
    }

    const looksLikeUrl = /^https?:\/\//i.test(trimmed);
    const hasUrlIshDomain = /\.(co\.uk|com|net|org|io|uk)\b/i.test(trimmed);

    if (!looksLikeUrl && !hasUrlIshDomain) {
      navigate({ to: "/results", search: { text: trimmed } });
      return;
    }

    if (!looksLikeUrl) {
      setError("That doesn't look like a valid listing URL");
      return;
    }

    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch {
      setError("That doesn't look like a valid listing URL");
      return;
    }

    const isRightmove = /(^|\.)rightmove\.co\.uk$/i.test(parsed.hostname);
    if (!isRightmove) {
      setNotice("vett works best with Rightmove listings — other sites coming soon");
    }

    navigate({ to: "/results", search: { url: trimmed } });
  };

  const scrollToTop = () => {
    if (typeof window === "undefined") return;
    const el = document.getElementById("url-input");
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      setTimeout(() => el.focus(), 400);
    } else {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  useEffect(() => {
    // base body font
  }, []);

  return (
    <div
      className="flex min-h-screen flex-col"
      style={{ background: COLORS.bg, fontFamily: BODY_FONT, color: COLORS.dark }}
    >
      <SiteHeader />

      {/* 2. HERO — split layout */}
      <style>{`
        @keyframes vettTickerScroll {
          from { transform: translateX(0); }
          to { transform: translateX(-50%); }
        }
        .vett-hero-grid {
          display: grid;
          grid-template-columns: 1fr;
          gap: 48px;
          align-items: start;
        }
        .vett-hero-left { max-width: 640px; margin-left: auto; margin-right: auto; }
      `}</style>

      <section style={{ padding: "80px 24px 48px" }}>
        <div className="mx-auto vett-hero-grid" style={{ maxWidth: 1100 }}>
          {/* LEFT */}
          <div className="vett-hero-left text-center">
            <span
              className="inline-flex items-center gap-2"
              style={{
                background: COLORS.card,
                border: `0.5px solid ${COLORS.border}`,
                color: COLORS.muted,
                fontSize: 12,
                fontWeight: 400,
                borderRadius: 100,
                padding: "6px 14px",
              }}
            >
              <span
                aria-hidden
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: 999,
                  background: COLORS.green,
                  display: "inline-block",
                }}
              />
              AI-powered property analysis · UK only
            </span>

            <h1
              className="mt-7 text-balance"
              style={{
                fontFamily: HEADING_FONT,
                fontSize: "clamp(34px, 5vw, 48px)",
                fontWeight: 400,
                lineHeight: 1.1,
                color: COLORS.dark,
                letterSpacing: "-0.5px",
              }}
            >
              They market the dream.{" "}
              <em
                style={{
                  fontStyle: "italic",
                  fontWeight: 400,
                  color: COLORS.green,
                }}
              >
                We analyse the reality.
              </em>
            </h1>

            <p
              className="mt-6"
              style={{
                fontFamily: BODY_FONT,
                fontWeight: 300,
                fontSize: 16,
                color: COLORS.muted,
                lineHeight: 1.6,
              }}
            >
              Make your most important financial decision with confidence. vett gives you an
              independent analysis of any property listing — red flags, true costs, negotiation
              strategy and more — in under 2 minutes.
            </p>

            <form
              onSubmit={handleAnalyse}
              className="mt-8 flex items-center gap-2"
              style={{
                border: `1.5px solid ${COLORS.dark}`,
                borderRadius: 100,
                background: COLORS.card,
                padding: 4,
              }}
            >
              <div className="flex flex-1 items-center gap-2 px-4 min-w-0">
                <Link2 className="h-4 w-4 shrink-0" style={{ color: COLORS.veryMuted }} />
                <input
                  id="url-input"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="Paste a property listing URL…"
                  className="w-full bg-transparent py-2.5 outline-none"
                  style={{ fontSize: 14, color: COLORS.dark, fontFamily: BODY_FONT }}
                  aria-label="Property listing URL"
                />
              </div>
              <button
                type="submit"
                className="inline-flex items-center justify-center gap-2 transition-opacity hover:opacity-90"
                style={{
                  background: COLORS.green,
                  color: COLORS.card,
                  fontSize: 13,
                  fontWeight: 500,
                  borderRadius: 100,
                  padding: "12px 20px",
                }}
              >
                Analyse
                <ArrowRight className="h-4 w-4" />
              </button>
            </form>

            <a
              href="https://roovr.co/report/c462872f03a8353e41cd696c791d0a4a"
              target="_blank"
              rel="noopener noreferrer"
              style={{ fontSize: 13, color: "#2D6A4F", textDecoration: "underline", marginTop: 8, display: "inline-block" }}
            >
              View an example report →
            </a>

            {error && (
              <p role="alert" className="mt-3" style={{ fontSize: 12, color: "#993C1D" }}>
                {error}
              </p>
            )}
            {notice && !error && (
              <p role="status" className="mt-3" style={{ fontSize: 12, color: COLORS.muted }}>
                {notice}
              </p>
            )}

            <p className="mt-3" style={{ fontSize: 11, color: COLORS.veryMuted }}>
              Works best with Rightmove · More sites coming soon · UK properties only
            </p>

            <ul className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-2 justify-center">
              {[
                "From £4.99 · one-off",
                "No subscription",
                "Report in under 2 minutes",
              ].map((t) => (
                <li
                  key={t}
                  className="flex items-center gap-2"
                  style={{ fontSize: 12, color: COLORS.muted }}
                >
                  <span
                    className="inline-flex items-center justify-center"
                    style={{
                      width: 16,
                      height: 16,
                      borderRadius: 999,
                      background: COLORS.greenTint,
                    }}
                  >
                    <Check className="h-2.5 w-2.5" style={{ color: COLORS.green }} />
                  </span>
                  {t}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* 2b. SCROLLING DATA TICKER */}
      <div
        aria-hidden
        style={{
          background: "#F1EFE8",
          borderTop: "0.5px solid rgba(26,17,8,0.1)",
          borderBottom: "0.5px solid rgba(26,17,8,0.1)",
          padding: "14px 0",
          overflow: "hidden",
          WebkitMaskImage:
            "linear-gradient(to right, transparent 0%, black 8%, black 92%, transparent 100%)",
          maskImage:
            "linear-gradient(to right, transparent 0%, black 8%, black 92%, transparent 100%)",
        }}
      >
        <div
          style={{
            display: "flex",
            width: "max-content",
            animation: "vettTickerScroll 35s linear infinite",
          }}
        >
          {[0, 1].map((dup) => (
            <div
              key={dup}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 32,
                paddingRight: 32,
                whiteSpace: "nowrap",
              }}
            >
              {[
                "Epping CM16 · £516/sqft · 7.7% below area avg",
                "Woodford Green IG8 · £539/sqft · 79 days on market",
                "Walthamstow E17 · £839/sqft · 10.4% above area avg",
                "Epping CM16 · Score 8.0 · Good Buy",
                "Woodford Green IG8 · Score 7.8 · Good Buy",
                "Chingford E4 · £425/sqft · 3 red flags found",
                "Epping CM16 · £524/sqft · 19.1% below area avg",
                "Walthamstow E17 · Score 6.8 · Solid with Caveats",
              ].map((item, i) => (
                <span
                  key={`${dup}-${i}`}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 32,
                    fontFamily: BODY_FONT,
                    fontSize: 12,
                    color: COLORS.muted,
                    whiteSpace: "nowrap",
                  }}
                >
                  <span style={{ color: COLORS.green }}>●</span>
                  {item}
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* 3. STATS BAR */}
      <section
        style={{
          background: COLORS.bg,
          borderTop: `0.5px solid ${COLORS.border}`,
          borderBottom: `0.5px solid ${COLORS.border}`,
        }}
      >
        <div className="mx-auto grid max-w-5xl grid-cols-1 sm:grid-cols-3">
          {[
            { value: "100+", label: "Data points per report" },
            { value: "<2 min", label: "Average analysis time" },
            { value: "£4.99", label: "Starting price · one-off" },
          ].map((s, i) => (
            <div
              key={s.label}
              className="flex flex-col items-center justify-center px-8 py-10 text-center"
              style={{
                minHeight: 140,
                borderLeft:
                  i === 0 ? "none" : `0.5px solid ${COLORS.border}`,
              }}
            >
              <div
                style={{
                  fontFamily: HEADING_FONT,
                  fontSize: 40,
                  fontWeight: 400,
                  color: COLORS.dark,
                  letterSpacing: "-1px",
                  lineHeight: 1.1,
                }}
              >
                {s.value}
              </div>
              <div className="mt-2" style={{ fontSize: 12, color: COLORS.veryMuted }}>
                {s.label}
              </div>
            </div>
          ))}
        </div>
      </section>

      <hr style={{ border: "none", borderTop: "0.5px solid rgba(26,17,8,0.1)", margin: 0 }} />

      {/* 3b. EXAMPLE REPORTS */}
      <section className="mx-auto px-6" style={{ maxWidth: 1100, padding: "80px 24px" }}>
        <div className="text-center" style={{ marginBottom: 40 }}>
          <div
            className="uppercase"
            style={{
              fontSize: 11,
              fontWeight: 500,
              letterSpacing: "0.1em",
              color: COLORS.green,
              marginBottom: 12,
            }}
          >
            Example reports
          </div>
          <h2
            style={{
              fontFamily: HEADING_FONT,
              fontSize: 36,
              fontWeight: 400,
              color: COLORS.dark,
              letterSpacing: "-1px",
              lineHeight: 1.1,
            }}
          >
            See exactly what you get.
          </h2>
        </div>
        <p style={{ fontSize: 13, color: "#5F5E5A", marginTop: -24, marginBottom: 16, textAlign: "center" }}>
          Condensed previews shown below.{" "}
          <a
            href="https://roovr.co/report/c462872f03a8353e41cd696c791d0a4a"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: "#2D6A4F", textDecoration: "underline" }}
          >
            View a full example report →
          </a>
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2" style={{ gap: 24 }}>
          <SampleReportCard data={SAMPLE_A} />
          <SampleReportCard data={SAMPLE_B} />
        </div>
      </section>

      <hr style={{ border: "none", borderTop: "0.5px solid rgba(26,17,8,0.1)", margin: 0 }} />

      {/* 4. WHAT'S INCLUDED */}
      <section className="mx-auto px-6" style={{ maxWidth: 960, padding: "80px 24px" }}>
        <div className="text-center">
          <div
            className="uppercase"
            style={{
              fontSize: 11,
              fontWeight: 500,
              letterSpacing: "0.1em",
              color: COLORS.green,
            }}
          >
            What's included
          </div>
          <h2
            className="mt-3"
            style={{
              fontFamily: HEADING_FONT,
              fontSize: "clamp(28px, 4vw, 38px)",
              fontWeight: 400,
              color: COLORS.dark,
              letterSpacing: "-0.5px",
              lineHeight: 1.15,
            }}
          >
            Everything you need to know before you offer.
          </h2>
        </div>

        <div
          className="mt-12 grid grid-cols-2 md:grid-cols-4"
          style={{ gap: 16 }}
        >
          {[
            { icon: AlertTriangle, title: "Full red flag analysis", body: "Every risk identified and explained, ranked by severity" },
            { icon: Zap, title: "EPC analysis", body: "Energy rating, estimated annual costs and upgrade recommendations" },
            { icon: BarChart3, title: "Area pricing analysis", body: "Local £/sqft data so you know if the price is fair" },
            { icon: TrendingUp, title: "Local price trends", body: "1yr, 3yr and 5yr price movement in the local area" },
            { icon: PoundSterling, title: "True cost breakdown", body: "Every cost including stamp duty, surveys and legal fees" },
            { icon: MessageSquare, title: "Negotiation strategy", body: "A recommended offer range with specific leverage points" },
            { icon: ClipboardCheck, title: "Viewing checklist", body: "Property-specific questions and checks for the day" },
            { icon: Wrench, title: "Renovation cost estimator", body: "Estimated costs for any work identified in the listing" },
            { icon: UserCheck, title: "Seller motivation score", body: "How urgently the seller needs to move" },
            { icon: Droplets, title: "Flood risk assessment", body: "Environment Agency data for this exact postcode" },
            { icon: GraduationCap, title: "Nearby schools", body: "Local primary and secondary schools with Ofsted ratings" },
            { icon: Shield, title: "Crime statistics", body: "Crime levels recorded within 1 mile of the property" },
            { icon: Wifi, title: "Broadband & connectivity", body: "Download speeds and full fibre availability" },
            { icon: Train, title: "Transport links", body: "PTAL accessibility score for London properties" },
            { icon: ListChecks, title: "Recommended next steps", body: "Exactly what to do next, in priority order" },
            { icon: MessageCircle, title: "AI chat", body: "Ask anything about the property — Buyer Pass only" },
          ].map((f) => (
            <div
              key={f.title}
              style={{
                background: "#FFFDF9",
                border: `0.5px solid ${COLORS.border}`,
                borderRadius: 20,
                padding: 16,
              }}
            >
              <div
                className="flex items-center justify-center"
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 8,
                  background: COLORS.greenTint,
                }}
              >
                <f.icon className="h-4 w-4" style={{ color: COLORS.green }} />
              </div>
              <h3
                className="mt-5"
                style={{ fontSize: 14, fontWeight: 500, color: COLORS.dark }}
              >
                {f.title}
              </h3>
              <p
                className="mt-2"
                style={{ fontSize: 12, fontWeight: 300, color: COLORS.muted, lineHeight: 1.6 }}
              >
                {f.body}
              </p>
            </div>
          ))}
        </div>
      </section>

      <hr style={{ border: "none", borderTop: "0.5px solid rgba(26,17,8,0.1)", margin: 0 }} />

      {/* 6. HOW IT WORKS */}
      <section style={{ background: COLORS.bg, padding: "80px 24px" }}>
        <div className="mx-auto" style={{ maxWidth: 960 }}>
          <div className="text-center">
            <div
              className="uppercase"
              style={{
                fontSize: 11,
                fontWeight: 500,
                letterSpacing: "0.1em",
                color: COLORS.green,
              }}
            >
              How it works
            </div>
            <h2
              className="mt-3"
              style={{
                fontFamily: HEADING_FONT,
                fontSize: "clamp(28px, 4vw, 38px)",
                fontWeight: 400,
                color: COLORS.dark,
                letterSpacing: "-0.5px",
                lineHeight: 1.15,
              }}
            >
              Three steps. Two minutes. One clear picture.
            </h2>
          </div>

          <div className="mt-14 grid grid-cols-1 md:grid-cols-3" style={{ gap: 32 }}>
            {[
              {
                n: "01",
                title: "Paste the listing URL",
                body: "Copy the listing URL and paste it into vett. We fetch the listing, read every word of the agent description, and check local data sources.",
              },
              {
                n: "02",
                title: "We analyse it",
                body: "Our AI cross-references the listing against flood risk data, Ofsted ratings, crime stats, sold prices and broadband speeds. Takes under 2 minutes.",
              },
              {
                n: "03",
                title: "Get your report",
                body: "A full report with your vett score, red flags, true costs and negotiation strategy. Unlock it with a one-off £4.99 payment — no subscription.",
              },
            ].map((s) => (
              <div key={s.n}>
                <div
                  style={{
                    fontFamily: HEADING_FONT,
                    fontSize: 48,
                    fontWeight: 400,
                    color: "rgba(26,17,8,0.1)",
                    lineHeight: 1,
                  }}
                >
                  {s.n}
                </div>
                <h3
                  className="mt-4"
                  style={{ fontSize: 15, fontWeight: 500, color: COLORS.dark }}
                >
                  {s.title}
                </h3>
                <p
                  className="mt-2"
                  style={{ fontSize: 13, fontWeight: 300, color: COLORS.muted, lineHeight: 1.65 }}
                >
                  {s.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <hr style={{ border: "none", borderTop: "0.5px solid rgba(26,17,8,0.1)", margin: 0 }} />

      {/* 7. PRICING */}
      <section style={{ background: "#1a2820", padding: "80px 24px" }}>
        <div className="mx-auto text-center" style={{ maxWidth: 800 }}>
          <div
            className="uppercase"
            style={{
              fontSize: 11,
              fontWeight: 500,
              letterSpacing: "0.1em",
              color: COLORS.greenLight,
            }}
          >
            Pricing
          </div>
          <h2
            className="mt-3"
            style={{
              fontFamily: HEADING_FONT,
              fontSize: "clamp(28px, 4vw, 38px)",
              fontWeight: 400,
              color: COLORS.bg,
              letterSpacing: "-0.5px",
              lineHeight: 1.15,
            }}
          >
            Simple, honest pricing
          </h2>
          <p
            className="mx-auto mt-5"
            style={{ fontSize: 15, fontWeight: 300, color: "rgba(241,239,232,0.7)", lineHeight: 1.6 }}
          >
            One-time payments. No auto-renewals, no hidden fees.
          </p>
        </div>

        <div
          className="mx-auto mt-12 grid grid-cols-1 md:grid-cols-2"
          style={{ maxWidth: 800, gap: 16 }}
        >
          {/* Single Report */}
          <div
            style={{
              background: "rgba(255,255,255,0.06)",
              border: "0.5px solid rgba(241,239,232,0.15)",
              borderRadius: 16,
              padding: 32,
            }}
          >
            <div
              className="uppercase"
              style={{
                fontSize: 11,
                fontWeight: 500,
                letterSpacing: "0.1em",
                color: "rgba(241,239,232,0.45)",
              }}
            >
              Single Report
            </div>
            <div
              className="mt-3"
              style={{
                fontFamily: HEADING_FONT,
                fontSize: 44,
                fontWeight: 400,
                color: COLORS.bg,
                letterSpacing: "-1px",
                lineHeight: 1,
              }}
            >
              £4.99
            </div>
            <div className="mt-2" style={{ fontSize: 12, color: "rgba(241,239,232,0.35)" }}>
              One property · one-off payment
            </div>
            <ul className="mt-6 flex flex-col gap-3">
              {[
                "Full analysis with all red flags",
                "EPC analysis",
                "Area pricing analysis",
                "Local price trends",
                "True cost breakdown and stamp duty",
                "Negotiation strategy and recommended offer",
                "Viewing checklist — specific to this property",
                "Renovation cost estimator",
                "Seller motivation score",
                "Flood risk assessment",
                "Nearby schools with Ofsted ratings",
                "Crime statistics",
                "Broadband and internet speed",
                "Transport links (London properties only)",
                "Recommended next steps",
                "Report saved to your account",
                "Email your report to you",
              ].map((f) => (
                <li
                  key={f}
                  className="flex items-center gap-3"
                  style={{ fontSize: 13, color: "rgba(241,239,232,0.65)" }}
                >
                  <span
                    className="inline-flex items-center justify-center"
                    style={{
                      width: 16,
                      height: 16,
                      borderRadius: 999,
                      background: "rgba(255,255,255,0.08)",
                    }}
                  >
                    <Check
                      className="h-2.5 w-2.5"
                      style={{ color: "rgba(241,239,232,0.7)" }}
                    />
                  </span>
                  {f}
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={scrollToTop}
              className="mt-8 inline-flex w-full items-center justify-center transition-opacity hover:opacity-90"
              style={{
                background: "transparent",
                border: "0.5px solid rgba(241,239,232,0.25)",
                color: COLORS.bg,
                fontSize: 13,
                fontWeight: 500,
                borderRadius: 100,
                padding: "12px 24px",
              }}
            >
              Get this report
            </button>
          </div>

          {/* Buyer Pass */}
          <div
            className="relative"
            style={{
              background: COLORS.green,
              borderRadius: 16,
              padding: 32,
            }}
          >
            <div
              className="absolute left-1/2 -translate-x-1/2 uppercase"
              style={{
                top: -12,
                background: COLORS.bg,
                color: COLORS.dark,
                fontSize: 10,
                fontWeight: 500,
                letterSpacing: "0.1em",
                borderRadius: 100,
                padding: "5px 12px",
              }}
            >
              Most popular
            </div>
            <div
              className="uppercase"
              style={{
                fontSize: 11,
                fontWeight: 500,
                letterSpacing: "0.1em",
                color: "rgba(241,239,232,0.55)",
              }}
            >
              Buyer Pass
            </div>
            <div
              className="mt-3"
              style={{
                fontFamily: HEADING_FONT,
                fontSize: 44,
                fontWeight: 400,
                color: COLORS.bg,
                letterSpacing: "-1px",
                lineHeight: 1,
              }}
            >
              £24.99
            </div>
            <div className="mt-2" style={{ fontSize: 12, color: "rgba(241,239,232,0.45)" }}>
              90 days · unlimited analyses
            </div>
            <ul className="mt-6 flex flex-col gap-3">
              {[
                "Everything in Single Report",
                "Unlimited analyses for 90 days",
                "AI chat on every property",
                "Side-by-side property comparison with AI verdict",
                "All reports saved to dashboard",
              ].map((f) => (
                <li
                  key={f}
                  className="flex items-center gap-3"
                  style={{ fontSize: 13, color: "rgba(241,239,232,0.85)" }}
                >
                  <span
                    className="inline-flex items-center justify-center"
                    style={{
                      width: 16,
                      height: 16,
                      borderRadius: 999,
                      background: "rgba(255,255,255,0.2)",
                    }}
                  >
                    <Check className="h-2.5 w-2.5" style={{ color: COLORS.bg }} />
                  </span>
                  {f}
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={() => navigate({ to: "/pricing" })}
              className="mt-8 inline-flex w-full items-center justify-center transition-opacity hover:opacity-90"
              style={{
                background: COLORS.bg,
                color: COLORS.dark,
                fontSize: 13,
                fontWeight: 500,
                borderRadius: 100,
                padding: "12px 24px",
              }}
            >
              Get Buyer Pass
            </button>
          </div>
        </div>
      </section>

      <hr style={{ border: "none", borderTop: "0.5px solid rgba(26,17,8,0.1)", margin: 0 }} />

      {/* 8. FOOTER CTA */}
      <section style={{ background: COLORS.bg, padding: "100px 24px" }}>
        <div className="mx-auto text-center" style={{ maxWidth: 640 }}>
          <h2
            style={{
              fontFamily: HEADING_FONT,
              fontSize: "clamp(32px, 5vw, 44px)",
              fontWeight: 400,
              color: COLORS.dark,
              letterSpacing: "-0.5px",
              lineHeight: 1.1,
            }}
          >
            Stop guessing.
            <br />
            <em style={{ fontStyle: "italic", color: COLORS.green }}>Start knowing.</em>
          </h2>
          <p
            className="mx-auto mt-5"
            style={{
              fontSize: 15,
              fontWeight: 300,
              color: COLORS.muted,
              lineHeight: 1.65,
              maxWidth: 520,
            }}
          >
            You wouldn't make a decision involving hundreds of thousands of pounds without doing
            your research. vett does it in two minutes, for £4.99.
          </p>
          <button
            type="button"
            onClick={scrollToTop}
            className="mt-7 inline-flex items-center gap-2 transition-opacity hover:opacity-90"
            style={{
              background: COLORS.green,
              color: COLORS.card,
              fontSize: 13,
              fontWeight: 500,
              borderRadius: 100,
              padding: "14px 26px",
            }}
          >
            Analyse your first property →
          </button>
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}

type SampleData = {
  meta: string;
  address: string;
  price: string;
  score: number;
  ppsfThis: string;
  ppsfArea: string;
  vsArea: string;
  vsAreaPositive: boolean;
  barFill: number; // 0-100
  barCompare: number; // 0-100
  pricingNote: string;
  flags: { sev: "HIGH" | "MEDIUM" | "LOW"; text: string }[];
  metrics: { label: string; val: string; positive?: boolean }[];
  footnote: string;
};

function SampleReportCard({ data }: { data: SampleData }) {
  return (
    <div
      style={{
        background: COLORS.card,
        border: `0.5px solid ${COLORS.border}`,
        borderRadius: 20,
        padding: 24,
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div
            className="uppercase"
            style={{
              fontSize: 11,
              fontWeight: 500,
              letterSpacing: "0.1em",
              color: COLORS.green,
              marginBottom: 6,
            }}
          >
            {data.meta}
          </div>
          <div
            style={{
              fontFamily: HEADING_FONT,
              fontSize: 20,
              fontWeight: 400,
              color: COLORS.dark,
              letterSpacing: "-0.3px",
              lineHeight: 1.2,
            }}
          >
            {data.address}
          </div>
          <div
            className="mt-1"
            style={{
              fontFamily: HEADING_FONT,
              fontSize: 26,
              fontWeight: 400,
              color: COLORS.dark,
              letterSpacing: "-0.5px",
            }}
          >
            {data.price}
          </div>
        </div>
        <div
          className="shrink-0 text-center"
          style={{
            background: COLORS.card,
            border: `0.5px solid rgba(26,17,8,0.12)`,
            borderRadius: 14,
            padding: "12px 14px",
            minWidth: 92,
          }}
        >
          <div
            className="uppercase"
            style={{ fontSize: 8, fontWeight: 500, letterSpacing: "0.12em", color: COLORS.veryMuted, marginBottom: 4 }}
          >
            vett Score
          </div>
          <div
            style={{
              fontFamily: HEADING_FONT,
              fontSize: 32,
              fontWeight: 400,
              color: COLORS.green,
              lineHeight: 1,
            }}
          >
            {data.score.toFixed(1)}
          </div>
          <div style={{ fontSize: 9, color: COLORS.veryMuted, marginTop: 2 }}>out of 10</div>
        </div>
      </div>

      {/* Area pricing */}
      <div
        className="mt-4"
        style={{ background: COLORS.bg, borderRadius: 10, padding: "14px 16px" }}
      >
        <div
          className="uppercase"
          style={{ fontSize: 10, fontWeight: 500, letterSpacing: "0.1em", color: COLORS.veryMuted }}
        >
          Area pricing analysis
        </div>
        <div className="mt-3 grid grid-cols-3 gap-3">
          {[
            { label: "This property", val: data.ppsfThis, sub: "per sq ft", color: COLORS.dark, subColor: COLORS.veryMuted },
            { label: "Area average", val: data.ppsfArea, sub: "per sq ft", color: COLORS.dark, subColor: COLORS.veryMuted },
            {
              label: "Vs area avg",
              val: data.vsArea,
              sub: data.vsAreaPositive ? "above average" : "below average",
              color: data.vsAreaPositive ? "#A32D2D" : COLORS.green,
              subColor: data.vsAreaPositive ? "#A32D2D" : COLORS.green,
            },
          ].map((m) => (
            <div key={m.label}>
              <div style={{ fontSize: 10, color: COLORS.veryMuted }}>{m.label}</div>
              <div
                className="mt-0.5"
                style={{ fontFamily: HEADING_FONT, fontSize: 18, color: m.color, fontWeight: 400 }}
              >
                {m.val}
              </div>
              <div style={{ fontSize: 10, color: m.subColor }}>{m.sub}</div>
            </div>
          ))}
        </div>
        <div
          className="relative mt-3"
          style={{ background: "rgba(26,17,8,0.08)", height: 6, borderRadius: 999, overflow: "hidden" }}
        >
          <div
            style={{
              position: "absolute",
              inset: 0,
              width: `${data.barFill}%`,
              background: COLORS.green,
              borderRadius: 999,
            }}
          />
          <div
            style={{
              position: "absolute",
              inset: 0,
              width: `${data.barCompare}%`,
              background: data.vsAreaPositive ? "#A32D2D" : COLORS.green,
              opacity: 0.5,
              borderRadius: 999,
            }}
          />
        </div>
        <p className="mt-3" style={{ fontSize: 10, color: COLORS.muted, lineHeight: 1.55 }}>
          {data.pricingNote}
        </p>
      </div>

      {/* Red flags */}
      <div
        className="mt-4 uppercase"
        style={{ fontSize: 10, fontWeight: 500, letterSpacing: "0.1em", color: COLORS.veryMuted }}
      >
        Red flags
      </div>
      <div className="mt-2 flex flex-col gap-2">
        {data.flags.map((f, i) => {
          const sty =
            f.sev === "HIGH"
              ? { bg: "#A32D2D", fg: "#FFFDF9" }
              : f.sev === "MEDIUM"
              ? { bg: "#C8862A", fg: "#FFFDF9" }
              : { bg: "rgba(26,17,8,0.12)", fg: COLORS.dark };
          return (
            <div key={i} className="flex items-start gap-2">
              <span
                style={{
                  background: sty.bg,
                  color: sty.fg,
                  fontSize: 9,
                  fontWeight: 500,
                  letterSpacing: "0.05em",
                  borderRadius: 4,
                  padding: "3px 6px",
                  marginTop: 1,
                  flexShrink: 0,
                }}
              >
                {f.sev}
              </span>
              <span style={{ fontSize: 11, color: COLORS.muted, lineHeight: 1.55 }}>{f.text}</span>
            </div>
          );
        })}
      </div>

      {/* Bottom metrics */}
      <div className="mt-4 grid grid-cols-3 gap-2">
        {data.metrics.map((m) => (
          <div
            key={m.label}
            style={{ background: COLORS.bg, borderRadius: 10, padding: "10px 12px" }}
          >
            <div style={{ fontSize: 10, color: COLORS.veryMuted }}>{m.label}</div>
            <div
              className="mt-0.5"
              style={{ fontSize: 13, fontWeight: 500, color: m.positive ? COLORS.green : COLORS.dark }}
            >
              {m.val}
            </div>
          </div>
        ))}
      </div>

      <p className="mt-4" style={{ fontSize: 10, color: COLORS.veryMuted, marginTop: "auto", paddingTop: 12 }}>
        {data.footnote}
      </p>
    </div>
  );
}

const SAMPLE_A: SampleData = {
  meta: "4 bed · End of terrace · Epping CM16",
  address: "33 Upper Swaines, Epping",
  price: "£695,000",
  score: 8.0,
  ppsfThis: "£516",
  ppsfArea: "£559",
  vsArea: "−7.7%",
  vsAreaPositive: false,
  barFill: 65,
  barCompare: 72,
  pricingNote:
    "At 1,347 sq ft, this property is priced 7.7% below the local sold average — competitive for an extended end-terrace with a 50ft garden.",
  flags: [
    { sev: "LOW", text: "Single bathroom for four-bedroom family home" },
    { sev: "LOW", text: "EPC D rating — future running costs and rental standards" },
    { sev: "LOW", text: "Price reduction after 57 days indicates modest seller urgency" },
  ],
  metrics: [
    { label: "Stamp duty", val: "£24,750" },
    { label: "Flood risk", val: "Low", positive: true },
    { label: "Monthly est.", val: "£3,370" },
  ],
  footnote: "Based on a real CM16 listing · Area data from Land Registry",
};

const SAMPLE_B: SampleData = {
  meta: "3 bed · Terraced · Walthamstow E17",
  address: "Guildford Road, Walthamstow",
  price: "£550,000",
  score: 7.4,
  ppsfThis: "£419",
  ppsfArea: "£467",
  vsArea: "−10.3%",
  vsAreaPositive: false,
  barFill: 62,
  barCompare: 70,
  pricingNote:
    "At 1,314 sq ft, this property sits 10.3% below the local sold average — good value for a Victorian terrace with large garden and extension potential.",
  flags: [
    { sev: "LOW", text: "Loft room documentation not confirmed — request building regs certificate" },
    { sev: "LOW", text: "Guide price format — confirm standard sale not auction" },
  ],
  metrics: [
    { label: "Stamp duty", val: "£17,500" },
    { label: "Flood risk", val: "Low", positive: true },
    { label: "Monthly est.", val: "£2,620" },
  ],
  footnote: "Based on a real E17 listing · Area data from Land Registry",
};
