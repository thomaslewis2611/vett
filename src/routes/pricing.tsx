import { createFileRoute, Link } from "@tanstack/react-router";
import { Check } from "lucide-react";
import { SiteHeader, SiteFooter } from "@/components/site-chrome";

export const Route = createFileRoute("/pricing")({
  head: () => ({
    meta: [
      { title: "Pricing — Roovr" },
      {
        name: "description",
        content:
          "One-time payment, no subscription. £4.99 for a single report or £29.99 for a Buyer Pass with unlimited analyses.",
      },
      { property: "og:title", content: "Roovr pricing" },
      {
        property: "og:description",
        content:
          "£4.99 single report or £29.99 Buyer Pass — unlimited analyses, AI chat, save & compare. One-time payments.",
      },
    ],
  }),
  component: PricingPage,
});

function PricingPage() {
  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />

      <main className="mx-auto max-w-4xl px-6 py-20">
        <div className="text-center">
          <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
            Simple, honest pricing
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-muted-foreground">
            One-time payments. No subscriptions, no auto-renewals, no hidden fees.
          </p>
        </div>

        <div className="mt-14 grid gap-6 md:grid-cols-2">
          <Plan
            title="Single report"
            price="£4.99"
            cadence="one-off"
            cta="Buy a report"
            features={[
              "Full analysis for 1 property",
              "All red flags",
              "True cost breakdown",
              "Viewing questions tailored to the listing",
              "Negotiation strategy",
            ]}
            footnote="No AI chat. No saving or comparing."
          />
          <Plan
            title="Buyer Pass"
            price="£29.99"
            cadence="one-time"
            cta="Get Buyer Pass"
            highlight
            features={[
              "Unlimited analyses for your entire property search",
              "All red flags, costs, viewing questions & negotiation strategy",
              "AI chat on every property",
              "Save & compare up to 50 properties",
            ]}
            subnote="Average buyer analyses 8 properties — works out at £3.75 each."
            footnote="One-time payment for your entire property search — not a subscription."
          />
        </div>

        <div className="mt-16 text-center text-sm text-muted-foreground">
          Need it for your team or agency?{" "}
          <a href="mailto:hello@roovr.co.uk" className="text-primary hover:underline">
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
  footnote,
  subnote,
}: {
  title: string;
  price: string;
  cadence: string;
  features: string[];
  cta: string;
  highlight?: boolean;
  footnote?: string;
  subnote?: string;
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
      {subnote && (
        <p className={`mt-2 text-xs ${highlight ? "text-primary-foreground/85" : "text-muted-foreground"}`}>
          {subnote}
        </p>
      )}
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
      {footnote && (
        <p className={`mt-4 text-xs ${highlight ? "text-primary-foreground/80" : "text-muted-foreground"}`}>
          {footnote}
        </p>
      )}
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
