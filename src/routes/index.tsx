import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState } from "react";
import { ArrowRight, Check, Link2, Sparkles, FileText } from "lucide-react";
import { SiteHeader, SiteFooter } from "@/components/site-chrome";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Propwise — Know exactly what you're buying before you offer" },
      {
        name: "description",
        content:
          "Paste any Rightmove or Zoopla listing and get an AI-powered value score, red flags, true cost breakdown and negotiation strategy in seconds.",
      },
      { property: "og:title", content: "Propwise — UK property listing analyser" },
      {
        property: "og:description",
        content:
          "AI analysis of UK property listings: value score, red flags, true costs and negotiation strategy.",
      },
    ],
  }),
  component: Index,
});

function Index() {
  const navigate = useNavigate();
  const [url, setUrl] = useState("");
  const [showPaste, setShowPaste] = useState(false);
  const [pasted, setPasted] = useState("");

  const handleAnalyse = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedUrl = url.trim();
    const trimmedText = pasted.trim();
    if (!trimmedUrl && !trimmedText) return;
    navigate({
      to: "/results",
      search: {
        url: trimmedUrl || undefined,
        text: trimmedText || undefined,
      },
    });
  };

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />

      {/* Hero */}
      <section
        className="border-b border-border"
        style={{ background: "var(--gradient-soft)" }}
      >
        <div className="mx-auto max-w-4xl px-6 pt-20 pb-24 text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-border bg-background px-3 py-1 text-xs font-medium text-muted-foreground shadow-soft">
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            Powered by Claude AI
          </div>
          <h1 className="mt-6 text-balance text-5xl font-semibold tracking-tight sm:text-6xl">
            Know exactly what you're buying{" "}
            <span className="text-primary">before you make an offer</span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-balance text-lg text-muted-foreground">
            Paste any Rightmove or Zoopla listing and Propwise returns a value score, red flags,
            true buying costs and a negotiation strategy in under 30 seconds.
          </p>

          <form
            onSubmit={handleAnalyse}
            className="mx-auto mt-10 flex max-w-2xl flex-col gap-3 rounded-2xl border border-border bg-card p-2 shadow-card sm:flex-row sm:items-center"
          >
            <div className="flex flex-1 items-center gap-2 px-3">
              <Link2 className="h-4 w-4 shrink-0 text-muted-foreground" />
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://www.rightmove.co.uk/properties/..."
                className="w-full bg-transparent py-3 text-base outline-none placeholder:text-muted-foreground"
                aria-label="Property listing URL"
              />
            </div>
            <button
              type="submit"
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
            >
              Analyse this property
              <ArrowRight className="h-4 w-4" />
            </button>
          </form>

          {showPaste ? (
            <div className="mx-auto mt-3 max-w-2xl rounded-2xl border border-border bg-card p-3 shadow-soft">
              <textarea
                value={pasted}
                onChange={(e) => setPasted(e.target.value)}
                placeholder="Or paste the full listing text here…"
                rows={5}
                className="w-full resize-none rounded-lg bg-transparent p-2 text-sm outline-none placeholder:text-muted-foreground"
              />
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowPaste(true)}
              className="mt-3 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Or paste listing text instead
            </button>
          )}

          <ul className="mx-auto mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-muted-foreground">
            {[
              "One-time payment, no subscription",
              "Works with Rightmove & Zoopla",
              "Reports from £4.99",
            ].map((t) => (
              <li key={t} className="flex items-center gap-2">
                <Check className="h-4 w-4 text-primary" />
                {t}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* How it works */}
      <section className="mx-auto max-w-6xl px-6 py-24">
        <div className="text-center">
          <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">How it works</h2>
          <p className="mt-3 text-muted-foreground">
            Three steps from listing to negotiation strategy.
          </p>
        </div>
        <div className="mt-14 grid gap-6 md:grid-cols-3">
          {[
            {
              icon: Link2,
              step: "01",
              title: "Paste the URL",
              body: "Drop any Rightmove or Zoopla listing link, or paste the full text directly.",
            },
            {
              icon: Sparkles,
              step: "02",
              title: "AI analyses the listing",
              body: "Claude reads the description, photos and metrics, then cross-checks against local sales.",
            },
            {
              icon: FileText,
              step: "03",
              title: "Get your report",
              body: "Score, red flags, true cost, viewing questions and a recommended offer range.",
            },
          ].map((s) => (
            <div
              key={s.step}
              className="rounded-2xl border border-border bg-card p-6 shadow-soft"
            >
              <div className="flex items-center justify-between">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-soft text-primary">
                  <s.icon className="h-5 w-5" />
                </div>
                <span className="text-xs font-medium text-muted-foreground">{s.step}</span>
              </div>
              <h3 className="mt-5 text-lg font-semibold">{s.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{s.body}</p>
            </div>
          ))}
        </div>

        <div className="mt-16 flex flex-col items-center gap-4 rounded-3xl border border-border p-10 text-center" style={{ background: "var(--gradient-soft)" }}>
          <h3 className="text-2xl font-semibold tracking-tight">Try it on your next viewing</h3>
          <p className="max-w-lg text-muted-foreground">
            First analysis is on us. See the full report before you spend a penny.
          </p>
          <Link
            to="/results"
            search={{ url: "https://www.rightmove.co.uk/properties/example" }}
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-medium text-primary-foreground hover:opacity-90 transition-opacity"
          >
            See a sample report
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}
