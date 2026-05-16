import { createFileRoute } from "@tanstack/react-router";
import { SiteHeader, SiteFooter } from "@/components/site-chrome";

export const Route = createFileRoute("/about")({
  head: () => ({
    meta: [
      { title: "About Roovr — Honest AI property analysis for UK home buyers" },
      {
        name: "description",
        content:
          "Why we built Roovr: an AI property analysis tool that gives UK home buyers honest red flags, true costs and viewing questions in 60 to 90 seconds.",
      },
      { property: "og:title", content: "About Roovr — Honest AI property analysis for UK home buyers" },
      {
        property: "og:description",
        content:
          "Why we built Roovr: an AI property analysis tool that gives UK home buyers honest red flags, true costs and viewing questions in 60 to 90 seconds.",
      },
    ],
  }),
  component: AboutPage,
});

const HEADING = "'Playfair Display', Georgia, serif";

function Section({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <section className="mt-14">
      <h2 style={{ fontFamily: HEADING, fontWeight: 400, fontSize: 28, color: "#1A1108", letterSpacing: "-0.3px" }}>
        {heading}
      </h2>
      <p
        className="mt-4 max-w-2xl"
        style={{ fontSize: 16, fontWeight: 300, color: "#5F5E5A", lineHeight: 1.75 }}
      >
        {children}
      </p>
    </section>
  );
}

function AboutPage() {
  return (
    <div className="min-h-screen flex flex-col" style={{ background: "#F1EFE8" }}>
      <SiteHeader />
      <main className="mx-auto w-full max-w-3xl px-6 sm:px-8 py-20 sm:py-28 flex-1">
        <div
          style={{
            fontSize: 11,
            fontWeight: 500,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            color: "#2D6A4F",
          }}
        >
          About Roovr
        </div>
        <h1
          className="mt-4"
          style={{
            fontFamily: HEADING,
            fontWeight: 400,
            fontSize: 52,
            color: "#1A1108",
            letterSpacing: "-1px",
            lineHeight: 1.05,
          }}
        >
          Why we built <em style={{ fontStyle: "italic", color: "#2D6A4F" }}>Roovr</em>
        </h1>
        <p
          className="mt-7 max-w-2xl"
          style={{ fontSize: 18, fontWeight: 300, color: "#5F5E5A", lineHeight: 1.7 }}
        >
          Buying a home is the biggest financial decision most people will ever make. Yet buyers go into viewings armed with nothing more than a listing description written by the agent trying to sell it. We built Roovr to change that. Paste any Rightmove or Zoopla listing and get an honest, AI-powered analysis in 60 to 90 seconds — red flags, true costs, fair value, and exactly what to ask at the viewing. No estate agent spin. Just the facts.
        </p>

        <Section heading="What Roovr is">
          Roovr is an AI property analysis tool for UK home buyers. It reads listing descriptions, extracts key data, and surfaces everything an experienced buyer would notice — written in plain English, not agent jargon.
        </Section>

        <Section heading="What Roovr is not">
          Roovr is not a solicitor, surveyor, or financial advisor. Every report is AI-generated and advisory only. Always verify important information independently and seek professional advice before making any offer.
        </Section>

        <Section heading="Get in touch">
          Questions, feedback, or press enquiries — email us at{" "}
          <a href="mailto:support@roovr.co" style={{ color: "#2D6A4F", fontWeight: 400 }} className="hover:underline">
            support@roovr.co
          </a>
        </Section>
      </main>
      <SiteFooter />
    </div>
  );
}
