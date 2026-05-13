import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import {
  AlertTriangle,
  Bath,
  Bed,
  Calendar,
  Lock,
  MapPin,
  PoundSterling,
  Ruler,
  Sparkles,
  Check,
  TrendingDown,
  Loader2,
} from "lucide-react";
import { SiteHeader, SiteFooter } from "@/components/site-chrome";
import { formatGBP, type AnalysisResult } from "@/lib/mock-analysis";
import { analyseListing } from "@/lib/analyse.functions";
import { PropertyChat } from "@/components/property-chat";
import { createCheckoutSession, sendBuyerPassMagicLink, saveAnalysisForUser } from "@/lib/checkout.functions";
import { validateSingleReportToken, checkBuyerPassByEmail } from "@/lib/access.functions";
import { supabase } from "@/integrations/supabase/client";

const PRICE_SINGLE = "price_1TWXsjCfTT0mXB2cPz7SPIOL";
const PRICE_PASS = "price_1TWXv1CfTT0mXB2clPmEQyob";

type AccessLevel = "none" | "single" | "pass";

function useAccess(listingUrl: string | undefined, token: string | undefined): { level: AccessLevel; email: string | null; loading: boolean } {
  const [state, setState] = useState<{ level: AccessLevel; email: string | null; loading: boolean }>({
    level: "none",
    email: null,
    loading: true,
  });
  const validateToken = useServerFn(validateSingleReportToken);
  const checkPass = useServerFn(checkBuyerPassByEmail);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // 1. Buyer Pass (auth)
      try {
        const { data } = await supabase.auth.getUser();
        const email = data.user?.email ?? null;
        if (email) {
          const r = await checkPass({ data: { email } });
          if (cancelled) return;
          if (r.hasPass) {
            setState({ level: "pass", email, loading: false });
            return;
          }
        }
      } catch { /* ignore */ }

      // 2. Single token
      if (token) {
        try {
          const r = await validateToken({ data: { token, listingUrl: listingUrl ?? null } });
          if (cancelled) return;
          if (r.valid) {
            setState({ level: "single", email: null, loading: false });
            return;
          }
        } catch { /* ignore */ }
      }

      if (!cancelled) setState({ level: "none", email: null, loading: false });
    })();
    return () => { cancelled = true; };
  }, [listingUrl, token, validateToken, checkPass]);

  return state;
}

const searchSchema = z.object({
  url: z.string().optional(),
  text: z.string().optional(),
  token: z.string().optional(),
});


export const Route = createFileRoute("/results")({
  validateSearch: searchSchema,
  head: () => ({
    meta: [
      { title: "Property analysis — Roovr" },
      {
        name: "description",
        content:
          "Your AI-generated property analysis: value score, red flags, true cost and negotiation strategy.",
      },
    ],
  }),
  component: ResultsPage,
});

