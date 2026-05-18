import { createFileRoute } from "@tanstack/react-router";
import { SiteHeader, SiteFooter } from "@/components/site-chrome";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

export const Route = createFileRoute("/faq")({
  head: () => ({
    meta: [
      { title: "FAQ — vett" },
      { name: "description", content: "Answers to common questions about vett — pricing, accuracy, supported sites, refunds and more." },
      { property: "og:title", content: "FAQ — vett" },
      { property: "og:description", content: "Answers to common questions about vett — pricing, accuracy, supported sites, refunds and more." },
    ],
  }),
  component: FaqPage,
});

const FAQS: { q: string; a: React.ReactNode }[] = [
  {
    q: "What is vett?",
    a: "vett is an AI-powered property analysis tool that helps UK home buyers make smarter, more informed decisions. Paste any Rightmove listing URL and get a full report in minutes — including red flags, true cost breakdown, negotiation strategy, nearby schools, crime statistics, broadband speeds, flood risk, and more.",
  },
  {
    q: "How does it work?",
    a: "Paste a Rightmove listing URL into the search box. Our AI analyses the listing description, pricing, local data, and market conditions to produce a detailed report. The full report typically takes 60-90 seconds to generate.",
  },
  {
    q: "Which countries and property sites do you support?",
    a: "Currently vett works best with Rightmove listings and covers UK properties only. We're actively working on adding Zoopla and other major UK property portals. Support for the US, Europe, Australia, Canada and other countries is coming soon.",
  },
  {
    q: "What's the difference between a Single Report and a Buyer Pass?",
    a: "A Single Report (£4.99) gives you a full analysis of one property, saved to your account. A Buyer Pass (£24.99) gives you unlimited analyses for 90 days, plus AI chat on every property and property score comparison — ideal if you're actively searching across multiple properties.",
  },
  {
    q: "Is this a subscription?",
    a: "No. Both the Single Report and Buyer Pass are one-off payments with no auto-renewal and no hidden fees.\n\nThe Buyer Pass gives you 90 days of unlimited access from the date of purchase. We'll send you a reminder email 7 days before your pass expires, and again the day before, giving you the option to purchase a new 90-day Buyer Pass or move to a monthly subscription at £7.99 per month — whichever suits you best. Nothing renews automatically.",
  },
  {
    q: "How accurate is the data?",
    a: "vett uses a combination of AI analysis and real data from trusted sources including PropertyData, Environment Agency, Ofcom, and DfE/Ofsted. AI-generated content (red flags, negotiation strategy, area analysis) is based on Claude's reasoning and should be treated as advisory. vett cannot be held liable for any decisions made based on report content. Always verify key information independently and seek professional advice from a solicitor, surveyor, and mortgage broker before making any offer.",
  },
  {
    q: "Can I use vett on my phone?",
    a: "Yes — vett works on mobile, tablet, and desktop. We recommend keeping your screen on while the analysis runs (60-90 seconds) as some mobile browsers may pause background processes when the screen locks.",
  },
  {
    q: "What happens to my reports after I buy them?",
    a: "Your reports are saved to your account and accessible from your dashboard for 365 days from the date of purchase — this applies to both Single Reports and Buyer Pass reports. After 365 days, reports are automatically removed from your account. You can email any report to yourself at any time using the 'Email me my report' button on the report page, so you always have a permanent copy if you need one.",
  },
  {
    q: "Is my payment information secure?",
    a: "Yes. All payments are processed securely by Stripe, one of the world's leading payment providers. vett never stores your card details.",
  },
  {
    q: "The analysis failed or I got an error — what should I do?",
    a: (
      <>
        If your analysis fails, try running it again with the same URL. If the problem persists, email us at{" "}
        <a href="mailto:support@roovr.co" className="underline" style={{ color: "#1A1108" }}>support@roovr.co</a>{" "}
        and we'll resolve it promptly. If the issue is on our side, we'll always make it right.
      </>
    ),
  },
  {
    q: "Do you offer refunds?",
    a: (
      <>
        As reports are generated instantly using AI and third-party data, we're unable to offer refunds once a report has been generated. If you experience a technical issue that prevented you from accessing your report, please contact us at{" "}
        <a href="mailto:support@roovr.co" className="underline" style={{ color: "#1A1108" }}>support@roovr.co</a>{" "}
        and we'll resolve it.
      </>
    ),
  },
];

function FaqPage() {
  const HEADING = "'Playfair Display', Georgia, serif";
  return (
    <div className="min-h-screen flex flex-col" style={{ background: "#F1EFE8" }}>
      <SiteHeader />
      <main className="mx-auto w-full max-w-3xl px-6 sm:px-8 py-16 sm:py-24 flex-1">
        <div
          style={{
            fontSize: 11,
            fontWeight: 500,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            color: "#2D6A4F",
          }}
        >
          FAQ
        </div>
        <h1
          className="mt-4"
          style={{
            fontFamily: HEADING,
            fontWeight: 400,
            fontSize: 48,
            color: "#1A1108",
            letterSpacing: "-1px",
            lineHeight: 1.1,
          }}
        >
          Frequently asked questions
        </h1>
        <p className="mt-4" style={{ fontSize: 16, fontWeight: 300, color: "#5F5E5A", lineHeight: 1.7 }}>
          Everything you need to know about vett. Can't find an answer?{" "}
          <a href="mailto:support@roovr.co" className="hover:underline" style={{ color: "#2D6A4F", fontWeight: 400 }}>
            Email support@roovr.co
          </a>
          .
        </p>

        <div
          className="mt-10 p-4 sm:p-6"
          style={{ background: "#FFFDF9", border: "0.5px solid rgba(26,17,8,0.1)", borderRadius: 16 }}
        >
          <Accordion type="single" collapsible className="w-full">
            {FAQS.map((item, i) => (
              <AccordionItem
                key={i}
                value={`item-${i}`}
                className="border-b last:border-b-0"
                style={{ borderColor: "rgba(26,17,8,0.08)" }}
              >
                <AccordionTrigger
                  className="py-5 text-left hover:no-underline"
                  style={{ fontFamily: HEADING, fontSize: 18, fontWeight: 400, color: "#1A1108", letterSpacing: "-0.2px" }}
                >
                  {item.q}
                </AccordionTrigger>
                <AccordionContent
                  className="pb-5 whitespace-pre-line"
                  style={{ fontSize: 15, fontWeight: 300, color: "#5F5E5A", lineHeight: 1.75 }}
                >
                  {item.a}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
