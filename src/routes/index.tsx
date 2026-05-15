import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowRight, Check, Link2, Sparkles, FileText } from "lucide-react";
import { SiteHeader, SiteFooter } from "@/components/site-chrome";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Roovr — Every listing. Analysed. Instantly." },
      {
        name: "description",
        content:
          "Paste any Rightmove or Zoopla listing and get an instant AI analysis. Red flags, true costs, value score and negotiation strategy in seconds.",
      },
      { property: "og:title", content: "Roovr — AI property analysis for smarter buyers" },
      {
        property: "og:description",
        content:
          "Paste any Rightmove or Zoopla listing and get an instant AI analysis. Red flags, true costs, value score and negotiation strategy in seconds.",
      },
    ],
  }),
  component: Index,
});

const HEADLINES = [
  { main: "The red flags", highlight: "estate agents won't show you" },
  { main: "Know what", highlight: "you're really buying" },
  { main: "Stop guessing.", highlight: "Start knowing." },
  { main: "See through the listing.", highlight: "Before you fall in love." },
  { main: "Buy smarter.", highlight: "Offer better." },
  { main: "Your unfair advantage", highlight: "in a competitive market." },
  { main: "The truth behind", highlight: "every listing." },
  { main: "Spot the red flags", highlight: "before the viewing." },
  { main: "The second opinion", highlight: "every buyer needs." },
  { main: "Property analysis for buyers", highlight: "who do their homework." },
];

