import { createFileRoute } from "@tanstack/react-router";
import { SiteHeader, SiteFooter } from "@/components/site-chrome";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: "Privacy Policy — Roovr" },
      { name: "description", content: "How Roovr collects, uses, and stores your data. UK GDPR compliant." },
      { property: "og:title", content: "Privacy Policy — Roovr" },
      { property: "og:description", content: "How Roovr collects, uses, and stores your data. UK GDPR compliant." },
    ],
  }),
  component: PrivacyPage,
});

function Section({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="mt-10">
      <h2 style={{ fontSize: 20, fontWeight: 500, color: "#1A1108", letterSpacing: "-0.4px" }}>
        {n}. {title}
      </h2>
      <div className="mt-3 max-w-2xl" style={{ fontSize: 15, color: "#5F5E5A", lineHeight: 1.7 }}>
        {children}
      </div>
    </section>
  );
}

function PrivacyPage() {
  return (
    <div className="min-h-screen flex flex-col" style={{ background: "#FFFDF9" }}>
      <SiteHeader />
      <main className="mx-auto w-full max-w-3xl px-8 py-20 flex-1">
        <h1 style={{ fontSize: 40, fontWeight: 500, color: "#1A1108", letterSpacing: "-1.5px", lineHeight: 1.15 }}>
          Privacy Policy
        </h1>
        <p className="mt-3" style={{ fontSize: 13, color: "#888780" }}>Last updated: 14 May 2026</p>

        <Section n={1} title="What data we collect">
          <ul className="list-disc pl-5 space-y-1.5">
            <li>Email address (for magic link authentication and report delivery)</li>
            <li>Payment reference number (via Stripe — we never store card details)</li>
            <li>Property URLs you submit for analysis</li>
            <li>Manual inputs you provide (sq ft, EPC rating, flood zone, council tax band)</li>
            <li>Basic usage data (pages visited, reports generated)</li>
          </ul>
        </Section>
        <Section n={2} title="How we use your data">
          To deliver your report, send magic link login emails, and save your analyses to your dashboard. We do not use your data for advertising.
        </Section>
        <Section n={3} title="How long we retain your data">
          <ul className="list-disc pl-5 space-y-1.5">
            <li>All report data (Single Report and Buyer Pass) is retained for 365 days from the date of purchase, after which it is automatically deleted from your account</li>
            <li>You can email any report to yourself at any time using the "Email me my report" button, giving you a permanent copy</li>
            <li>
              You can request deletion of your data at any time by emailing{" "}
              <a href="mailto:support@roovr.co" style={{ color: "#1B4332" }} className="hover:underline">support@roovr.co</a>
            </li>
          </ul>
        </Section>
        <Section n={4} title="Third-party processors we use">
          <ul className="list-disc pl-5 space-y-1.5">
            <li>
              Stripe — payment processing (
              <a href="https://stripe.com/privacy" target="_blank" rel="noopener noreferrer" style={{ color: "#1B4332" }} className="hover:underline">stripe.com/privacy</a>
              )
            </li>
            <li>Resend — transactional email delivery</li>
            <li>Anthropic — AI analysis engine powering report generation</li>
            <li>PropertyData — UK property data provider</li>
            <li>Lovable — application hosting and infrastructure</li>
          </ul>
        </Section>
        <Section n={5} title="Cookies">
          <ul className="list-disc pl-5 space-y-1.5">
            <li>We use essential cookies only to maintain your session and authentication state</li>
            <li>We do not use advertising or tracking cookies</li>
            <li>By using Roovr you consent to essential cookies</li>
          </ul>
        </Section>
        <Section n={6} title="Your rights">
          <ul className="list-disc pl-5 space-y-1.5">
            <li>You have the right to access, correct, or delete your personal data</li>
            <li>We will never sell your data to third parties</li>
            <li>
              Contact{" "}
              <a href="mailto:support@roovr.co" style={{ color: "#1B4332" }} className="hover:underline">support@roovr.co</a>{" "}
              to exercise your rights
            </li>
          </ul>
        </Section>
        <Section n={7} title="Contact">
          <a href="mailto:support@roovr.co" style={{ color: "#1B4332" }} className="hover:underline">support@roovr.co</a>
        </Section>
      </main>
      <SiteFooter />
    </div>
  );
}