function ResultsPage() {
  const { url, text, token } = Route.useSearch();
  const navigate = useNavigate();
  const analyseFn = useServerFn(analyseListing);

  const hasInput = Boolean(url || text);

  const query = useQuery({
    queryKey: ["analysis", url ?? "", text ?? ""],
    queryFn: () => analyseFn({ data: { url, text } }),
    enabled: hasInput,
    retry: false,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });

  if (!hasInput) {
    return (
      <div className="min-h-screen bg-background">
        <SiteHeader />
        <main className="mx-auto max-w-xl px-6 py-24 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">No listing to analyse</h1>
          <p className="mt-3 text-muted-foreground">
            Head back to the homepage and paste a Rightmove or Zoopla URL.
          </p>
          <Link
            to="/"
            className="mt-6 inline-flex items-center justify-center rounded-xl bg-primary px-5 py-3 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            Analyse a property
          </Link>
        </main>
        <SiteFooter />
      </div>
    );
  }

  if (query.isPending) {
    return (
      <div className="min-h-screen bg-background">
        <SiteHeader />
        <LoadingState url={url} />
        <SiteFooter />
      </div>
    );
  }

  if (query.isError) {
    const rawMsg = (query.error as Error)?.message || "Something went wrong while analysing this listing.";
    const isBlocked = rawMsg.startsWith("FETCH_BLOCKED");
    const friendlyMsg = isBlocked
      ? "We couldn't automatically read this listing. You can paste the listing description below to get your full analysis."
      : rawMsg;

    return (
      <div className="min-h-screen bg-background">
        <SiteHeader />
        <main className="mx-auto max-w-xl px-6 py-20">
          {isBlocked ? (
            <BlockedFallback url={url} message={friendlyMsg} />
          ) : (
            <div className="text-center">
              <h1 className="text-2xl font-semibold tracking-tight">Analysis failed</h1>
              <p className="mt-3 text-sm text-muted-foreground">{friendlyMsg}</p>
              <div className="mt-6 flex justify-center gap-3">
                <button
                  onClick={() => query.refetch()}
                  className="inline-flex items-center justify-center rounded-xl bg-primary px-5 py-3 text-sm font-medium text-primary-foreground hover:opacity-90"
                >
                  Try again
                </button>
                <button
                  onClick={() => navigate({ to: "/" })}
                  className="inline-flex items-center justify-center rounded-xl border border-border px-5 py-3 text-sm font-medium hover:bg-accent"
                >
                  Start over
                </button>
              </div>
            </div>
          )}
        </main>
        <SiteFooter />
      </div>
    );
  }

  return <ReportView analysis={query.data!} listingUrl={url} token={token} />;
}

function BlockedFallback({ url, message }: { url?: string; message: string }) {
  const navigate = useNavigate();
  const [text, setText] = useState("");
  const trimmed = text.trim();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (trimmed.length < 50) return;
    navigate({ to: "/results", search: { url, text: trimmed } });
  };

  return (
    <div className="rounded-3xl border border-border bg-card p-6 shadow-card sm:p-8">
      <div className="inline-flex items-center gap-2 rounded-full bg-primary-soft px-3 py-1 text-xs font-medium text-primary">
        <AlertTriangle className="h-3.5 w-3.5" /> Couldn't read the listing
      </div>
      <h1 className="mt-3 text-2xl font-semibold tracking-tight">
        Paste the listing description to continue
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">{message}</p>
      {url && (
        <p className="mt-2 truncate text-xs text-muted-foreground">{url}</p>
      )}

      <form onSubmit={handleSubmit} className="mt-5 space-y-3">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={10}
          placeholder="Paste the full listing description here — address, price, beds, key features, agent copy…"
          className="w-full resize-y rounded-xl border border-border bg-background p-3 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
        />
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-muted-foreground">
            Tip: select the description on the listing page and copy-paste it here.
          </p>
          <button
            type="submit"
            disabled={trimmed.length < 50}
            className="inline-flex items-center justify-center rounded-xl bg-primary px-5 py-3 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            Analyse pasted text
          </button>
        </div>
      </form>
    </div>
  );
}

function LoadingState({ url }: { url?: string }) {
  return (
    <main className="mx-auto flex max-w-xl flex-col items-center px-6 py-24 text-center">
      <div className="relative">
        <div
          className="absolute inset-0 animate-ping rounded-full opacity-30"
          style={{ background: "var(--primary)" }}
        />
        <div
          className="relative flex h-16 w-16 items-center justify-center rounded-full"
          style={{ background: "var(--gradient-primary)" }}
        >
          <Loader2 className="h-7 w-7 animate-spin text-primary-foreground" />
        </div>
      </div>
      <h1 className="mt-8 text-2xl font-semibold tracking-tight">Analysing the listing…</h1>
      <p className="mt-3 max-w-md text-sm text-muted-foreground">
        Reading the description, decoding agent jargon, estimating costs and building your
        negotiation strategy. This usually takes 15–30 seconds.
      </p>
      {url && (
        <p className="mt-4 max-w-md truncate text-xs text-muted-foreground">{url}</p>
      )}
      <ul className="mt-8 space-y-2 text-left text-sm text-muted-foreground">
        {[
          "Fetching listing content",
          "Spotting red flags",
          "Calculating true cost",
          "Drafting negotiation strategy",
        ].map((step) => (
          <li key={step} className="flex items-center gap-2">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
            {step}
          </li>
        ))}
      </ul>
    </main>
  );
}

