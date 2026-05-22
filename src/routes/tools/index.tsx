import { createFileRoute, Link } from "@tanstack/react-router";
import { IconTools, IconMapPin, IconReceipt, IconChartLine, IconArrowRight } from "@tabler/icons-react";
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
  muted: "#888780",
  border: "rgba(26,17,8,0.12)",
};

// ── SEO ────────────────────────────────────────────────────────────────────────
const itemListSchema = {
  "@context": "https://schema.org",
  "@type": "ItemList",
  name: "vett free property tools",
  itemListElement: [
    { "@type": "ListItem", position: 1, name: "Renovation cost calculator", url: `${SITE_URL}/tools/renovation-calculator` },
    { "@type": "ListItem", position: 2, name: "Find local professionals", url: `${SITE_URL}/tools/local-businesses` },
    { "@type": "ListItem", position: 3, name: "Stamp duty calculator", url: `${SITE_URL}/tools/stamp-duty` },
  ],
};

export const Route = createFileRoute("/tools/")({
  head: () => ({
    meta: buildPageMeta({
      title: "Free UK Property Tools — Calculators & Finders | vett",
      description:
        "Free tools for UK home buyers: renovation cost calculator, stamp duty calculator, and a local professional finder. No sign-up required.",
      canonicalPath: "/tools",
      ogImage: DEFAULT_OG_IMAGE,
    }),
    links: [buildCanonicalLink("/tools")],
    scripts: [jsonLdScript(itemListSchema)],
  }),
  component: ToolsIndex,
});

// ── Tool card data ─────────────────────────────────────────────────────────────
const TOOLS = [
  {
    Icon: IconTools,
    title: "Renovation cost calculator",
    desc: "Estimate the cost of kitchens, extensions, loft conversions and more — with regional pricing for 2026.",
    cta: "Open calculator →",
    href: "/tools/renovation-calculator",
    live: true,
  },
  {
    Icon: IconMapPin,
    title: "Find local professionals",
    desc: "Search top-rated surveyors, solicitors, architects, trades and more near any UK postcode.",
    cta: "Find professionals →",
    href: "/tools/local-businesses",
    live: true,
  },
  {
    Icon: IconReceipt,
    title: "Stamp duty calculator",
    desc: "Calculate stamp duty across England, Scotland, Wales and N. Ireland — all buyer types covered.",
    cta: "Calculate stamp duty →",
    href: "/tools/stamp-duty",
    live: true,
  },
  {
    Icon: IconChartLine,
    title: "Market trends",
    desc: "Track UK house price trends, time-on-market and the latest property market data by region.",
    cta: "Coming soon",
    href: null,
    live: false,
  },
];

