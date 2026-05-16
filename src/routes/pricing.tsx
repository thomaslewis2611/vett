import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Check } from "lucide-react";
import { SiteHeader, SiteFooter } from "@/components/site-chrome";
import { usePassDiscount } from "@/hooks/use-pass-discount";
import { createCheckoutSession } from "@/lib/checkout.functions";

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
    <div className="flex min-h-screen flex-col" style={{ background: "#F1EFE8" }}>
      <SiteHeader />

      <main className="w-full" style={{ background: "#1A1108" }}>
        <div className="mx-auto max-w-5xl px-6 py-20 sm:py-28">
          <div className="text-center">
            <div
              style={{
                fontSize: 11,
                fontWeight: 500,
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                color: "#2D6A4F",
              }}
            >
              Pricing
            </div>
            <h1
              className="mt-4"
              style={{
                fontFamily: "'Playfair Display', Georgia, serif",
                fontWeight: 400,
                fontSize: 48,
                lineHeight: 1.1,
                color: "#FFFDF9",
                letterSpacing: "-0.5px",
              }}
            >
              Simple, honest pricing
            </h1>
            <p
              className="mx-auto mt-5 max-w-xl"
              style={{ fontWeight: 300, fontSize: 16, color: "rgba(255,253,249,0.7)" }}
            >
              One-time payments. No auto-renewals, no hidden fees.
            </p>
          </div>

          <div className="mt-14 grid gap-6 md:grid-cols-2">
            <Plan
              title="Single report"
              price="£4.99"
              cadence="One-off payment"
              cta="Buy a report"
              features={[
                "Full analysis with all red flags",
                "EPC analysis",
                "Area pricing analysis",
                "True cost breakdown and stamp duty",
                "Negotiation strategy and recommended offer",
                "Viewing checklist — specific to this property",
                "Renovation cost estimator",
                "Seller motivation score",
                "Flood risk assessment",
                "Nearby schools with Ofsted ratings",
                "Crime statistics",
                "Broadband and internet speed",
                "Transport links",
                "Report saved to your account",
                "Email your report to you",
              ]}
              upsell={{ text: "Upgrade to Buyer Pass for AI chat, comparisons and unlimited analyses →", targetId: "buyer-pass-card" }}
            />
            <BuyerPassPlan />
          </div>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}

function BuyerPassPlan() {
  const discount = usePassDiscount();
  const checkoutFn = useServerFn(createCheckoutSession);
  const [loading, setLoading] = useState(false);

  const startDiscountCheckout = async () => {
    setLoading(true);
    try {
      const r = await checkoutFn({
        data: {
          priceId: discount.priceId,
          listingUrl: "",
          tier: "pass",
          source: "pricing_page_discount",
        },
      });
      if (r?.url) window.location.href = r.url;
    } catch {
      setLoading(false);
    }
  };

  if (discount.eligible) {
    return (
      <Plan
        id="buyer-pass-card"
        title="Buyer Pass"
        price="£20.00"
        originalPrice="£24.99"
        cadence="90-day pass · one-off payment"
        cta={loading ? "Redirecting…" : "Upgrade for £20 →"}
        highlight
        headline="Your entire property search, covered"
        subnote="You've already spent £4.99 on a Single Report — we'll deduct it from your Buyer Pass"
        plusIntro="Everything in Single Report, plus:"
        features={[
          "Unlimited analyses for 90 days",
          "AI chat on every property",
          "Compare your property scores",
          "All reports saved to dashboard",
        ]}
        footnote="One-off payment. Access ends 90 days after purchase."
        onClick={startDiscountCheckout}
      />
    );
  }

  return (
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
        "Compare your property scores",
        "All reports saved to dashboard",
      ]}
      footnote="One-off payment. Access ends 90 days after purchase."
    />
  );
}

function Plan({
  id,
  title,
  price,
  originalPrice,
  cadence,
  features,
  cta,
  highlight,
  headline,
  footnote,
  subnote,
  plusIntro,
  upsell,
  onClick,
}: {
  id?: string;
  title: string;
  price: string;
  originalPrice?: string;
  cadence: string;
  features: string[];
  cta: string;
  highlight?: boolean;
  headline?: string;
  footnote?: string;
  subnote?: string;
  plusIntro?: string;
  upsell?: { text: string; targetId: string };
  onClick?: () => void;
}) {
  return (
    <div
      id={id}
      className="relative p-8"
      style={{
        background: "#FFFDF9",
        borderRadius: 12,
        border: highlight ? "2px solid #1B4332" : "0.5px solid rgba(26,17,8,0.12)",
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
      <div className="mt-3 flex items-baseline gap-2">
        {originalPrice && (
          <span style={{ fontSize: 18, color: "#888780", textDecoration: "line-through" }}>
            {originalPrice}
          </span>
        )}
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
            <Check className="mt-0.5 h-4 w-4 shrink-0" style={{ color: "#1B4332" }} />
            <span>
              {f}
              {/^transport links/i.test(f) && (
                <span className="block text-[11px]" style={{ color: "#888780", marginTop: 2 }}>
                  London properties only
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>
      {upsell && (
        <button
          type="button"
          onClick={() => {
            if (typeof document === "undefined") return;
            document.getElementById(upsell.targetId)?.scrollIntoView({ behavior: "smooth", block: "center" });
          }}
          className="mt-4 text-left hover:underline"
          style={{ fontSize: 13, fontWeight: 500, color: "#1B4332" }}
        >
          {upsell.text}
        </button>
      )}
      {footnote && (
        <p className="mt-4" style={{ fontSize: 12, color: "#888780" }}>
          {footnote}
        </p>
      )}
      {onClick ? (
        <button
          type="button"
          onClick={onClick}
          className="mt-7 inline-flex w-full items-center justify-center transition-opacity hover:opacity-90"
          style={{
            background: highlight ? "#1B4332" : "#1A1108",
            color: "#FFFDF9",
            fontSize: 13,
            fontWeight: 500,
            borderRadius: 100,
            padding: "12px 24px",
            border: 0,
          }}
        >
          {cta}
        </button>
      ) : (
        <Link
          to="/"
          className="mt-7 inline-flex w-full items-center justify-center transition-opacity hover:opacity-90"
          style={{
            background: highlight ? "#1B4332" : "#1A1108",
            color: "#FFFDF9",
            fontSize: 13,
            fontWeight: 500,
            borderRadius: 100,
            padding: "12px 24px",
          }}
        >
          {cta}
        </Link>
      )}
    </div>
  );
}
