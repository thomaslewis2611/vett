import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useEffect, useRef, useCallback } from "react";
import { SiteHeader, SiteFooter } from "@/components/site-chrome";
import {
  buildPageMeta,
  buildCanonicalLink,
  jsonLdScript,
  SITE_URL,
  DEFAULT_OG_IMAGE,
} from "@/lib/seo";

// ── Design tokens ──────────────────────────────────────────────────────────────
const HEADING = "'Playfair Display', Georgia, serif";
const BODY = "'Inter', -apple-system, sans-serif";
const C = {
  bg: "#F1EFE8",
  card: "#FFFDF9",
  dark: "#1A1108",
  green: "#2D6A4F",
  greenTint: "#EAF3DE",
  muted: "#5F5E5A",
  veryMuted: "#888780",
  border: "rgba(26,17,8,0.12)",
};

// ── Types ──────────────────────────────────────────────────────────────────────
type Region = "england" | "scotland" | "wales";
type BuyerType = "standard" | "ftb" | "additional";

interface BandResult {
  label: string;
  rate: number;
  taxableAmount: number;
  tax: number;
}

interface CalcResult {
  total: number;
  effectiveRate: number;
  bands: BandResult[];
  surchargeLines: { label: string; amount: number }[];
  taxName: string;
}

// ── Tax calculation ────────────────────────────────────────────────────────────
function applyBands(
  price: number,
  bands: { limit: number; rate: number }[],
): BandResult[] {
  const results: BandResult[] = [];
  let remaining = price;
  let prev = 0;
  for (const band of bands) {
    const top = band.limit === Infinity ? price : Math.min(band.limit, price);
    const taxable = Math.max(0, top - prev);
    results.push({
      label:
        band.limit === Infinity
          ? `Over ${fmt(prev)}`
          : prev === 0
          ? `Up to ${fmt(band.limit)}`
          : `${fmt(prev + 1)} – ${fmt(band.limit)}`,
      rate: band.rate,
      taxableAmount: taxable,
      tax: Math.round(taxable * band.rate),
    });
    remaining -= taxable;
    prev = band.limit === Infinity ? price : band.limit;
    if (remaining <= 0) break;
  }
  return results;
}

function calcEngland(price: number, buyer: BuyerType, nonUK: boolean): CalcResult {
  let bands: BandResult[];
  const surchargeLines: { label: string; amount: number }[] = [];

  if (buyer === "ftb" && price <= 500_000) {
    bands = applyBands(price, [
      { limit: 300_000, rate: 0 },
      { limit: 500_000, rate: 0.05 },
      { limit: Infinity, rate: 0.12 },
    ]);
  } else if (buyer === "additional") {
    bands = applyBands(price, [
      { limit: 125_000, rate: 0.05 },
      { limit: 250_000, rate: 0.07 },
      { limit: 925_000, rate: 0.10 },
      { limit: 1_500_000, rate: 0.15 },
      { limit: Infinity, rate: 0.17 },
    ]);
  } else {
    // standard (or ftb > £500k which reverts to standard)
    bands = applyBands(price, [
      { limit: 125_000, rate: 0 },
      { limit: 250_000, rate: 0.02 },
      { limit: 925_000, rate: 0.05 },
      { limit: 1_500_000, rate: 0.10 },
      { limit: Infinity, rate: 0.12 },
    ]);
  }

  let total = bands.reduce((s, b) => s + b.tax, 0);

  if (nonUK) {
    const surcharge = Math.round(price * 0.02);
    surchargeLines.push({ label: "Non-UK resident surcharge (2%)", amount: surcharge });
    total += surcharge;
  }

  return {
    total,
    effectiveRate: price > 0 ? (total / price) * 100 : 0,
    bands,
    surchargeLines,
    taxName: "SDLT",
  };
}

