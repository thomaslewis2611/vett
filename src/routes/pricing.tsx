import { createFileRoute, Link } from "@tanstack/react-router";
import { Check } from "lucide-react";
import { SiteHeader, SiteFooter } from "@/components/site-chrome";

export const Route = createFileRoute("/pricing")({
  head: () => ({
    meta: [
      { title: "Pricing — Propwise" },
      {
        name: "description",
        content:
          "Try Propwise free, then unlock unlimited AI property analysis from £4.99.",
      },
      { property: "og:title", content: "Propwise pricing" },
      {
        property: "og:description",
        content: "Free first analysis. £4.99 per report or £9.99 per month for unlimited.",
      },
    ],
  }),
  component: PricingPage,
});

function PricingPage() {
  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />

      <main className="mx-auto max-w-5xl px-6 py-20">
        <div className="text-center">
          <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
            Simple, honest pricing
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-muted-foreground">
            Try one analysis on us. Pay per report or go unlimited — no hidden fees, cancel anytime.
          </p>
        </div>

        <div className="mt-14 grid gap-6 md:grid-cols-3">
          <Plan
            title="Free"
            price="£0"
            cadence="one analysis"
            cta="Try free"
            features={[
              "One full analysis",
              "Value score & key metrics",
              "Top 2 red flags",
              "No account needed",
            ]}
          />
          <Plan
            title="Single report"
            price="£4.99"
            cadence="one-off"
            cta="Buy a report"
            features={[
              "Full report on one property",
              "All red flags",
              "True cost breakdown",
              "AI chat for that property",
              "PDF export",
            ]}
          />
          <Plan
            title="Monthly"
            price="£9.99"
            cadence="per month"
            cta="Start monthly"
            highlight
            features={[
              "Unlimited reports",
              "AI chat on every property",
              "Comparable sales lookup",
              "Save & revisit reports",
              "Cancel anytime",
            ]}
          />
        </div>

        <div className="mt-16 text-center text-sm text-muted-foreground">
          Need it for your team or agency?{" "}
          <a href="mailto:hello@propwise.app" className="text-primary hover:underline">
            Get in touch
          </a>
          .
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}

function Plan({
  title,
  price,
  cadence,
  features,
  cta,
  highlight,
}: {
  title: string;
  price: string;
  cadence: string;
  features: string[];
  cta: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`relative rounded-2xl border p-6 ${
        highlight
          ? "border-primary bg-primary text-primary-foreground shadow-glow"
          : "border-border bg-card shadow-soft"
      }`}
    >
      {highlight && (
        <span className="absolute -top-3 right-5 rounded-full bg-card px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-primary border border-primary/20 shadow-soft">
          Most popular
        </span>
      )}
      <h3 className="text-lg font-semibold">{title}</h3>
      <div className="mt-3 flex items-baseline gap-1">
        <span className="text-4xl font-semibold tracking-tight">{price}</span>
        <span className={`text-sm ${highlight ? "text-primary-foreground/80" : "text-muted-foreground"}`}>
          {cadence}
        </span>
      </div>
      <ul className="mt-5 space-y-2 text-sm">
        {features.map((f) => (
          <li key={f} className="flex items-start gap-2">
            <Check
              className={`mt-0.5 h-4 w-4 shrink-0 ${highlight ? "text-primary-foreground" : "text-primary"}`}
            />
            {f}
          </li>
        ))}
      </ul>
      <Link
        to="/"
        className={`mt-6 inline-flex w-full items-center justify-center rounded-xl px-4 py-3 text-sm font-medium transition-opacity hover:opacity-90 ${
          highlight ? "bg-card text-primary" : "bg-primary text-primary-foreground"
        }`}
      >
        {cta}
      </Link>
    </div>
  );
}
