import { createFileRoute } from "@tanstack/react-router";
import { SiteHeader, SiteFooter } from "@/components/site-chrome";

export const Route = createFileRoute("/about")({
  head: () => ({
    meta: [
      { title: "About Roovr — Honest AI property analysis for UK home buyers" },
      {
        name: "description",
        content:
          "Why we built Roovr: an AI property analysis tool that gives UK home buyers honest red flags, true costs and viewing questions in 30 seconds.",
      },
      { property: "og:title", content: "About Roovr — Honest AI property analysis for UK home buyers" },
      {
        property: "og:description",
        content:
          "Why we built Roovr: an AI property analysis tool that gives UK home buyers honest red flags, true costs and viewing questions in 30 seconds.",
      },
    ],
  }),
  component: AboutPage,
});

function Section({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <section className="mt-12">
      <h2 style={{ fontSize: 22, fontWeight: 500, color: "#1A1108", letterSpacing: "-0.5px" }}>
        {heading}
      </h2>
      <p
        className="mt-4 max-w-2xl"
        style={{ fontSize: 15, color: "#5F5E5A", lineHeight: 1.7 }}
      >
        {children}
      </p>
    </section>
  );
}

function AboutPage() {
  return (
    <div className="min-h-screen flex flex-col" style={{ background: "#FFFDF9" }}>
      <SiteHeader />
      <main className="mx-auto w-full max-w-3xl px-8 py-20 flex-1">
        <h1 style={{ fontSize: 40, fontWeight: 500, color: "#1A1108", letterSpacing: "-1.5px", lineHeight: 1.15 }}>
          Why we built <span style={{ color: "#D85A30" }}>Roovr</span>
        </h1>
        <p
          className="mt-6 max-w-2xl"
          style={{ fontSize: 16, color: "#5F5E5A", lineHeight: 1.7 }}
        >
          Buying a home is the biggest financial decision most people will ever make. Yet buyers go into viewings armed with nothing more than a listing description written by the agent trying to sell it. We built Roovr to change that. Paste any Rightmove or Zoopla listing and get an honest, AI-powered analysis in 30 seconds — red flags, true costs, fair value, and exactly what to ask at the viewing. No estate agent spin. Just the facts.
        </p>

        <Section heading="What Roovr is">
          Roovr is an AI property analysis tool for UK home buyers. It reads listing descriptions, extracts key data, and surfaces everything an experienced buyer would notice — written in plain English, not agent jargon.
        </Section>

        <Section heading="What Roovr is not">
          Roovr is not a solicitor, surveyor, or financial advisor. Every report is AI-generated and advisory only. Always verify important information independently and seek professional advice before making any offer.
        </Section>

        <Section heading="Get in touch">
          Questions, feedback, or press enquiries — email us at{" "}
          <a href="mailto:hello@roovr.co" style={{ color: "#D85A30" }} className="hover:underline">
            hello@roovr.co
          </a>
        </Section>
      </main>
      <SiteFooter />
    </div>
  );
}
