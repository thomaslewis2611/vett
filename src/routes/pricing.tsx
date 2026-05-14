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
          "One-off payments. £4.99 for a single report or £24.99 for a 90-day Buyer Pass with unlimited analyses, AI chat and saved reports.",
      },
      { property: "og:title", content: "Roovr pricing" },
      {
        property: "og:description",
        content:
          "£4.99 single report or £24.99 Buyer Pass — unlimited analyses for 90 days, AI chat, save & compare. One-off payments.",
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
            cadence="One-off payment"
            cta="Buy a report"
            features={[
              "Full analysis for one property",
              "All red flags spotted in the listing",
              "True cost breakdown (stamp duty, legal fees, mortgage estimate)",
              "Viewing questions to ask the agent",
              "Negotiation strategy and recommended offer range",
            ]}
            upsell={{ text: "Upgrade to Buyer Pass for AI chat, flood risk and nearby schools →", targetId: "buyer-pass-card" }}
          />
          <Plan
            id="buyer-pass-card"
            title="Buyer Pass"
            price="£24.99"
            cadence="90-day pass · one-off payment"
            cta="Get Buyer Pass"
            highlight
            headline="Your entire property search, covered"
            plusIntro="Everything in Single Report, plus:"
            features={[
              "Unlimited analyses for 90 days",
              "AI chat on every property",
              "Flood risk assessment",
              "Nearby schools with Ofsted ratings",
              "Save and compare reports",
              "Report emailed to you",
            ]}
            footnote="One-off payment. Access ends 90 days after purchase."
          />
        </div>

        <div className="mt-12 text-center text-sm text-muted-foreground">
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
  id,
  title,
  price,
  cadence,
  features,
  cta,
  highlight,
  headline,
  footnote,
  subnote,
  plusIntro,
  upsell,
}: {
  id?: string;
  title: string;
  price: string;
  cadence: string;
  features: string[];
  cta: string;
  highlight?: boolean;
  headline?: string;
  footnote?: string;
  subnote?: string;
  plusIntro?: string;
  upsell?: { text: string; targetId: string };
}) {
  return (
    <div
      id={id}
      className="relative p-8"
      style={{
        background: "#FFFDF9",
        borderRadius: 12,
        border: highlight ? "2px solid #D85A30" : "0.5px solid rgba(26,17,8,0.12)",
      }}
    >
      {highlight && (
        <span
          className="absolute -top-3 right-6 uppercase"
          style={{
            background: "#FAECE7",
            color: "#993C1D",
            fontSize: 10,
            fontWeight: 500,
            letterSpacing: "0.08em",
            borderRadius: 100,
            padding: "4px 10px",
          }}
        >
          Most popular
        </span>
      )}
      <h3 style={{ fontSize: 18, fontWeight: 500, color: "#1A1108" }}>{title}</h3>
      <div className="mt-3 flex items-baseline gap-1">
        <span style={{ fontSize: 28, fontWeight: 500, color: "#1A1108", letterSpacing: "-0.5px" }}>
          {price}
        </span>
        <span style={{ fontSize: 13, color: "#888780" }}>{cadence}</span>
      </div>
      {headline && (
        <p className="mt-3" style={{ fontSize: 14, fontWeight: 500, color: "#1A1108" }}>
          {headline}
        </p>
      )}
      {subnote && (
        <p className="mt-2" style={{ fontSize: 12, color: "#5F5E5A" }}>
          {subnote}
        </p>
      )}
      {plusIntro && (
        <p className="mt-5" style={{ fontSize: 13, color: "#888780", fontStyle: "italic" }}>
          {plusIntro}
        </p>
      )}
      <ul className={plusIntro ? "mt-2 space-y-2.5" : "mt-5 space-y-2.5"}>
        {features.map((f) => (
          <li key={f} className="flex items-start gap-2.5" style={{ fontSize: 14, color: "#1A1108" }}>
            <Check className="mt-0.5 h-4 w-4 shrink-0" style={{ color: "#D85A30" }} />
            {f}
          </li>
        ))}
      </ul>
      {footnote && (
        <p className="mt-4" style={{ fontSize: 12, color: "#888780" }}>
          {footnote}
        </p>
      )}
      <Link
        to="/"
        className="mt-7 inline-flex w-full items-center justify-center transition-opacity hover:opacity-90"
        style={{
          background: highlight ? "#D85A30" : "#1A1108",
          color: "#FFFDF9",
          fontSize: 13,
          fontWeight: 500,
          borderRadius: 100,
          padding: "12px 24px",
        }}
      >
        {cta}
      </Link>
    </div>
  );
}