function calcScotland(price: number, buyer: BuyerType, _nonUK: boolean): CalcResult {
  const surchargeLines: { label: string; amount: number }[] = [];

  let bands: BandResult[];
  if (buyer === "ftb") {
    bands = applyBands(price, [
      { limit: 175_000, rate: 0 },
      { limit: 250_000, rate: 0.02 },
      { limit: 325_000, rate: 0.05 },
      { limit: 750_000, rate: 0.10 },
      { limit: Infinity, rate: 0.12 },
    ]);
  } else if (buyer === "additional") {
    // ADS: 8% of full price, plus standard LBTT
    bands = applyBands(price, [
      { limit: 145_000, rate: 0 },
      { limit: 250_000, rate: 0.02 },
      { limit: 325_000, rate: 0.05 },
      { limit: 750_000, rate: 0.10 },
      { limit: Infinity, rate: 0.12 },
    ]);
    const ads = Math.round(price * 0.08);
    surchargeLines.push({ label: "Additional Dwelling Supplement (8%)", amount: ads });
  } else {
    bands = applyBands(price, [
      { limit: 145_000, rate: 0 },
      { limit: 250_000, rate: 0.02 },
      { limit: 325_000, rate: 0.05 },
      { limit: 750_000, rate: 0.10 },
      { limit: Infinity, rate: 0.12 },
    ]);
  }

  const bandsTotal = bands.reduce((s, b) => s + b.tax, 0);
  const surchargeTotal = surchargeLines.reduce((s, l) => s + l.amount, 0);
  const total = bandsTotal + surchargeTotal;

  return {
    total,
    effectiveRate: price > 0 ? (total / price) * 100 : 0,
    bands,
    surchargeLines,
    taxName: "LBTT",
  };
}

function calcWales(price: number, buyer: BuyerType, _nonUK: boolean): CalcResult {
  const surchargeLines: { label: string; amount: number }[] = [];

  let bands: BandResult[];
  if (buyer === "additional") {
    bands = applyBands(price, [
      { limit: 225_000, rate: 0.05 },
      { limit: 400_000, rate: 0.11 },
      { limit: 750_000, rate: 0.125 },
      { limit: 1_500_000, rate: 0.15 },
      { limit: Infinity, rate: 0.17 },
    ]);
  } else {
    bands = applyBands(price, [
      { limit: 225_000, rate: 0 },
      { limit: 400_000, rate: 0.06 },
      { limit: 750_000, rate: 0.075 },
      { limit: 1_500_000, rate: 0.10 },
      { limit: Infinity, rate: 0.12 },
    ]);
  }

  const total = bands.reduce((s, b) => s + b.tax, 0);

  return {
    total,
    effectiveRate: price > 0 ? (total / price) * 100 : 0,
    bands,
    surchargeLines,
    taxName: "LTT",
  };
}

function calculate(
  price: number,
  region: Region,
  buyer: BuyerType,
  nonUK: boolean,
): CalcResult {
  if (region === "scotland") return calcScotland(price, buyer, nonUK);
  if (region === "wales") return calcWales(price, buyer, nonUK);
  return calcEngland(price, buyer, nonUK);
}

// ── Formatting helpers ─────────────────────────────────────────────────────────
function fmt(n: number) {
  return "£" + n.toLocaleString("en-GB");
}

function fmtRate(r: number) {
  // r is already a percentage (0–100)
  return r.toFixed(1) + "%";
}

function formatPriceInput(raw: string): string {
  const digits = raw.replace(/[^\d]/g, "");
  if (!digits) return "";
  return Number(digits).toLocaleString("en-GB");
}

// ── SEO schemas ────────────────────────────────────────────────────────────────
const softwareAppSchema = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "Stamp Duty Calculator UK 2026",
  applicationCategory: "FinanceApplication",
  operatingSystem: "Web",
  description:
    "Free UK stamp duty calculator covering SDLT, LBTT and LTT for England, Scotland, Wales and Northern Ireland. First-time buyers, second homes, buy-to-let and non-UK resident surcharge.",
  offers: { "@type": "Offer", price: "0", priceCurrency: "GBP" },
  url: `${SITE_URL}/tools/stamp-duty`,
  publisher: { "@type": "Organization", name: "vett", url: SITE_URL },
};

