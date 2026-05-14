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

        <Section n={1} title="Data we collect">
          Email address (provided at checkout), property listing URLs you analyse, analysis results stored against your account.
        </Section>
        <Section n={2} title="How we use your data">
          To deliver your report, send magic link login emails, and save your analyses to your dashboard. We do not use your data for advertising.
        </Section>
        <Section n={3} title="Data storage">
          Data is stored securely via Supabase. Emails are sent via Resend. Payment processing is handled by Stripe. None of these providers sell your data.
        </Section>
        <Section n={4} title="Third parties">
          Stripe (payments), Resend (email delivery), Anthropic (AI analysis generation), Supabase (database). No data is sold to third parties.
        </Section>
        <Section n={5} title="Data retention">
          Account data is retained for 12 months after your last login. To delete your data at any time, email{" "}
          <a href="mailto:hello@roovr.co" style={{ color: "#D85A30" }} className="hover:underline">hello@roovr.co</a>{" "}
          and we will remove it within 7 days.
        </Section>
        <Section n={6} title="Your rights">
          Under UK GDPR you have the right to access, correct, or delete your personal data. Contact{" "}
          <a href="mailto:hello@roovr.co" style={{ color: "#D85A30" }} className="hover:underline">hello@roovr.co</a>{" "}
          to exercise these rights.
        </Section>
        <Section n={7} title="Cookies">
          We use essential cookies only for authentication. No tracking, advertising, or third-party analytics cookies.
        </Section>
        <Section n={8} title="Contact">
          <a href="mailto:hello@roovr.co" style={{ color: "#D85A30" }} className="hover:underline">hello@roovr.co</a>
        </Section>
      </main>
      <SiteFooter />
    </div>
  );
}