function ReportView({ analysis: a, listingUrl, token }: { analysis: AnalysisResult; listingUrl?: string; token?: string }) {
  const access = useAccess(listingUrl, token);
  const unlocked = access.level !== "none";
  const showChat = access.level === "pass";

  // Auto-save analysis for Buyer Pass users
  const saveFn = useServerFn(saveAnalysisForUser);
  const savedRef = useRef(false);
  useEffect(() => {
    if (showChat && access.email && !savedRef.current && listingUrl) {
      savedRef.current = true;
      saveFn({ data: { email: access.email, listingUrl, analysis: a } }).catch(() => { /* ignore */ });
    }
  }, [showChat, access.email, listingUrl, a, saveFn]);

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />

      <main className="mx-auto max-w-5xl px-6 py-10">
        <Link
          to="/"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          ← Analyse another property
        </Link>

        {/* Property summary */}
        <section className="mt-6 overflow-hidden rounded-3xl border border-border bg-card shadow-card">
          <div className="grid md:grid-cols-[1.2fr_1fr]">
            <img
              src={a.property.image}
              alt={a.property.address}
              className="h-64 w-full object-cover md:h-full"
            />
            <div className="flex flex-col justify-between gap-6 p-6 sm:p-8">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-1 text-sm text-muted-foreground">
                    <MapPin className="h-4 w-4" />
                    {a.property.address}
                  </div>
                  <div className="mt-3 text-3xl font-semibold tracking-tight">
                    {formatGBP(a.property.price)}
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                    <span className="flex items-center gap-1"><Bed className="h-4 w-4" /> {a.property.beds} bed</span>
                    <span className="flex items-center gap-1"><Bath className="h-4 w-4" /> {a.property.baths} bath</span>
                    {a.property.sqft > 0 && (
                      <span className="flex items-center gap-1"><Ruler className="h-4 w-4" /> {a.property.sqft} sq ft</span>
                    )}
                    <span>{a.property.type}</span>
                  </div>
                </div>
                <ScoreBadge score={a.score} label={a.scoreLabel} />
              </div>
              <div className="text-sm text-muted-foreground sm:hidden">
                <span className="font-medium text-foreground">{a.scoreLabel}</span>
              </div>
            </div>
          </div>
        </section>

        {/* Metrics */}
        <section className="mt-8">
          <h2 className="text-xl font-semibold tracking-tight">Key metrics</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard
              label="Price / sq ft"
              value={a.metrics.pricePerSqFt > 0 ? `£${a.metrics.pricePerSqFt}` : "—"}
              icon={PoundSterling}
            />
            <MetricCard
              label="Days on market"
              value={a.metrics.daysOnMarket > 0 ? `${a.metrics.daysOnMarket}` : "—"}
              icon={Calendar}
            />
            <MetricCard
              label="Council tax band"
              value={a.metrics.councilTaxBand}
              icon={MapPin}
            />
            <MetricCard
              label="Stamp duty est."
              value={formatGBP(a.metrics.estimatedStampDuty)}
              hint="Second home rate"
              icon={TrendingDown}
            />
          </div>
        </section>

        {/* Top red flags (free) */}
        <section className="mt-10">
          <div className="flex items-end justify-between">
            <div>
              <h2 className="text-xl font-semibold tracking-tight">Red flags</h2>
              <p className="text-sm text-muted-foreground">
                Top issues spotted in the listing — full list unlocked below.
              </p>
            </div>
            <span className="rounded-full bg-primary-soft px-3 py-1 text-xs font-medium text-primary">
              Free preview
            </span>
          </div>
          <div className="mt-4 space-y-3">
            {a.redFlags.slice(0, 2).map((f, i) => (
              <RedFlagItem key={i} flag={f} />
            ))}
          </div>
        </section>

        {/* Paywall + locked / unlocked content */}
        <section className="mt-10">
          {!unlocked && <PaywallGate listingUrl={listingUrl} />}

          {unlocked ? (
            <div className="space-y-8">
              <UnlockedSection title="Full red flags list">
                <div className="space-y-3">
                  {a.redFlags.slice(2).map((f, i) => (
                    <RedFlagItem key={i} flag={f} />
                  ))}
                </div>
              </UnlockedSection>

              <UnlockedSection title="True cost breakdown">
                <CostBreakdown analysis={a} />
              </UnlockedSection>

              <UnlockedSection title="Negotiation strategy">
                <Negotiation analysis={a} />
              </UnlockedSection>

              <UnlockedSection title="8 questions to ask at the viewing">
                <ol className="list-decimal space-y-2 pl-5 text-sm">
                  {a.viewingQuestions.map((q, i) => (
                    <li key={i}>{q}</li>
                  ))}
                </ol>
              </UnlockedSection>

              {showChat && <PropertyChat analysis={a} />}

              {access.level === "pass" && (
                <div className="text-center">
                  <Link to="/dashboard" style={{ fontSize: 13, color: "#D85A30" }}>
                    Go to your dashboard →
                  </Link>
                </div>
              )}
            </div>
          ) : (
            <div className="relative mt-10">
              <div
                aria-hidden
                className="pointer-events-none select-none space-y-8 opacity-60 blur-[6px]"
              >
                <LockedSection title="Full red flags list">
                  <div className="space-y-3">
                    {a.redFlags.slice(2).map((f, i) => (
                      <RedFlagItem key={i} flag={f} />
                    ))}
                  </div>
                </LockedSection>
                <LockedSection title="True cost breakdown">
                  <CostBreakdown analysis={a} />
                </LockedSection>
                <LockedSection title="Negotiation strategy">
                  <Negotiation analysis={a} />
                </LockedSection>
              </div>
            </div>
          )}
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}