// ── Component ──────────────────────────────────────────────────────────────────
function ToolsIndex() {
  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: BODY, color: C.dark }}>
      <style>{`
        .tool-card {
          transition: border-color 150ms ease;
          border: 0.5px solid rgba(26,17,8,0.12);
        }
        .tool-card:hover {
          border-color: #2D6A4F;
        }
        .tool-card-dead {
          border: 0.5px solid rgba(26,17,8,0.12);
        }
        .tool-cta {
          transition: color 200ms ease;
          color: #2D6A4F;
        }
        .tool-cta:hover {
          color: #1A1108;
        }
        @media (min-width: 640px) {
          .tools-grid { grid-template-columns: repeat(2, 1fr) !important; }
        }
      `}</style>

      <SiteHeader />

      <main>
        {/* Hero */}
        <div style={{ textAlign: "center", padding: "56px 24px 40px", maxWidth: 640, margin: "0 auto" }}>
          <span style={{
            display: "inline-block", fontSize: 11, fontWeight: 500,
            textTransform: "uppercase", letterSpacing: "0.08em",
            color: "#3B6D11", background: C.greenTint,
            border: "0.5px solid #C0DD97", borderRadius: 100,
            padding: "4px 14px", marginBottom: 20,
          }}>
            Free tools · vett
          </span>

          <h1 style={{
            fontFamily: HEADING, fontSize: "clamp(26px, 5vw, 40px)",
            fontWeight: 700, color: C.dark, letterSpacing: "-0.5px",
            lineHeight: 1.15, margin: "0 0 16px",
          }}>
            Free tools for UK home buyers
          </h1>

          <p style={{
            fontSize: 15, color: C.muted, lineHeight: 1.65,
            maxWidth: 480, margin: "0 auto",
          }}>
            Everything you need to make a confident offer — estimate costs, find trusted professionals, and calculate your tax. All free, no sign-up.
          </p>
        </div>

        {/* Tool card grid */}
        <div style={{ maxWidth: 760, margin: "0 auto", padding: "0 20px 12px" }}>
          <div
            className="tools-grid"
            style={{ display: "grid", gridTemplateColumns: "1fr", gap: 14 }}
          >
            {TOOLS.map(({ Icon, title, desc, cta, href, live }) => {
              const inner = (
                <div
                  className={live ? "tool-card" : "tool-card-dead"}
                  style={{
                    background: C.card,
                    borderRadius: 16,
                    padding: 20,
                    display: "flex",
                    flexDirection: "column",
                    gap: 12,
                    cursor: live ? "pointer" : "default",
                    opacity: live ? 1 : 0.6,
                    height: "100%",
                    boxSizing: "border-box",
                    textDecoration: "none",
                  }}
                >
                  {/* Top row: icon + badge */}
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
                    <div style={{
                      width: 40, height: 40, borderRadius: 10,
                      background: C.greenTint,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      flexShrink: 0,
                    }}>
                      <Icon size={20} color={C.green} />
                    </div>
                    {live ? (
                      <span style={{
                        fontSize: 10, fontWeight: 600, textTransform: "uppercase",
                        letterSpacing: "0.06em", color: "#3B6D11",
                        background: C.greenTint, borderRadius: 10,
                        padding: "2px 8px",
                      }}>
                        Free
                      </span>
                    ) : (
                      <span style={{
                        fontSize: 10, fontWeight: 600, textTransform: "uppercase",
                        letterSpacing: "0.06em", color: C.muted,
                        background: "rgba(26,17,8,0.05)", borderRadius: 10,
                        padding: "2px 8px",
                      }}>
                        Soon
                      </span>
                    )}
                  </div>

                  {/* Title + desc */}
                  <div style={{ flex: 1 }}>
                    <div style={{
                      fontFamily: HEADING, fontSize: 18, fontWeight: 700,
                      color: C.dark, lineHeight: 1.3, marginBottom: 6,
                    }}>
                      {title}
                    </div>
                    <p style={{ fontSize: 13, color: C.muted, lineHeight: 1.55, margin: 0 }}>
                      {desc}
                    </p>
                  </div>

                  {/* CTA */}
                  <div style={{ marginTop: "auto", paddingTop: 4 }}>
                    {live ? (
                      <span
                        className="tool-cta"
                        style={{ fontSize: 13, fontWeight: 500, display: "inline-flex", alignItems: "center", gap: 4 }}
                      >
                        {cta}
                      </span>
                    ) : (
                      <span style={{ fontSize: 13, fontWeight: 500, color: C.muted }}>
                        {cta}
                      </span>
                    )}
                  </div>
                </div>
              );

              return href ? (
                <Link key={title} to={href as any} style={{ textDecoration: "none", display: "block" }}>
                  {inner}
                </Link>
              ) : (
                <div key={title}>{inner}</div>
              );
            })}
          </div>
        </div>

        {/* Conversion block */}
        <div style={{ maxWidth: 760, margin: "8px auto 40px", padding: "0 20px" }}>
          <div style={{
            background: C.dark, borderRadius: 16,
            padding: "28px 32px", textAlign: "center",
          }}>
            <h2 style={{
              fontFamily: HEADING, fontSize: 22, fontWeight: 700,
              color: "#F1EFE8", letterSpacing: "-0.3px",
              lineHeight: 1.25, margin: "0 0 12px",
            }}>
              Ready to analyse a real listing?
            </h2>
            <p style={{
              fontSize: 14, color: "rgba(241,239,232,0.65)",
              lineHeight: 1.65, maxWidth: 440, margin: "0 auto 20px",
            }}>
              These tools help you prepare. When you've found a property, run the full listing through vett for red flags, fair value, and a negotiation strategy in under 2 minutes.
            </p>
            <a
              href="https://vetthome.com"
              style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                background: C.green, color: "#F1EFE8",
                fontSize: 13, fontWeight: 500, borderRadius: 20,
                padding: "11px 22px", textDecoration: "none",
              }}
            >
              Vett a property <IconArrowRight size={14} />
            </a>
          </div>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