const faqSchema = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: [
    {
      "@type": "Question",
      name: "How much stamp duty do I pay as a first-time buyer in 2026?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "First-time buyers in England and Northern Ireland pay no stamp duty on properties up to £300,000. On properties priced between £300,001 and £500,000, you pay 5% on the portion above £300,000. Properties above £500,000 receive no first-time buyer relief and standard rates apply. All buyers in the purchase must be first-time buyers for the relief to apply.",
      },
    },
    {
      "@type": "Question",
      name: "What is the stamp duty surcharge for a second home in 2026?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "In England and Northern Ireland, buying a second home or buy-to-let property attracts a 5% surcharge on top of standard SDLT rates across every band. In Scotland, the Additional Dwelling Supplement (ADS) is 8% on top of LBTT. In Wales, the higher rate surcharge is 5% on top of LTT. These surcharges apply from the first pound of the purchase price.",
      },
    },
    {
      "@type": "Question",
      name: "Do non-UK residents pay extra stamp duty?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Yes. Non-UK residents buying residential property in England and Northern Ireland pay an additional 2% surcharge on top of all other applicable rates. This applies regardless of buyer type — first-time buyers and second home buyers both pay the surcharge. The surcharge applies to the full purchase price.",
      },
    },
    {
      "@type": "Question",
      name: "What is the difference between SDLT, LBTT and LTT?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Stamp Duty Land Tax (SDLT) applies in England and Northern Ireland and is collected by HMRC. Land and Buildings Transaction Tax (LBTT) applies in Scotland and is collected by Revenue Scotland. Land Transaction Tax (LTT) applies in Wales and is collected by the Welsh Revenue Authority. Each has different thresholds and rates, and Scotland and Wales do not offer first-time buyer relief on the same basis as England.",
      },
    },
    {
      "@type": "Question",
      name: "When do I have to pay stamp duty?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Stamp duty must be paid within 14 days of completion of the property purchase. In most cases your solicitor will handle payment on your behalf. An SDLT return must be submitted even if no tax is due. Failure to pay on time results in penalties and interest charges.",
      },
    },
  ],
};

const FAQ_ITEMS = [
  {
    q: "How much stamp duty do I pay as a first-time buyer in 2026?",
    a: "First-time buyers in England and Northern Ireland pay no stamp duty on properties up to £300,000. On properties priced between £300,001 and £500,000, you pay 5% on the portion above £300,000. Properties above £500,000 receive no first-time buyer relief and standard rates apply. All buyers in the purchase must be first-time buyers for the relief to apply.",
  },
  {
    q: "What is the stamp duty surcharge for a second home in 2026?",
    a: "In England and Northern Ireland, buying a second home or buy-to-let property attracts a 5% surcharge on top of standard SDLT rates across every band. In Scotland, the Additional Dwelling Supplement (ADS) is 8% on top of LBTT. In Wales, the higher rate surcharge is 5% on top of LTT. These surcharges apply from the first pound of the purchase price.",
  },
  {
    q: "Do non-UK residents pay extra stamp duty?",
    a: "Yes. Non-UK residents buying residential property in England and Northern Ireland pay an additional 2% surcharge on top of all other applicable rates. This applies regardless of buyer type — first-time buyers and second home buyers both pay the surcharge. The surcharge applies to the full purchase price.",
  },
  {
    q: "What is the difference between SDLT, LBTT and LTT?",
    a: "Stamp Duty Land Tax (SDLT) applies in England and Northern Ireland and is collected by HMRC. Land and Buildings Transaction Tax (LBTT) applies in Scotland and is collected by Revenue Scotland. Land Transaction Tax (LTT) applies in Wales and is collected by the Welsh Revenue Authority. Each has different thresholds and rates, and Scotland and Wales do not offer first-time buyer relief on the same basis as England.",
  },
  {
    q: "When do I have to pay stamp duty?",
    a: "Stamp duty must be paid within 14 days of completion of the property purchase. In most cases your solicitor will handle payment on your behalf. An SDLT return must be submitted even if no tax is due. Failure to pay on time results in penalties and interest charges.",
  },
];