function ScoreBadge({ score, label }: { score: number; label: string }) {
  const pct = (score / 10) * 100;
  const ring = `conic-gradient(var(--primary) ${pct}%, var(--primary-soft) ${pct}%)`;
  return (
    <div className="flex items-center gap-4">
      <div
        className="flex h-24 w-24 items-center justify-center rounded-full"
        style={{ background: ring }}
      >
        <div className="flex h-[84px] w-[84px] flex-col items-center justify-center rounded-full bg-card">
          <span className="text-2xl font-semibold leading-none">{score.toFixed(1)}</span>
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">/ 10</span>
        </div>
      </div>
      <div className="hidden max-w-[160px] sm:block">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">Roovr score</div>
        <div className="text-sm font-medium leading-tight">{label}</div>
      </div>
    </div>
  );
}

function MetricCard({
  label,
  value,
  hint,
  icon: Icon,
}: {
  label: string;
  value: string;
  hint?: string;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-soft">
      <div className="flex items-center justify-between">
        <span className="text-xs uppercase tracking-wider text-muted-foreground">{label}</span>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </div>
      <div className="mt-3 text-2xl font-semibold tracking-tight">{value}</div>
      {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}

function RedFlagItem({
  flag,
}: {
  flag: { severity: "high" | "medium" | "low"; title: string; detail: string };
}) {
  const colors = {
    high: "bg-destructive/10 text-destructive border-destructive/20",
    medium: "bg-warning/15 text-warning-foreground border-warning/30",
    low: "bg-muted text-muted-foreground border-border",
  } as const;
  return (
    <div className="rounded-xl border border-border p-4">
      <div className="flex items-start gap-3">
        <span
          className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${colors[flag.severity]}`}
        >
          <AlertTriangle className="h-3 w-3" />
          {flag.severity}
        </span>
        <div>
          <div className="font-medium">{flag.title}</div>
          <p className="mt-1 text-sm text-muted-foreground">{flag.detail}</p>
        </div>
      </div>
    </div>
  );
}

function LockedSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-6 shadow-soft">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="font-semibold tracking-tight">{title}</h3>
        <Lock className="h-4 w-4 text-muted-foreground" />
      </div>
      {children}
    </div>
  );
}

function UnlockedSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-6 shadow-soft">
      <h3 className="mb-4 font-semibold tracking-tight">{title}</h3>
      {children}
    </div>
  );
}

function CostBreakdown({ analysis }: { analysis: AnalysisResult }) {
  const c = analysis.costs;
  const rows = [
    ["Purchase price", c.purchasePrice],
    ["Stamp duty", c.stampDuty],
    ["Legal fees", c.legalFees],
    ["Survey", c.surveyFees],
    ["Mortgage arrangement", c.mortgageFees],
  ] as const;
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <div>
        <div className="text-xs uppercase tracking-wider text-muted-foreground">
          Total upfront
        </div>
        <div className="mt-1 text-3xl font-semibold tracking-tight">
          {formatGBP(c.totalUpfront)}
        </div>
        <ul className="mt-4 divide-y divide-border text-sm">
          {rows.map(([label, val]) => (
            <li key={label} className="flex justify-between py-2">
              <span className="text-muted-foreground">{label}</span>
              <span className="font-medium">{formatGBP(val as number)}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="rounded-xl bg-primary-soft p-5">
        <div className="text-xs uppercase tracking-wider text-primary">Monthly mortgage</div>
        <div className="mt-1 text-3xl font-semibold tracking-tight text-primary">
          {formatGBP(c.monthlyMortgage)}
        </div>
        <p className="mt-3 text-sm text-foreground/80">{c.mortgageAssumptions}</p>
      </div>
    </div>
  );
}

function Negotiation({ analysis }: { analysis: AnalysisResult }) {
  const n = analysis.negotiation;
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-primary/20 bg-primary-soft p-5">
        <div className="text-xs uppercase tracking-wider text-primary">Recommended offer</div>
        <div className="mt-1 text-2xl font-semibold tracking-tight">
          {formatGBP(n.recommendedOffer.low)} – {formatGBP(n.recommendedOffer.high)}
        </div>
        <p className="mt-2 text-sm text-foreground/80">{n.rationale}</p>
      </div>
      <div>
        <div className="text-xs uppercase tracking-wider text-muted-foreground">Your leverage</div>
        <ul className="mt-2 space-y-2 text-sm">
          {n.leverage.map((l, i) => (
            <li key={i} className="flex items-start gap-2">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              {l}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function PaywallGate({ listingUrl }: { listingUrl?: string }) {
  const checkoutFn = useServerFn(createCheckoutSession);
  const restoreFn = useServerFn(sendBuyerPassMagicLink);
  const [loadingTier, setLoadingTier] = useState<"single" | "pass" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [showRestore, setShowRestore] = useState(false);
  const [restoreEmail, setRestoreEmail] = useState("");
  const [restoreMsg, setRestoreMsg] = useState<string | null>(null);

  const handleBuy = async (tier: "single" | "pass") => {
    setErr(null);
    setLoadingTier(tier);
    try {
      const priceId = tier === "single" ? PRICE_SINGLE : PRICE_PASS;
      const res = await checkoutFn({ data: { priceId, listingUrl: listingUrl ?? "", tier } });
      window.location.href = res.url;
    } catch (e) {
      setErr((e as Error).message || "Couldn't start checkout. Try again.");
      setLoadingTier(null);
    }
  };

  const handleRestore = async (e: React.FormEvent) => {
    e.preventDefault();
    setRestoreMsg(null);
    try {
      const r = await restoreFn({ data: { email: restoreEmail.trim() } });
      if (r.found) setRestoreMsg("Magic link sent — check your inbox.");
      else setRestoreMsg("No Buyer Pass found for that email. If you bought a Single Report, check your original results link.");
    } catch {
      setRestoreMsg("Couldn't send right now. Try again shortly.");
    }
  };

  return (
    <div className="p-6 sm:p-8" style={{ background: "#FFFDF9", borderRadius: 12, border: "0.5px solid rgba(26,17,8,0.12)" }}>
      <div className="inline-flex items-center gap-2" style={{ background: "#FAECE7", color: "#993C1D", borderRadius: 100, padding: "4px 10px", fontSize: 11, fontWeight: 500, letterSpacing: "0.04em" }}>
        <Sparkles className="h-3 w-3" /> UNLOCK THE FULL REPORT
      </div>
      <h3 className="mt-4 text-2xl font-semibold tracking-tight" style={{ color: "#1A1108" }}>
        See every red flag, the true cost and how to negotiate
      </h3>
      <p className="mt-2 text-sm" style={{ color: "#5F5E5A" }}>Pick the option that suits you.</p>

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <PlanCard
          title="Single report"
          price="£4.99"
          cadence="One-off payment"
          cta="Get this report"
          loading={loadingTier === "single"}
          onClick={() => handleBuy("single")}
          features={[
            "Full analysis for this property",
            "All red flags and costs",
            "Viewing questions and negotiation strategy",
          ]}
          footnote="No AI chat, no saving."
        />
        <PlanCard
          title="Buyer Pass"
          price="£29.99"
          cadence="One-off payment · your entire search"
          cta="Get Buyer Pass"
          highlight
          loading={loadingTier === "pass"}
          onClick={() => handleBuy("pass")}
          subnote="Average buyer views 8 properties — works out at £3.75 each."
          features={[
            "Unlimited analyses",
            "All red flags, costs and negotiation",
            "AI chat on every property",
            "Save and compare up to 50 properties",
          ]}
        />
      </div>

      {err && <p className="mt-4 text-sm" style={{ color: "#993C1D" }}>{err}</p>}

      <div className="mt-6 text-center">
        {!showRestore ? (
          <button
            type="button"
            onClick={() => setShowRestore(true)}
            className="text-xs underline-offset-4 hover:underline"
            style={{ color: "#5F5E5A" }}
          >
            Already purchased? Restore your access →
          </button>
        ) : (
          <form onSubmit={handleRestore} className="mx-auto mt-2 max-w-sm text-left">
            <label className="block text-xs" style={{ color: "#5F5E5A" }}>Enter your email</label>
            <div className="mt-2 flex gap-2">
              <input
                type="email"
                required
                value={restoreEmail}
                onChange={(e) => setRestoreEmail(e.target.value)}
                placeholder="you@example.com"
                className="flex-1 px-3 py-2 outline-none"
                style={{ background: "#F1EFE8", borderRadius: 100, fontSize: 13, border: "0.5px solid rgba(26,17,8,0.12)" }}
              />
              <button
                type="submit"
                style={{ background: "#1A1108", color: "#FFFDF9", fontSize: 13, fontWeight: 500, borderRadius: 100, padding: "8px 18px" }}
              >
                Send access link
              </button>
            </div>
            {restoreMsg && <p className="mt-2 text-xs" style={{ color: "#5F5E5A" }}>{restoreMsg}</p>}
          </form>
        )}
      </div>
    </div>
  );
}

function PlanCard({
  title,
  price,
  cadence,
  features,
  highlight,
  cta,
  footnote,
  subnote,
  onClick,
  loading,
}: {
  title: string;
  price: string;
  cadence: string;
  features: string[];
  highlight?: boolean;
  cta: string;
  footnote?: string;
  subnote?: string;
  onClick?: () => void;
  loading?: boolean;
}) {
  return (
    <div
      className="relative p-6"
      style={{
        background: "#FFFDF9",
        borderRadius: 12,
        border: highlight ? "2px solid #D85A30" : "0.5px solid rgba(26,17,8,0.12)",
      }}
    >
      {highlight && (
        <span
          className="absolute -top-3 right-6 uppercase"
          style={{ background: "#FAECE7", color: "#993C1D", fontSize: 10, fontWeight: 500, letterSpacing: "0.08em", borderRadius: 100, padding: "4px 10px" }}
        >
          Most popular
        </span>
      )}
      <h4 style={{ fontSize: 18, fontWeight: 500, color: "#1A1108" }}>{title}</h4>
      <div className="mt-3 flex items-baseline gap-1">
        <span style={{ fontSize: 28, fontWeight: 500, color: "#1A1108", letterSpacing: "-0.5px" }}>{price}</span>
      </div>
      <p className="mt-1" style={{ fontSize: 12, color: "#888780" }}>{cadence}</p>
      {subnote && <p className="mt-2" style={{ fontSize: 12, color: "#5F5E5A" }}>{subnote}</p>}
      <ul className="mt-5 space-y-2.5">
        {features.map((f) => (
          <li key={f} className="flex items-start gap-2.5" style={{ fontSize: 14, color: "#1A1108" }}>
            <Check className="mt-0.5 h-4 w-4 shrink-0" style={{ color: "#D85A30" }} />
            {f}
          </li>
        ))}
      </ul>
      {footnote && <p className="mt-4" style={{ fontSize: 12, color: "#888780" }}>{footnote}</p>}
      <button
        type="button"
        onClick={onClick}
        disabled={loading}
        className="mt-6 inline-flex w-full items-center justify-center gap-2 transition-opacity hover:opacity-90 disabled:opacity-60"
        style={{
          background: highlight ? "#D85A30" : "#1A1108",
          color: "#FFFDF9",
          fontSize: 13,
          fontWeight: 500,
          borderRadius: 100,
          padding: "12px 24px",
        }}
      >
        {loading && <Loader2 className="h-4 w-4 animate-spin" />}
        {cta}
      </button>
    </div>
  );
}

function PlanCard({
  title,
  price,
  cadence,
  features,
  highlight,
  cta,
  footnote,
  subnote,
}: {
  title: string;
  price: string;
  cadence: string;
  features: string[];
  highlight?: boolean;
  cta: string;
  footnote?: string;
  subnote?: string;
}) {
  return (
    <div
      className={`relative rounded-2xl border p-6 ${
        highlight
          ? "border-primary bg-primary text-primary-foreground shadow-glow"
          : "border-border bg-card"
      }`}
    >
      {highlight && (
        <span className="absolute -top-3 right-5 rounded-full bg-card px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-primary border border-primary/20 shadow-soft">
          Most popular
        </span>
      )}
      <div className="flex items-baseline justify-between">
        <h4 className="text-lg font-semibold">{title}</h4>
      </div>
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
            <Check className={`mt-0.5 h-4 w-4 shrink-0 ${highlight ? "text-primary-foreground" : "text-primary"}`} />
            {f}
          </li>
        ))}
      </ul>
      {footnote && (
        <p className={`mt-4 text-xs ${highlight ? "text-primary-foreground/80" : "text-muted-foreground"}`}>
          {footnote}
        </p>
      )}
      <button
        type="button"
        className={`mt-6 w-full rounded-xl px-4 py-3 text-sm font-medium transition-opacity hover:opacity-90 ${
          highlight
            ? "bg-card text-primary"
            : "bg-primary text-primary-foreground"
        }`}
      >
        {cta}
      </button>
    </div>
  );
}
