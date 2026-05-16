import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
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
} from "lucide-react";
import { SiteHeader, SiteFooter } from "@/components/site-chrome";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Roovr — Every listing. Analysed. Instantly." },
      {
        name: "description",
        content:
          "Paste any Rightmove listing and get an instant AI analysis. Red flags, true costs, value score and negotiation strategy in minutes. From £4.99.",
      },
      { property: "og:title", content: "Roovr — AI property analysis for smarter buyers" },
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
        href: "https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,500;1,400&family=Inter:wght@300;400;500&display=swap",
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
      setNotice("Roovr works best with Rightmove listings — other sites coming soon");
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

      {/* 2. HERO */}
      <section style={{ padding: "80px 24px 64px" }}>
        <div className="mx-auto text-center" style={{ maxWidth: 800 }}>
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
              fontSize: "clamp(34px, 6vw, 56px)",
              fontWeight: 400,
              lineHeight: 1.1,
              color: COLORS.dark,
              letterSpacing: "-0.5px",
            }}
          >
            You're about to spend £400,000.{" "}
            <em
              style={{
                fontStyle: "italic",
                fontWeight: 400,
                color: COLORS.green,
              }}
            >
              Know what you're buying.
            </em>
          </h1>

          <p
            className="mx-auto mt-6"
            style={{
              fontFamily: BODY_FONT,
              fontWeight: 300,
              fontSize: 16,
              color: COLORS.muted,
              maxWidth: 520,
              lineHeight: 1.6,
            }}
          >
            Paste any Rightmove listing. Get red flags, true costs, a negotiation strategy,
            flood risk, local schools and more — in under 2 minutes.
          </p>

          <form
            onSubmit={handleAnalyse}
            className="mx-auto mt-10 flex items-center gap-2"
            style={{
              maxWidth: 640,
              border: `1.5px solid ${COLORS.dark}`,
              borderRadius: 100,
              background: COLORS.card,
              padding: 4,
            }}
          >
            <div className="flex flex-1 items-center gap-2 px-4">
              <Link2 className="h-4 w-4 shrink-0" style={{ color: COLORS.veryMuted }} />
              <input
                id="url-input"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="Paste a Rightmove listing URL…"
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
                padding: "12px 24px",
              }}
            >
              Analyse
              <ArrowRight className="h-4 w-4" />
            </button>
          </form>

          {error && (
            <p role="alert" className="mx-auto mt-3" style={{ fontSize: 12, color: "#993C1D" }}>
              {error}
            </p>
          )}
          {notice && !error && (
            <p role="status" className="mx-auto mt-3" style={{ fontSize: 12, color: COLORS.muted }}>
              {notice}
            </p>
          )}

          <p className="mx-auto mt-3" style={{ fontSize: 11, color: COLORS.veryMuted }}>
            Works best with Rightmove · More sites coming soon · UK properties only
          </p>

          <ul className="mx-auto mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
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
      </section>

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
            Everything your estate agent won't tell you
          </h2>
        </div>

        <div
          className="mt-12 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3"
          style={{
            background: COLORS.card,
            borderRadius: 16,
            overflow: "hidden",
            border: `0.5px solid ${COLORS.border}`,
          }}
        >
          {[
            {
              icon: AlertTriangle,
              title: "Red flags",
              body: "We translate agent jargon into honest issues. \u201CScope to modernise\u201D means dated. We say so.",
            },
            {
              icon: PoundSterling,
              title: "True cost breakdown",
              body: "Purchase price, stamp duty, legal fees, monthly mortgage — what you'll actually pay.",
            },
            {
              icon: MessageSquare,
              title: "Negotiation strategy",
              body: "Recommended offer range, your leverage points, and exactly what to say to the agent.",
            },
            {
              icon: Droplets,
              title: "Flood risk",
              body: "Environment Agency data — insurance implications, mortgage risks, and what to check.",
            },
            {
              icon: GraduationCap,
              title: "Nearby schools",
              body: "Ofsted ratings for primary and secondary schools within 5 miles of the property.",
            },
            {
              icon: BarChart3,
              title: "Area pricing analysis",
              body: "Local sold £/sqft, capital growth, and how this property compares to recent sales.",
            },
          ].map((f) => (
            <div
              key={f.title}
              style={{
                padding: 28,
                borderRight: `0.5px solid ${COLORS.border}`,
                borderBottom: `0.5px solid ${COLORS.border}`,
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

      {/* 5. SAMPLE REPORT */}
      <section
        style={{
          background: COLORS.card,
          borderTop: `0.5px solid ${COLORS.border}`,
          borderBottom: `0.5px solid ${COLORS.border}`,
          padding: "80px 24px",
        }}
      >
        <div
          className="mx-auto grid grid-cols-1 md:grid-cols-2"
          style={{ maxWidth: 960, gap: 64, alignItems: "center" }}
        >
          <div>
            <div
              className="uppercase"
              style={{
                fontSize: 11,
                fontWeight: 500,
                letterSpacing: "0.1em",
                color: COLORS.green,
              }}
            >
              Sample report
            </div>
            <h2
              className="mt-3"
              style={{
                fontFamily: HEADING_FONT,
                fontSize: "clamp(26px, 4vw, 36px)",
                fontWeight: 400,
                color: COLORS.dark,
                letterSpacing: "-0.5px",
                lineHeight: 1.15,
              }}
            >
              See exactly what you get before you pay
            </h2>
            <p
              className="mt-5"
              style={{ fontSize: 14, fontWeight: 300, color: COLORS.muted, lineHeight: 1.7 }}
            >
              Every report is tailored to the specific listing — not a generic checklist. We
              read the agent copy, spot the euphemisms, and cross-reference real local data.
            </p>
            <p
              className="mt-3"
              style={{ fontSize: 14, fontWeight: 300, color: COLORS.muted, lineHeight: 1.7 }}
            >
              The price per square foot analysis alone can tell you whether you're paying a
              fair price — or overpaying by tens of thousands.
            </p>
            <button
              type="button"
              onClick={scrollToTop}
              className="mt-6 inline-flex items-center gap-2 transition-opacity hover:opacity-90"
              style={{
                background: COLORS.green,
                color: COLORS.card,
                fontSize: 13,
                fontWeight: 500,
                borderRadius: 100,
                padding: "12px 22px",
              }}
            >
              View full sample report →
            </button>
          </div>

          <SampleReportCard />
        </div>
      </section>

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
                body: "Copy the Rightmove link and paste it into Roovr. We fetch the listing, read every word of the agent copy, and check local data sources.",
              },
              {
                n: "02",
                title: "We analyse it",
                body: "Our AI cross-references the listing against flood risk data, Ofsted ratings, crime stats, sold prices and broadband speeds. Takes under 2 minutes.",
              },
              {
                n: "03",
                title: "Get your report",
                body: "A full report with your Roovr score, red flags, true costs and negotiation strategy. Unlock it with a one-off £4.99 payment — no subscription.",
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

      {/* 7. PRICING */}
      <section style={{ background: COLORS.dark, padding: "80px 24px" }}>
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
            One-off. No subscription. No surprises.
          </h2>
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
                "Full red flag analysis",
                "True cost breakdown",
                "Negotiation strategy",
                "Flood risk, schools, crime",
                "Saved to your account",
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
                "Compare your shortlist",
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
            You wouldn't make a £400,000 decision without doing your research. Roovr does it
            in two minutes, for £4.99.
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

function SampleReportCard() {
  const score = 7.4;
  const pct = (score / 10) * 100;
  return (
    <div
      style={{
        background: COLORS.card,
        border: `0.5px solid ${COLORS.border}`,
        borderRadius: 16,
        padding: 24,
      }}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div style={{ fontSize: 12, color: COLORS.veryMuted }}>
            3 bed · Flat · Clapham SW11
          </div>
          <div
            className="mt-1"
            style={{
              fontFamily: HEADING_FONT,
              fontSize: 24,
              fontWeight: 400,
              color: COLORS.dark,
              letterSpacing: "-0.5px",
            }}
          >
            £625,000
          </div>
        </div>
        <div
          className="flex items-center justify-center shrink-0"
          style={{
            width: 56,
            height: 56,
            borderRadius: 999,
            background: `conic-gradient(${COLORS.green} ${pct}%, ${COLORS.greenTint} ${pct}% 100%)`,
          }}
          aria-hidden
        >
          <div
            className="flex items-center justify-center"
            style={{
              width: 44,
              height: 44,
              borderRadius: 999,
              background: COLORS.card,
              fontFamily: HEADING_FONT,
              fontSize: 14,
              color: COLORS.dark,
            }}
          >
            {score}
          </div>
        </div>
      </div>

      {/* Area pricing */}
      <div
        className="mt-4"
        style={{ background: COLORS.bg, borderRadius: 10, padding: "14px 16px" }}
      >
        <div
          className="uppercase"
          style={{
            fontSize: 10,
            fontWeight: 500,
            letterSpacing: "0.1em",
            color: COLORS.veryMuted,
          }}
        >
          Area pricing analysis
        </div>
        <div className="mt-3 grid grid-cols-3 gap-3">
          {[
            { label: "This property", val: "£694", sub: "per sq ft", color: COLORS.dark },
            { label: "Area average", val: "£641", sub: "per sq ft", color: COLORS.dark },
            { label: "Vs area avg", val: "+8.3%", sub: "above average", color: "#A32D2D" },
          ].map((m) => (
            <div key={m.label}>
              <div style={{ fontSize: 10, color: COLORS.veryMuted }}>{m.label}</div>
              <div
                className="mt-0.5"
                style={{
                  fontFamily: HEADING_FONT,
                  fontSize: 18,
                  color: m.color,
                  fontWeight: 400,
                }}
              >
                {m.val}
              </div>
              <div style={{ fontSize: 10, color: m.color === "#A32D2D" ? "#A32D2D" : COLORS.veryMuted }}>
                {m.sub}
              </div>
            </div>
          ))}
        </div>
        <div
          className="relative mt-3"
          style={{
            background: "rgba(26,17,8,0.08)",
            height: 6,
            borderRadius: 999,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              position: "absolute",
              inset: 0,
              width: "85%",
              background: COLORS.green,
              borderRadius: 999,
            }}
          />
          <div
            style={{
              position: "absolute",
              inset: 0,
              width: "92%",
              background: "#A32D2D",
              opacity: 0.5,
              borderRadius: 999,
            }}
          />
        </div>
        <p className="mt-3" style={{ fontSize: 10, color: COLORS.muted, lineHeight: 1.5 }}>
          At 900 sq ft, you're paying £48,600 more than the area average price per sq ft.
          This property has less outdoor space than comparable flats — worth negotiating.
        </p>
      </div>

      {/* Red flags */}
      <div
        className="mt-4 uppercase"
        style={{
          fontSize: 10,
          fontWeight: 500,
          letterSpacing: "0.1em",
          color: COLORS.veryMuted,
        }}
      >
        Red flags
      </div>
      <div className="mt-2 flex flex-col gap-2">
        {[
          {
            sev: "HIGH",
            bg: "#A32D2D",
            fg: "#FFFDF9",
            text: "Priced 8.3% above local £/sqft average — limited justification in listing",
          },
          {
            sev: "MEDIUM",
            bg: "#C8862A",
            fg: "#FFFDF9",
            text: "42 days on market — above UK average, some negotiation leverage",
          },
          {
            sev: "LOW",
            bg: "rgba(26,17,8,0.12)",
            fg: COLORS.dark,
            text: "Ground floor flat — noise, security and resale considerations",
          },
        ].map((f) => (
          <div key={f.sev} className="flex items-start gap-2">
            <span
              style={{
                background: f.bg,
                color: f.fg,
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
            <span style={{ fontSize: 11, color: COLORS.muted, lineHeight: 1.5 }}>
              {f.text}
            </span>
          </div>
        ))}
      </div>

      {/* Bottom metrics */}
      <div className="mt-4 grid grid-cols-3 gap-2">
        {[
          { label: "Stamp duty", val: "£18,750", color: COLORS.dark },
          { label: "Flood risk", val: "Low", color: COLORS.green },
          { label: "Monthly est.", val: "£2,840", color: COLORS.dark },
        ].map((m) => (
          <div
            key={m.label}
            style={{
              background: COLORS.bg,
              borderRadius: 8,
              padding: "10px 12px",
            }}
          >
            <div style={{ fontSize: 10, color: COLORS.veryMuted }}>{m.label}</div>
            <div
              className="mt-0.5"
              style={{ fontSize: 13, fontWeight: 500, color: m.color }}
            >
              {m.val}
            </div>
          </div>
        ))}
      </div>

      <p className="mt-3" style={{ fontSize: 10, color: COLORS.veryMuted }}>
        Sample only · Based on a real SW11 listing · Area data from Land Registry
      </p>
    </div>
  );
}