// ── Route ──────────────────────────────────────────────────────────────────────
export const Route = createFileRoute("/tools/stamp-duty")({
  head: () => ({
    meta: buildPageMeta({
      title: "Stamp Duty Calculator UK 2026 — SDLT, LBTT & LTT | vett",
      description:
        "Calculate stamp duty instantly for England, Scotland, Wales and Northern Ireland. Covers first-time buyers, second homes, buy-to-let and non-UK residents. Free tool by vett.",
      canonicalPath: "/tools/stamp-duty",
      ogImage: DEFAULT_OG_IMAGE,
    }),
    links: [buildCanonicalLink("/tools/stamp-duty")],
    scripts: [jsonLdScript(softwareAppSchema), jsonLdScript(faqSchema)],
  }),
  component: StampDuty,
});

// ── FAQ accordion ──────────────────────────────────────────────────────────────
function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div
      style={{
        borderBottom: `0.5px solid ${C.border}`,
        paddingBottom: 0,
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          width: "100%",
          textAlign: "left",
          background: "none",
          border: "none",
          cursor: "pointer",
          padding: "16px 0",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 12,
          fontFamily: BODY,
        }}
      >
        <span style={{ fontSize: 15, fontWeight: 500, color: C.dark, lineHeight: 1.5 }}>
          {q}
        </span>
        <span
          style={{
            fontSize: 18,
            color: C.green,
            flexShrink: 0,
            transition: "transform 0.2s",
            transform: open ? "rotate(45deg)" : "none",
            lineHeight: 1,
          }}
        >
          +
        </span>
      </button>
      <div
        style={{
          maxHeight: open ? 600 : 0,
          overflow: "hidden",
          transition: "max-height 0.25s ease",
        }}
      >
        <p style={{ fontSize: 14, color: C.muted, lineHeight: 1.75, margin: "0 0 16px", paddingRight: 24 }}>
          {a}
        </p>
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────
function StampDuty() {
  const initDone = useRef(false);

  const [region, setRegion] = useState<Region>("england");
  const [priceDisplay, setPriceDisplay] = useState("");
  const [buyer, setBuyer] = useState<BuyerType>("standard");
  const [nonUK, setNonUK] = useState(false);
  const [result, setResult] = useState<CalcResult | null>(null);
  const [conflictError, setConflictError] = useState(false);

  const priceRef = useRef(0);

  const updateUrl = useCallback((p: number, r: Region, b: BuyerType, n: boolean) => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams();
    if (p > 0) params.set("price", String(p));
    params.set("region", r);
    params.set("buyer", b);
    if (n) params.set("nonuk", "1");
    window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
  }, []);

  const recalc = useCallback((p: number, r: Region, b: BuyerType, n: boolean) => {
    if (b === "ftb" && b === "ftb" && false) {/* placeholder */}
    // FTB + additional is logically impossible; guard handled in UI
    if (p <= 0) {
      setResult(null);
      setConflictError(false);
      return;
    }
    setConflictError(false);
    const res = calculate(p, r, b, n);
    setResult(res);
    updateUrl(p, r, b, n);
  }, [updateUrl]);

  // On mount: read URL params
  useEffect(() => {
    if (initDone.current || typeof window === "undefined") return;
    initDone.current = true;
    const params = new URLSearchParams(window.location.search);
    const priceParam = parseInt(params.get("price") ?? "0", 10);
    const regionParam = (params.get("region") ?? "england") as Region;
    const buyerParam = (params.get("buyer") ?? "standard") as BuyerType;
    const nonUKParam = params.get("nonuk") === "1";
    const validRegions: Region[] = ["england", "scotland", "wales"];
    const validBuyers: BuyerType[] = ["standard", "ftb", "additional"];
    const r = validRegions.includes(regionParam) ? regionParam : "england";
    const b = validBuyers.includes(buyerParam) ? buyerParam : "standard";
    const n = nonUKParam;
    setRegion(r);
    setBuyer(b);
    setNonUK(n);
    if (priceParam > 0) {
      priceRef.current = priceParam;
      setPriceDisplay(priceParam.toLocaleString("en-GB"));
      recalc(priceParam, r, b, n);
    }
  }, [recalc]);

  const handlePriceChange = (raw: string) => {
    const formatted = formatPriceInput(raw);
    setPriceDisplay(formatted);
    const digits = raw.replace(/[^\d]/g, "");
    const p = digits ? parseInt(digits, 10) : 0;
    priceRef.current = p;
    recalc(p, region, buyer, nonUK);
  };

  const handleRegion = (r: Region) => {
    setRegion(r);
    if (r !== "england") setNonUK(false);
    recalc(priceRef.current, r, buyer, r !== "england" ? false : nonUK);
  };

  const handleBuyer = (b: BuyerType) => {
    if (b === "ftb" && buyer === "additional") {
      setConflictError(true);
      return;
    }
    if (b === "additional" && buyer === "ftb") {
      setConflictError(true);
      return;
    }
    setConflictError(false);
    setBuyer(b);
    recalc(priceRef.current, region, b, nonUK);
  };

  const handleNonUK = (checked: boolean) => {
    setNonUK(checked);
    recalc(priceRef.current, region, buyer, checked);
  };

  // Standard buyer comparison
  const stdComparison: number | null = (() => {
    if (!result || buyer === "standard" || priceRef.current <= 0) return null;
    const std = calculate(priceRef.current, region, "standard", false);
    return result.total - std.total;
  })();

  const buyerLabel =
    buyer === "ftb" ? "a first-time buyer" : buyer === "additional" ? "an additional dwelling buyer" : "a standard buyer";

  const REGIONS: { id: Region; label: string }[] = [
    { id: "england", label: "England & N. Ireland" },
    { id: "scotland", label: "Scotland" },
    { id: "wales", label: "Wales" },
  ];

  const BUYERS: { id: BuyerType; label: string }[] = [
    { id: "standard", label: "Standard residential" },
    { id: "ftb", label: "First-time buyer" },
    { id: "additional", label: "Second home / buy-to-let" },
  ];

  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: BODY, color: C.dark }}>
      <style>{`
        .sd-pill { transition: background 0.12s, color 0.12s, border-color 0.12s; cursor: pointer; }
        .sd-pill:hover { border-color: #2D6A4F !important; }
        .sd-buyer { transition: background 0.12s, color 0.12s, border-color 0.12s; cursor: pointer; }
        .sd-buyer:hover { border-color: #2D6A4F !important; }
        input[type=text]:focus { outline: none; border-color: #2D6A4F !important; }
      `}</style>
      <SiteHeader />

      <main style={{ maxWidth: 720, margin: "0 auto", padding: "48px 20px 80px" }}>

        {/* Hero */}
        <div style={{ marginBottom: 36 }}>
          <span style={{
            display: "inline-block", fontSize: 11, fontWeight: 500, textTransform: "uppercase",
            letterSpacing: "0.08em", color: C.green, background: C.greenTint,
            borderRadius: 100, padding: "4px 12px", marginBottom: 16,
          }}>
            Free tool · vett
          </span>
          <h1 style={{
            fontFamily: HEADING, fontSize: "clamp(28px, 4vw, 40px)", fontWeight: 400,
            color: C.dark, letterSpacing: "-0.5px", lineHeight: 1.15, margin: "0 0 12px",
          }}>
            Stamp duty calculator
          </h1>
          <p style={{ fontSize: 15, color: C.muted, lineHeight: 1.6, margin: 0 }}>
            Calculate your stamp duty instantly — covers England, Scotland, Wales and Northern Ireland. Updated for 2026.
          </p>
        </div>

        {/* Calculator card */}
        <div style={{
          background: C.card, border: `0.5px solid ${C.border}`,
          borderRadius: 20, padding: 24, marginBottom: 16,
        }}>

          {/* Region selector */}
          <div style={{ marginBottom: 24 }}>
            <div style={{ fontSize: 12, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.06em", color: C.veryMuted, marginBottom: 10 }}>
              Region
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {REGIONS.map(({ id, label }) => {
                const active = region === id;
                return (
                  <button
                    key={id}
                    type="button"
                    className="sd-pill"
                    onClick={() => handleRegion(id)}
                    style={{
                      padding: "7px 14px", fontSize: 13, fontWeight: 500,
                      borderRadius: 20, border: `0.5px solid ${active ? C.green : C.border}`,
                      background: active ? C.green : C.card,
                      color: active ? "#F1EFE8" : C.muted,
                      fontFamily: BODY,
                    }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Price input */}
          <div style={{ marginBottom: 24 }}>
            <label style={{ fontSize: 12, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.06em", color: C.veryMuted, display: "block", marginBottom: 10 }}>
              Property price
            </label>
            <div style={{ position: "relative" }}>
              <span style={{
                position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)",
                fontSize: 16, fontWeight: 500, color: C.muted, pointerEvents: "none",
              }}>
                £
              </span>
              <input
                type="text"
                inputMode="numeric"
                value={priceDisplay}
                onChange={(e) => handlePriceChange(e.target.value)}
                placeholder="e.g. 350,000"
                style={{
                  width: "100%", padding: "13px 16px 13px 30px",
                  fontSize: 16, color: C.dark, background: C.bg,
                  border: `0.5px solid ${C.border}`, borderRadius: 12,
                  fontFamily: BODY, boxSizing: "border-box",
                }}
              />
            </div>
          </div>

          {/* Buyer type */}
          <div style={{ marginBottom: conflictError ? 8 : 20 }}>
            <div style={{ fontSize: 12, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.06em", color: C.veryMuted, marginBottom: 10 }}>
              Buyer type
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 8 }}>
              {BUYERS.map(({ id, label }) => {
                const active = buyer === id;
                return (
                  <button
                    key={id}
                    type="button"
                    className="sd-buyer"
                    onClick={() => handleBuyer(id)}
                    style={{
                      padding: "10px 12px", fontSize: 13, fontWeight: 500, textAlign: "center",
                      borderRadius: 12, border: `0.5px solid ${active ? C.green : C.border}`,
                      background: active ? C.green : C.card,
                      color: active ? "#F1EFE8" : C.muted,
                      fontFamily: BODY,
                    }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          {conflictError && (
            <p style={{ fontSize: 13, color: "#C0392B", margin: "0 0 16px", lineHeight: 1.5 }}>
              First-time buyer relief cannot be combined with additional dwelling rates. Please check your buyer type.
            </p>
          )}

          {/* Non-UK resident (England only) */}
          {region === "england" && (
            <div style={{ marginBottom: 8 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={nonUK}
                  onChange={(e) => handleNonUK(e.target.checked)}
                  style={{ width: 16, height: 16, accentColor: C.green, cursor: "pointer" }}
                />
                <span style={{ fontSize: 13, color: C.muted }}>
                  Non-UK resident <span style={{ color: C.veryMuted }}>(+2% surcharge)</span>
                </span>
              </label>
            </div>
          )}
        </div>

        {/* Results card */}
        {result && priceRef.current > 0 && (
          <div style={{ background: C.dark, borderRadius: 20, padding: 28, marginBottom: 16, color: C.bg }}>

            {/* Tax name + total */}
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 11, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.08em", color: "rgba(241,239,232,0.5)", marginBottom: 8 }}>
                {result.taxName} due
              </div>
              <div style={{ fontFamily: HEADING, fontSize: "clamp(36px, 5vw, 52px)", fontWeight: 400, lineHeight: 1, letterSpacing: "-1px" }}>
                {fmt(result.total)}
              </div>
              <div style={{ fontSize: 13, color: "rgba(241,239,232,0.55)", marginTop: 6 }}>
                {fmtRate(result.effectiveRate)} effective rate
              </div>
            </div>

            {/* Band breakdown */}
            <div style={{ borderTop: "0.5px solid rgba(241,239,232,0.12)", paddingTop: 16, marginBottom: 16 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr auto auto auto", gap: "6px 12px", marginBottom: 8 }}>
                {["Band", "Rate", "Taxable", "Tax"].map((h) => (
                  <span key={h} style={{ fontSize: 10, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.06em", color: "rgba(241,239,232,0.4)" }}>
                    {h}
                  </span>
                ))}
              </div>
              {result.bands.map((b, i) => {
                const muted = b.tax === 0;
                const alpha = muted ? "0.35" : "0.75";
                return (
                  <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr auto auto auto", gap: "4px 12px", marginBottom: 4, alignItems: "center" }}>
                    <span style={{ fontSize: 12, color: `rgba(241,239,232,${alpha})` }}>{b.label}</span>
                    <span style={{ fontSize: 12, color: `rgba(241,239,232,${alpha})`, textAlign: "right" }}>{(b.rate * 100).toFixed(0)}%</span>
                    <span style={{ fontSize: 12, color: `rgba(241,239,232,${alpha})`, textAlign: "right" }}>{fmt(b.taxableAmount)}</span>
                    <span style={{ fontSize: 12, color: `rgba(241,239,232,${muted ? 0.35 : 1})`, textAlign: "right", fontWeight: muted ? 400 : 500 }}>{fmt(b.tax)}</span>
                  </div>
                );
              })}

              {/* Surcharge lines */}
              {result.surchargeLines.map((s, i) => (
                <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr auto auto auto", gap: "4px 12px", marginTop: 4, alignItems: "center" }}>
                  <span style={{ fontSize: 12, color: "rgba(241,239,232,0.75)", gridColumn: "1 / 4" }}>{s.label}</span>
                  <span style={{ fontSize: 12, color: C.bg, fontWeight: 500, textAlign: "right" }}>{fmt(s.amount)}</span>
                </div>
              ))}

              {/* Total row */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr auto auto auto", gap: "4px 12px", marginTop: 8, paddingTop: 8, borderTop: "0.5px solid rgba(241,239,232,0.12)", alignItems: "center" }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: C.bg }}>Total</span>
                <span />
                <span />
                <span style={{ fontSize: 13, fontWeight: 600, color: C.bg, textAlign: "right" }}>{fmt(result.total)}</span>
              </div>
            </div>

            {/* Action buttons */}
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <a
                href="https://vetthome.com"
                style={{
                  display: "block", textAlign: "center", background: C.green, border: "none",
                  borderRadius: 20, padding: "11px 16px", fontSize: 13, fontWeight: 500,
                  color: "#F1EFE8", textDecoration: "none", boxSizing: "border-box",
                }}
              >
                Get a vett report →
              </a>
              <a
                href="/tools/local-businesses"
                style={{
                  display: "block", textAlign: "center", background: "#F1EFE8", border: "none",
                  borderRadius: 20, padding: "11px 16px", fontSize: 13, fontWeight: 500,
                  color: "#1A1108", textDecoration: "none", boxSizing: "border-box",
                }}
              >
                Find tradespeople →
              </a>
            </div>
          </div>
        )}

        {/* Comparison pill */}
        {result && stdComparison !== null && priceRef.current > 0 && (
          <div style={{
            background: C.card, border: `0.5px solid ${C.border}`,
            borderRadius: 12, padding: "12px 16px", marginBottom: 32,
            fontSize: 13, color: C.muted, lineHeight: 1.5,
          }}>
            As {buyerLabel}, you pay{" "}
            <strong style={{ color: C.dark }}>
              {stdComparison > 0 ? `${fmt(stdComparison)} more` : stdComparison < 0 ? `${fmt(Math.abs(stdComparison))} less` : "the same"}
            </strong>{" "}
            than a standard buyer at this price.
          </div>
        )}

        {/* SEO prose */}
        <div style={{ marginTop: result ? 0 : 32 }}>
          <h2 style={{
            fontFamily: HEADING, fontSize: 24, fontWeight: 400, color: C.dark,
            letterSpacing: "-0.3px", margin: "0 0 16px",
            borderLeft: `3px solid ${C.green}`, paddingLeft: 12,
          }}>
            Stamp duty in 2026 — what changed
          </h2>
          <div style={{ fontSize: 15, color: C.muted, lineHeight: 1.75 }}>
            <p style={{ margin: "0 0 16px" }}>
              Stamp duty thresholds in England and Northern Ireland reverted to lower levels on 1 April 2025, following the expiry of the temporary relief introduced in the 2022 mini-budget. The nil-rate band for standard buyers dropped from £250,000 back to £125,000, meaning buyers of properties between £125,001 and £250,000 now pay 2% where previously they paid nothing. First-time buyers saw their relief threshold drop from £425,000 to £300,000, with the relief cap falling from £625,000 to £500,000.
            </p>
            <p style={{ margin: "0 0 16px" }}>
              The additional dwelling surcharge — paid by anyone buying a second home, buy-to-let, or holiday property — increased from 3% to 5% in October 2024. In Scotland, the Additional Dwelling Supplement rose from 6% to 8% in December 2024. These changes significantly increased upfront costs for investors and landlords.
            </p>
            <p style={{ margin: 0 }}>
              Non-UK residents continue to pay a 2% surcharge on top of all other applicable rates in England and Northern Ireland, introduced in April 2021.
            </p>
          </div>

          <h2 style={{
            fontFamily: HEADING, fontSize: 24, fontWeight: 400, color: C.dark,
            letterSpacing: "-0.3px", margin: "40px 0 16px",
            borderLeft: `3px solid ${C.green}`, paddingLeft: 12,
          }}>
            How stamp duty is calculated
          </h2>
          <div style={{ fontSize: 15, color: C.muted, lineHeight: 1.75 }}>
            <p style={{ margin: "0 0 16px" }}>
              Stamp duty is calculated on a marginal basis — like income tax. You do not pay a single flat rate on the full purchase price. Instead, you pay different rates on different portions of the price.
            </p>
            <p style={{ margin: "0 0 16px" }}>
              For example, a standard buyer purchasing a £400,000 property in England pays: 0% on the first £125,000 (£0), 2% on the next £125,000 between £125,001 and £250,000 (£2,500), and 5% on the remaining £150,000 between £250,001 and £400,000 (£7,500) — a total of £10,000. The effective rate is 2.5%, not the 5% top band rate.
            </p>
            <p style={{ margin: 0 }}>
              Stamp duty must be paid within 14 days of completion. Your solicitor or conveyancer will typically handle the submission and payment on your behalf.
            </p>
          </div>

          {/* Internal links */}
          <div style={{ marginTop: 36 }}>
            <div style={{ fontSize: 12, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.06em", color: C.veryMuted, marginBottom: 14 }}>
              Related
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <Link to="/tools/renovation-calculator" style={{ fontSize: 14, color: C.green, textDecoration: "underline", textUnderlineOffset: 3 }}>
                Estimate your renovation costs
              </Link>
              <Link to="/tools/local-businesses" style={{ fontSize: 14, color: C.green, textDecoration: "underline", textUnderlineOffset: 3 }}>
                Find local property professionals
              </Link>
              <Link to="/" style={{ fontSize: 14, color: C.green, textDecoration: "underline", textUnderlineOffset: 3 }}>
                Analyse a Rightmove listing with vett
              </Link>
            </div>
          </div>
        </div>

        {/* FAQ */}
        <div style={{ marginTop: 56 }}>
          <h2 style={{
            fontFamily: HEADING, fontSize: 24, fontWeight: 400, color: C.dark,
            letterSpacing: "-0.3px", margin: "0 0 8px",
          }}>
            Frequently asked questions
          </h2>
          <div style={{ borderTop: `0.5px solid ${C.border}` }}>
            {FAQ_ITEMS.map((item, i) => (
              <FaqItem key={i} q={item.q} a={item.a} />
            ))}
          </div>
        </div>

        {/* Disclaimer */}
        <div style={{ marginTop: 56, borderTop: `0.5px solid ${C.border}`, paddingTop: 28 }}>
          <p style={{ fontSize: 13, color: C.veryMuted, lineHeight: 1.7, textAlign: "center", maxWidth: 600, margin: "0 auto" }}>
            This calculator uses 2026 rates effective from 1 April 2025. Results are for guidance only and do not constitute financial or legal advice. Always confirm your stamp duty liability with a qualified solicitor or conveyancer before exchange. Rates are correct for residential freehold purchases and may differ for leasehold, shared ownership, or mixed-use properties.
          </p>
        </div>

      </main>

      <SiteFooter />
    </div>
  );
}