function Index() {
  const navigate = useNavigate();
  const [url, setUrl] = useState("");
  const [headlineIdx, setHeadlineIdx] = useState(0);
  useEffect(() => {
    setHeadlineIdx(Math.floor(Math.random() * HEADLINES.length));
  }, []);
  const headline = HEADLINES[headlineIdx];

  const handleAnalyse = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedUrl = url.trim();
    if (!trimmedUrl) return;
    navigate({
      to: "/results",
      search: { url: trimmedUrl },
    });
  };

  const scrollToTop = () => {
    if (typeof window === "undefined") return;
    const el = document.getElementById("url-input");
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    else window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <SiteHeader />

      {/* Hero */}
      <section style={{ background: "#FFFDF9", padding: "72px 32px 56px" }}>
        <div className="mx-auto max-w-4xl text-center">
          <span
            className="inline-block"
            style={{
              background: "#FAECE7",
              color: "#993C1D",
              fontSize: 12,
              fontWeight: 500,
              borderRadius: 100,
              padding: "5px 12px",
            }}
          >
            AI-powered property analysis
          </span>
          <h1 className="mt-6 text-balance" suppressHydrationWarning>
            {headline.main}{" "}
            <span style={{ color: "#D85A30" }}>{headline.highlight}</span>
          </h1>
          <p
            className="mx-auto mt-6 max-w-2xl text-balance"
            style={{ fontSize: 15, color: "#5F5E5A", lineHeight: 1.65 }}
          >
            Every listing. Analysed. Instantly.
          </p>

          <form
            onSubmit={handleAnalyse}
            className="mx-auto mt-10 flex max-w-2xl items-center gap-2"
            style={{
              border: "1.5px solid #1A1108",
              borderRadius: 100,
              background: "#FFFDF9",
              padding: 4,
            }}
          >
            <div className="flex flex-1 items-center gap-2 px-4">
              <Link2 className="h-4 w-4 shrink-0" style={{ color: "#888780" }} />
              <input
                id="url-input"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="Paste a property listing URL"
                className="w-full bg-transparent py-2.5 outline-none"
                style={{ fontSize: 14, color: "#1A1108" }}
                aria-label="Property listing URL"
              />
            </div>
            <button
              type="submit"
              className="inline-flex items-center justify-center gap-2 transition-colors hover:bg-[#993C1D]"
              style={{
                background: "#D85A30",
                color: "#FFFDF9",
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

          <p className="mx-auto mt-3" style={{ fontSize: 11, color: "#888780" }}>
            Works best with Rightmove listings · More sites coming soon · Currently UK properties only
          </p>

          <ul className="mx-auto mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
            {[
              "One-time payment, no subscription",
              "Reports from £4.99",
            ].map((t) => (
              <li key={t} className="flex items-center gap-2" style={{ fontSize: 12, color: "#888780" }}>
                <Check className="h-3.5 w-3.5" style={{ color: "#D85A30" }} />
                {t}
              </li>
            ))}
          </ul>

          <p className="mx-auto mt-6 text-center" style={{ fontSize: 11, color: "#888780" }}>
            Currently available for UK properties only — US, Australia and more coming soon
          </p>
        </div>
      </section>

      {/* Stats strip */}
      <section
        style={{
          background: "#FFFDF9",
          borderTop: "0.5px solid rgba(26,17,8,0.12)",
          borderBottom: "0.5px solid rgba(26,17,8,0.12)",
        }}
      >
        <div className="mx-auto grid max-w-5xl grid-cols-1 sm:grid-cols-3">
          {[
            { value: "30", unit: "s", label: "Average analysis time" },
            { value: "100", unit: "+", label: "Data points checked" },
            { value: "£4.99", unit: "", label: "From per report" },
          ].map((s, i) => (
            <div
              key={s.label}
              className="px-8 py-10 text-center"
              style={{
                borderLeft: i === 0 ? "none" : "0.5px solid rgba(26,17,8,0.12)",
              }}
            >
              <div style={{ fontSize: 32, fontWeight: 500, color: "#1A1108", letterSpacing: "-1px" }}>
                {s.value}
                <span style={{ color: "#D85A30" }}>{s.unit}</span>
              </div>
              <div className="mt-2" style={{ fontSize: 13, color: "#888780" }}>
                {s.label}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Feature cards */}
      <section className="mx-auto max-w-6xl px-8 py-20">
        <div className="text-center">
          <div
            className="inline-block uppercase"
            style={{
              fontSize: 11,
              fontWeight: 500,
              letterSpacing: "0.08em",
              color: "#888780",
            }}
          >
            How it works
          </div>
          <h2 className="mt-3">Three steps to a better offer</h2>
        </div>

        <div className="mt-12 grid grid-cols-1 gap-2 md:grid-cols-4 md:gap-[2px]">
          {[
            { icon: Link2, title: "Paste the URL", body: "Drop any Rightmove or Zoopla listing link, or paste the full text." },
            { icon: Sparkles, title: "AI reads it all", body: "Claude analyses description, metrics and local comparables." },
            { icon: FileText, title: "Get your report", body: "Score, red flags, true cost and viewing questions in seconds." },
            { icon: Check, title: "Negotiate well", body: "A clear recommended offer range, backed by the listing data." },
          ].map((s, i, arr) => (
            <div
              key={s.title}
              className="rounded-xl md:rounded-none md:first:rounded-l-xl md:last:rounded-r-xl"
              style={{
                background: "#F1EFE8",
                padding: 24,
              }}
            >
              <div
                className="flex items-center justify-center"
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 8,
                  background: "#FFFDF9",
                }}
              >
                <s.icon className="h-4 w-4" style={{ color: "#D85A30" }} />
              </div>
              <h3 className="mt-5" style={{ fontSize: 14, fontWeight: 500, color: "#1A1108" }}>
                {s.title}
              </h3>
              <p className="mt-2" style={{ fontSize: 12, color: "#5F5E5A", lineHeight: 1.6 }}>
                {s.body}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Bottom CTA strip */}
      <section style={{ background: "#FFFDF9", padding: "48px 32px" }}>
        <div className="mx-auto flex max-w-4xl flex-col items-center gap-6 text-center">
          <h2 style={{ color: "#1A1108", fontSize: 32, fontWeight: 500, letterSpacing: "-1px" }}>
            Ready to <span style={{ color: "#D85A30" }}>rove</span> your next listing?
          </h2>
          <p style={{ color: "#5F5E5A", fontSize: 15, maxWidth: 520 }}>
            Paste a property listing URL and let Roovr do the research for you
          </p>
          <button
            type="button"
            onClick={scrollToTop}
            className="inline-flex items-center gap-2 transition-colors hover:bg-[#993C1D]"
            style={{
              background: "#D85A30",
              color: "#FFFDF9",
              fontSize: 13,
              fontWeight: 500,
              borderRadius: 100,
              padding: "12px 24px",
            }}
          >
            Analyse a property
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}

