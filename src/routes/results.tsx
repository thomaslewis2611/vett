import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { z } from "zod";
import {
  AlertTriangle,
  Calendar,
  Info,
  Lock,
  PoundSterling,
  Sparkles,
  Check,
  TrendingDown,
  Loader2,
} from "lucide-react";
import { SiteHeader, SiteFooter } from "@/components/site-chrome";
import { DisclaimerBar } from "@/components/disclaimer-bar";
import { formatGBP, type AnalysisResult } from "@/lib/mock-analysis";
import { analyseListing } from "@/lib/analyse.functions";
import { PropertyChat } from "@/components/property-chat";
import { createCheckoutSession, sendBuyerPassMagicLink, saveAnalysisForUser, getSavedAnalysis } from "@/lib/checkout.functions";
import { sendReportEmail } from "@/lib/email-report.functions";
import { validateSingleReportToken, checkBuyerPassByEmail, getSingleReportByEmail } from "@/lib/access.functions";
import { supabase } from "@/integrations/supabase/client";

const PRICE_SINGLE = "price_1TWXsjCfTT0mXB2cPz7SPIOL";
const PRICE_PASS = "price_1TWtPLCfTT0mXB2cU829oJlb";

const ANALYSIS_CACHE_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours
const ANALYSIS_CACHE_PREFIX = "roovr:analysis:";

function analysisCacheKey(url?: string, text?: string, token?: string) {
  return `${ANALYSIS_CACHE_PREFIX}${url ?? ""}|${text ?? ""}|${token ?? ""}`;
}

function readCachedAnalysis(url?: string, text?: string, token?: string): AnalysisResult | undefined {
  if (typeof window === "undefined") return undefined;
  if (!url && !text) return undefined;
  try {
    const raw = sessionStorage.getItem(analysisCacheKey(url, text, token));
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as { savedAt: number; analysis: AnalysisResult };
    if (!parsed?.savedAt || Date.now() - parsed.savedAt > ANALYSIS_CACHE_TTL_MS) {
      sessionStorage.removeItem(analysisCacheKey(url, text, token));
      return undefined;
    }
    return parsed.analysis;
  } catch {
    return undefined;
  }
}

function writeCachedAnalysis(analysis: AnalysisResult, url?: string, text?: string, token?: string) {
  if (typeof window === "undefined") return;
  if (!url && !text) return;
  try {
    sessionStorage.setItem(
      analysisCacheKey(url, text, token),
      JSON.stringify({ savedAt: Date.now(), analysis })
    );
  } catch { /* ignore quota */ }
}

type StampDutyMode = "main" | "additional" | "ftb";

function calcStampDuty(price: number, mode: StampDutyMode): number {
  if (!price || price <= 0) return 0;
  // First-time buyer relief (England, only if price ≤ £625,000)
  if (mode === "ftb" && price <= 625000) {
    if (price <= 425000) return 0;
    return Math.round((price - 425000) * 0.05);
  }
  // Standard residential bands (England)
  const bands: { upTo: number; rate: number }[] = [
    { upTo: 125000, rate: 0 },
    { upTo: 250000, rate: 0.02 },
    { upTo: 925000, rate: 0.05 },
    { upTo: 1500000, rate: 0.10 },
    { upTo: Infinity, rate: 0.12 },
  ];
  let duty = 0;
  let prev = 0;
  for (const b of bands) {
    if (price > b.upTo) {
      duty += (b.upTo - prev) * b.rate;
      prev = b.upTo;
    } else {
      duty += (price - prev) * b.rate;
      break;
    }
  }
  // Additional property surcharge: +5% on full price (England, from Oct 2024)
  if (mode === "additional") duty += price * 0.05;
  return Math.round(duty);
}

const STAMP_DUTY_LABELS: Record<StampDutyMode, string> = {
  main: "Main residence",
  additional: "Additional property",
  ftb: "First-time buyer",
};

type AccessLevel = "none" | "single" | "pass" | "expired";

function useAccess(listingUrl: string | undefined, token: string | undefined): {
  level: AccessLevel;
  email: string | null;
  expiresAt: string | null;
  loading: boolean;
} {
  const [state, setState] = useState<{
    level: AccessLevel;
    email: string | null;
    expiresAt: string | null;
    loading: boolean;
  }>({
    level: "none",
    email: null,
    expiresAt: null,
    loading: true,
  });
  const validateToken = useServerFn(validateSingleReportToken);
  const checkPass = useServerFn(checkBuyerPassByEmail);
  const checkSingleByEmail = useServerFn(getSingleReportByEmail);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // 1. Buyer Pass (auth)
      let signedInEmail: string | null = null;
      let expiredFromPass: { expiresAt: string | null } | null = null;
      try {
        const { data } = await supabase.auth.getUser();
        const email = data.user?.email ?? null;
        signedInEmail = email;
        if (email) {
          const r = await checkPass({ data: { email } });
          if (cancelled) return;
          if (r.hasPass) {
            setState({ level: "pass", email, expiresAt: r.expiresAt, loading: false });
            return;
          }
          if (r.expired) {
            expiredFromPass = { expiresAt: r.expiresAt };
          }
        }
      } catch { /* ignore */ }

      // 2. Signed-in user with an active Single Report token (any device)
      if (signedInEmail) {
        try {
          const r = await checkSingleByEmail({ data: { email: signedInEmail } });
          if (cancelled) return;
          if (r.token) {
            setState({ level: "single", email: signedInEmail, expiresAt: r.expiresAt, loading: false });
            return;
          }
        } catch { /* ignore */ }
      }

      // 3. Single token via URL (legacy / fresh post-payment link)
      if (token) {
        try {
          const r = await validateToken({ data: { token, listingUrl: listingUrl ?? null } });
          if (cancelled) return;
          if (r.valid) {
            setState({ level: "single", email: signedInEmail, expiresAt: null, loading: false });
            return;
          }
        } catch { /* ignore */ }
      }

      // 4. Signed-in user with expired pass: surface the expired state
      if (expiredFromPass) {
        if (!cancelled) {
          setState({
            level: "expired",
            email: signedInEmail,
            expiresAt: expiredFromPass.expiresAt,
            loading: false,
          });
        }
        return;
      }

      if (!cancelled) setState({ level: "none", email: null, expiresAt: null, loading: false });
    })();
    return () => { cancelled = true; };
  }, [listingUrl, token, validateToken, checkPass, checkSingleByEmail]);

  return state;
}

const searchSchema = z.object({
  url: z.string().optional(),
  text: z.string().optional(),
  token: z.string().optional(),
  saved_id: z.string().optional(),
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
  const { url, text, token, saved_id } = Route.useSearch();
  const navigate = useNavigate();
  const analyseFn = useServerFn(analyseListing);
  const getSavedFn = useServerFn(getSavedAnalysis);

  const hasInput = Boolean(url || text || saved_id);

  const cached = saved_id ? undefined : readCachedAnalysis(url, text, token);

  const query = useQuery({
    queryKey: ["analysis", url ?? "", text ?? "", token ?? "", saved_id ?? ""],
    queryFn: async (): Promise<AnalysisResult> => {
      if (saved_id) {
        const r = await getSavedFn({ data: { id: saved_id } });
        if (!r.found) throw new Error("Saved report not found or no longer accessible.");
        return r.analysis;
      }
      const { data: sess } = await supabase.auth.getSession();
      const sessionJwt = sess.session?.access_token ?? null;
      const result = await analyseFn({
        data: { url, text, accessToken: token ?? null, sessionJwt },
      });
      writeCachedAnalysis(result, url, text, token);
      return result;
    },
    enabled: hasInput,
    retry: false,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    initialData: cached,
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
        <DisclaimerBar />
        <SiteFooter />
      </div>
    );
  }

  if (query.isPending) {
    return (
      <div className="min-h-screen bg-background">
        <SiteHeader />
        <LoadingState url={url} />
        <DisclaimerBar />
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
        <DisclaimerBar />
        <SiteFooter />
      </div>
    );
  }

  return <ReportView analysis={query.data!} listingUrl={url} token={token} fromSaved={Boolean(saved_id)} />;
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

function ReportView({ analysis: a, listingUrl, token, fromSaved }: { analysis: AnalysisResult; listingUrl?: string; token?: string; fromSaved?: boolean }) {
  const access = useAccess(listingUrl, token);
  const unlocked = access.level !== "none";
  const showChat = access.level === "pass";

  // Auto-save analysis for signed-in paying users (Buyer Pass or Single Report).
  // Skip when this analysis was loaded from a saved report.
  const saveFn = useServerFn(saveAnalysisForUser);
  const savedRef = useRef(false);
  useEffect(() => {
    const eligible = access.level === "pass" || access.level === "single";
    if (!fromSaved && eligible && access.email && !savedRef.current && listingUrl) {
      savedRef.current = true;
      saveFn({ data: { email: access.email, listingUrl, analysis: a } }).catch(() => { /* ignore */ });
    }
  }, [access.level, access.email, listingUrl, a, saveFn, fromSaved]);

  const [sdMode, setSdMode] = useState<StampDutyMode>("main");
  const stampDuty = calcStampDuty(a.property.price, sdMode);

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />

      {access.level === "pass" && (
        <div
          className="no-print"
          style={{
            background: "#FAECE7",
            borderBottom: "0.5px solid rgba(153,60,29,0.15)",
          }}
        >
          <div className="mx-auto flex max-w-6xl items-center justify-between px-8 py-2" style={{ fontSize: 12, color: "#993C1D" }}>
            <span>Buyer Pass active</span>
            <Link to="/dashboard" style={{ color: "#993C1D", fontWeight: 500 }} className="hover:underline">
              View all your analyses →
            </Link>
          </div>
        </div>
      )}

      <main className="mx-auto max-w-5xl px-6 py-10">

        <div className="flex items-center justify-between gap-4 no-print">
          <Link
            to="/"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            ← Analyse another property
          </Link>
          <EmailReportButton
            analysis={a}
            isPaid={access.level === "pass" || access.level === "single"}
            userEmail={access.email}
          />
        </div>

        {/* Property header */}
        <section
          className="mt-6 w-full rounded-3xl px-6 py-6 sm:px-8 sm:py-8"
          style={{
            background: "#FFFDF9",
            borderBottom: "0.5px solid rgba(26,17,8,0.12)",
          }}
        >
          <div className="flex items-start justify-between gap-6">
            <div className="min-w-0 flex-1">
              <h1
                className="truncate"
                style={{ fontSize: 20, fontWeight: 500, color: "#1A1108", lineHeight: 1.3 }}
              >
                {a.property.address}
              </h1>
              <div
                className="mt-2"
                style={{ fontSize: 28, fontWeight: 500, color: "#1A1108", lineHeight: 1.2 }}
              >
                {formatGBP(a.property.price)}
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <PropertyPill>{a.property.beds} bed{a.property.beds === 1 ? "" : "s"}</PropertyPill>
                <PropertyPill>{a.property.baths} bath{a.property.baths === 1 ? "" : "s"}</PropertyPill>
                {a.property.sqft > 0 && <PropertyPill>{a.property.sqft.toLocaleString()} sq ft</PropertyPill>}
                {a.property.type && <PropertyPill>{a.property.type}</PropertyPill>}
              </div>
            </div>
            <div className="shrink-0">
              <ScoreBadge score={a.score} label={a.scoreLabel} />
            </div>
          </div>
        </section>

        {/* Score breakdown */}
        <SubScoreBreakdown analysis={a} />

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
              icon={PoundSterling}
            />
            <div className="rounded-2xl border border-border bg-card p-5 shadow-soft">
              <div className="flex items-center justify-between">
                <span className="text-xs uppercase tracking-wider text-muted-foreground">Stamp duty est.</span>
                <TrendingDown className="h-4 w-4 text-muted-foreground" />
              </div>
              <div className="mt-3 text-2xl font-semibold tracking-tight">{formatGBP(stampDuty)}</div>
              <div className="mt-4 border-t border-border pt-3">
                <div className="text-[11px]" style={{ color: "#888780" }}>I am buying as a:</div>
                <div className="mt-2 flex flex-wrap gap-1.5" role="tablist" aria-label="Stamp duty rate">
                  {(["main", "additional", "ftb"] as StampDutyMode[]).map((m) => {
                    const active = sdMode === m;
                    return (
                      <button
                        key={m}
                        type="button"
                        role="tab"
                        aria-selected={active}
                        onClick={() => setSdMode(m)}
                        className="rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors"
                        style={
                          active
                            ? { backgroundColor: "#D85A30", borderColor: "#D85A30", color: "#FFFFFF" }
                            : { backgroundColor: "transparent", borderColor: "#D8D6CE", color: "#5F5E5A" }
                        }
                      >
                        {STAMP_DUTY_LABELS[m]}
                      </button>
                    );
                  })}
                </div>
                {sdMode === "ftb" && a.property.price > 625000 && (
                  <p className="mt-2 text-[11px]" style={{ color: "#888780" }}>
                    FTB relief doesn't apply above £625,000 — standard rates used.
                  </p>
                )}
              </div>
            </div>
          </div>
        </section>


        {/* EPC */}
        <EpcSection analysis={a} />

        {/* Price history (free + paid) */}
        <PriceHistorySection analysis={a} />

        {/* Area context */}
        <AreaContextSection analysis={a} />

        {/* Auction warning (free + paid) */}
        <AuctionWarning analysis={a} />

        {/* Red flags — unified for paid, free preview for unpaid */}
        <section className="mt-10">
          <div className="flex items-end justify-between">
            <div>
              <h2 className="text-xl font-semibold tracking-tight">Red flags</h2>
              {!unlocked && (
                <p className="text-sm text-muted-foreground">
                  Top issues spotted in the listing — full list unlocked below.
                </p>
              )}
            </div>
            {!unlocked && (
              <span className="rounded-full bg-primary-soft px-3 py-1 text-xs font-medium text-primary">
                Free preview
              </span>
            )}
          </div>
          <div className="mt-4 space-y-3">
            {(unlocked ? a.redFlags : a.redFlags.slice(0, 2)).map((f, i) => (
              <RedFlagItem key={i} flag={f} />
            ))}
          </div>
        </section>

        {/* Paywall + locked / unlocked content */}
        <section className="mt-10">
          {!unlocked && (
            <>
              <LockedFeaturesGrid />
              <div className="mt-8">
                {access.level === "expired" ? (
                  <ExpiredPassGate expiresAt={access.expiresAt} listingUrl={listingUrl} />
                ) : (
                  <PaywallGate listingUrl={listingUrl} />
                )}
              </div>
            </>
          )}

          {unlocked && (
            <div className="space-y-8">

              <UnlockedSection title="True cost breakdown">
                <CostBreakdown analysis={a} stampDuty={stampDuty} stampDutyMode={sdMode} />
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

              {/* Flood risk — full for Buyer Pass, locked teaser for Single Report */}
              <FloodRiskSection analysis={a} isBuyerPass={access.level === "pass"} />

              {showChat && <PropertyChat analysis={a} />}

              {access.level === "pass" && (
                <div className="text-center">
                  <Link to="/dashboard" style={{ fontSize: 13, color: "#D85A30" }}>
                    Go to your dashboard →
                  </Link>
                </div>
              )}
            </div>
          )}
        </section>
      </main>

      <DisclaimerBar />
        <SiteFooter />
    </div>
  );
}

function PropertyPill({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="inline-flex items-center rounded-full px-3 py-1"
      style={{ background: "#F1EFE8", color: "#5F5E5A", fontSize: 12, fontWeight: 500 }}
    >
      {children}
    </span>
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

function LockedFeatureCard({
  title,
  sub,
  comingSoon,
  children,
}: {
  title: string;
  sub: string;
  comingSoon?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className="relative overflow-hidden"
      style={{
        background: "#F1EFE8",
        borderRadius: 12,
        padding: 16,
        opacity: comingSoon ? 0.6 : 1,
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <Lock className="h-3.5 w-3.5" style={{ color: "#D85A30" }} />
            <h4 className="text-sm font-semibold tracking-tight truncate" style={{ color: "#1A1108" }}>
              {title}
            </h4>
          </div>
          <p className="mt-0.5 text-[12px]" style={{ color: "#5F5E5A" }}>
            {sub}
          </p>
        </div>
      </div>
      <div
        aria-hidden
        className="mt-3 pointer-events-none select-none"
        style={{
          filter: comingSoon ? "none" : "blur(4px)",
          color: "#5F5E5A",
          fontSize: 12,
          lineHeight: 1.5,
        }}
      >
        {children}
      </div>
    </div>
  );
}

function LockedFeaturesGrid() {
  return (
    <div>
      <div className="mb-4">
        <h2 className="text-xl font-semibold tracking-tight">What's included in the full report</h2>
        <p className="text-sm text-muted-foreground">A preview of everything you unlock below.</p>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <LockedFeatureCard title="All red flags" sub="See every issue we found">
          <div>• Lease has 89 years remaining — below mortgage threshold</div>
          <div>• EPC rating not disclosed — possible E/F/G</div>
          <div>• Photos taken in poor light — north-facing rooms?</div>
        </LockedFeatureCard>
        <LockedFeatureCard title="True cost breakdown" sub="Total upfront + monthly costs">
          <div>Total upfront: £710,600</div>
          <div>Monthly mortgage: £3,120</div>
          <div>Stamp duty: £21,750</div>
        </LockedFeatureCard>
        <LockedFeatureCard title="Negotiation strategy" sub="Recommended offer and your leverage">
          <div>Recommended offer: £635,000 – £655,000</div>
          <div>4–7% below asking — 47 days on market</div>
        </LockedFeatureCard>
        <LockedFeatureCard
          title="Flood risk"
          sub="Environment Agency data — insurance and mortgage implications"
        >
          <span
            className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold"
            style={{ background: "#FCE5DD", color: "#D85A30" }}
          >
            Medium risk
          </span>
        </LockedFeatureCard>
        <LockedFeatureCard
          title="Nearby schools"
          sub="Ofsted ratings within 1 mile — coming soon"
          comingSoon
        >
          <div>Coming soon</div>
        </LockedFeatureCard>
        <LockedFeatureCard title="AI chat" sub="Ask anything about this property — Buyer Pass only">
          <div
            className="inline-block rounded-2xl px-3 py-2"
            style={{ background: "#FFFDF9", border: "0.5px solid rgba(26,17,8,0.12)" }}
          >
            Is this a good price for the area?
          </div>
        </LockedFeatureCard>
      </div>
    </div>
  );
}

function ExpiredPassGate({
  expiresAt,
  listingUrl,
}: {
  expiresAt: string | null;
  listingUrl?: string;
}) {
  const checkoutFn = useServerFn(createCheckoutSession);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const expiredLabel = expiresAt
    ? new Date(expiresAt).toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "long",
        year: "numeric",
      })
    : "recently";

  const handleRenew = async () => {
    setErr(null);
    setLoading(true);
    try {
      const res = await checkoutFn({
        data: { priceId: PRICE_PASS, listingUrl: listingUrl ?? "", tier: "pass" },
      });
      window.location.href = res.url;
    } catch (e) {
      setErr((e as Error).message || "Couldn't start checkout. Try again.");
      setLoading(false);
    }
  };

  return (
    <div
      className="p-6 sm:p-8"
      style={{
        background: "#FFFDF9",
        borderRadius: 12,
        border: "0.5px solid rgba(26,17,8,0.12)",
      }}
    >
      <div
        className="inline-flex items-center gap-2"
        style={{
          background: "#FAECE7",
          color: "#993C1D",
          borderRadius: 100,
          padding: "4px 10px",
          fontSize: 11,
          fontWeight: 500,
          letterSpacing: "0.04em",
        }}
      >
        BUYER PASS EXPIRED
      </div>
      <h3
        className="mt-4 text-2xl font-semibold tracking-tight"
        style={{ color: "#1A1108" }}
      >
        Your Buyer Pass has expired
      </h3>
      <p className="mt-2 text-sm" style={{ color: "#5F5E5A" }}>
        Your 90-day pass expired on {expiredLabel}. Renew to continue analysing
        properties with full access.
      </p>
      <button
        type="button"
        onClick={handleRenew}
        disabled={loading}
        className="mt-6 inline-flex items-center gap-2 transition-opacity hover:opacity-90 disabled:opacity-60"
        style={{
          background: "#D85A30",
          color: "#FFFDF9",
          fontSize: 14,
          fontWeight: 500,
          borderRadius: 100,
          padding: "12px 22px",
        }}
      >
        {loading ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" /> Starting checkout…
          </>
        ) : (
          <>Renew Buyer Pass — £24.99 →</>
        )}
      </button>
      {err && (
        <p className="mt-3 text-sm" style={{ color: "#993C1D" }}>
          {err}
        </p>
      )}
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

function CostBreakdown({
  analysis,
  stampDuty,
  stampDutyMode,
}: {
  analysis: AnalysisResult;
  stampDuty?: number;
  stampDutyMode?: StampDutyMode;
}) {
  const c = analysis.costs;
  const sd = typeof stampDuty === "number" ? stampDuty : c.stampDuty;
  const totalUpfront = c.purchasePrice + sd + c.legalFees + c.surveyFees + c.mortgageFees;
  const sdLabel = stampDutyMode ? `Stamp duty (${STAMP_DUTY_LABELS[stampDutyMode]})` : "Stamp duty";
  const rows = [
    ["Purchase price", c.purchasePrice],
    [sdLabel, sd],
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
          {formatGBP(totalUpfront)}
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
        <MortgageCalculator purchasePrice={c.purchasePrice} />
      </div>
    </div>
  );
}

function MortgageCalculator({ purchasePrice }: { purchasePrice: number }) {
  const DEFAULT_RATE = 4.8;
  const [term, setTerm] = useState(30);
  const [rate, setRate] = useState(DEFAULT_RATE);
  const [rateInput, setRateInput] = useState(String(DEFAULT_RATE));
  const depositPct = 0.15;
  const loan = purchasePrice * (1 - depositPct);
  const monthly = (() => {
    const r = rate / 100 / 12;
    const n = term * 12;
    if (r === 0) return loan / n;
    const pow = Math.pow(1 + r, n);
    return (loan * (r * pow)) / (pow - 1);
  })();
  const inputBg: CSSProperties = {
    background: "#F1EFE8",
    borderRadius: 8,
    border: "0.5px solid rgba(26,17,8,0.12)",
  };
  return (
    <>
      <div className="text-xs uppercase tracking-wider text-primary">Monthly mortgage</div>
      <div className="mt-1 text-3xl font-semibold tracking-tight text-primary">
        {formatGBP(Math.round(monthly))}
      </div>
      <p className="mt-3 text-sm text-foreground/80">
        Based on {Math.round(depositPct * 100)}% deposit ({formatGBP(Math.round(purchasePrice * depositPct))}),{" "}
        {term}-year term at {rate.toFixed(1)}% fixed.
      </p>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <label className="block">
          <span className="text-xs text-muted-foreground">Mortgage term</span>
          <div className="mt-1 flex items-center gap-2">
            <input
              type="range"
              min={5}
              max={35}
              step={1}
              value={term}
              onChange={(e) => setTerm(Number(e.target.value))}
              className="flex-1 accent-primary"
            />
            <input
              type="number"
              min={5}
              max={35}
              step={1}
              value={term}
              onChange={(e) => setTerm(Math.min(35, Math.max(5, Number(e.target.value) || 0)))}
              className="w-14 px-2 py-1 text-xs outline-none"
              style={inputBg}
            />
          </div>
        </label>
        <label className="block">
          <span className="text-xs text-muted-foreground">Interest rate %</span>
          <input
            type="number"
            inputMode="decimal"
            min={0.1}
            max={20}
            step={0.1}
            value={rateInput}
            onChange={(e) => {
              const v = e.target.value;
              setRateInput(v);
              if (v === "") return;
              const n = Number(v);
              if (Number.isFinite(n) && n > 0 && n < 20) setRate(n);
            }}
            onBlur={() => {
              const n = Number(rateInput);
              if (rateInput === "" || !Number.isFinite(n) || n <= 0 || n >= 20) {
                setRate(DEFAULT_RATE);
                setRateInput(String(DEFAULT_RATE));
              } else {
                setRateInput(String(n));
              }
            }}
            className="mt-1 w-full px-3 py-1.5 text-sm outline-none"
            style={inputBg}
          />
        </label>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        Repayment mortgage estimate. Speak to a mortgage broker for a personalised quote.
      </p>
    </>
  );
}

function Negotiation({ analysis }: { analysis: AnalysisResult }) {
  const n = analysis.negotiation;
  const isAuction = !!n.isAuction;
  const maxBid = n.maxBid && n.maxBid > 0 ? n.maxBid : n.recommendedOffer.high;
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-primary/20 bg-primary-soft p-5">
        <div className="text-xs uppercase tracking-wider text-primary">
          {isAuction ? "Maximum bid strategy" : "Recommended offer"}
        </div>
        <div className="mt-1 text-2xl font-semibold tracking-tight">
          {isAuction
            ? `Up to ${formatGBP(maxBid)}`
            : `${formatGBP(n.recommendedOffer.low)} – ${formatGBP(n.recommendedOffer.high)}`}
        </div>
        <p className="mt-2 text-sm text-foreground/80">{n.rationale}</p>
      </div>
      <div>
        <div className="text-xs uppercase tracking-wider text-muted-foreground">
          {isAuction ? "Bidding considerations" : "Your leverage"}
        </div>
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
      // Persist current results URL in history so the browser back button from
      // Stripe returns to this exact page with the listing URL param intact.
      try {
        if (typeof window !== "undefined") {
          window.history.replaceState(
            { ...(window.history.state ?? {}), roovrListingUrl: listingUrl ?? null },
            "",
            window.location.href
          );
        }
      } catch { /* ignore */ }
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
            "Full analysis for one property",
            "All red flags spotted in the listing",
            "True cost breakdown (stamp duty, legal fees, mortgage estimate)",
            "Viewing questions to ask the agent",
            "Negotiation strategy and recommended offer range",
            "Access anywhere — report saved to your account",
          ]}
          upsell={{ text: "Upgrade to Buyer Pass for AI chat, flood risk and nearby schools →", targetId: "buyer-pass-card" }}
        />
        <PlanCard
          id="buyer-pass-card"
          title="Buyer Pass"
          price="£24.99"
          cadence="90-day pass · one-off payment"
          cta="Get Buyer Pass"
          highlight
          loading={loadingTier === "pass"}
          onClick={() => handleBuy("pass")}
          plusIntro="Everything in Single Report, plus:"
          features={[
            "Unlimited analyses for 90 days",
            "AI chat on every property",
            "Flood risk assessment",
            "Nearby schools with Ofsted ratings",
            "Save and compare reports",
            "Report emailed to you",
            "Access anywhere — all reports saved to your account",
          ]}
          footnote="One-off payment. Access ends 90 days after purchase."
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
  id,
  title,
  price,
  cadence,
  features,
  highlight,
  cta,
  footnote,
  subnote,
  plusIntro,
  upsell,
  onClick,
  loading,
}: {
  id?: string;
  title: string;
  price: string;
  cadence: string;
  features: string[];
  highlight?: boolean;
  cta: string;
  footnote?: string;
  subnote?: string;
  plusIntro?: string;
  upsell?: { text: string; targetId: string };
  onClick?: () => void;
  loading?: boolean;
}) {
  return (
    <div
      id={id}
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
      {upsell && (
        <button
          type="button"
          onClick={() => {
            if (typeof document === "undefined") return;
            document.getElementById(upsell.targetId)?.scrollIntoView({ behavior: "smooth", block: "center" });
          }}
          className="mt-4 text-left hover:underline"
          style={{ fontSize: 12, fontWeight: 500, color: "#D85A30" }}
        >
          {upsell.text}
        </button>
      )}
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

type SubScoreKey = keyof AnalysisResult["subScores"];

const SUB_SCORE_LABELS: { key: SubScoreKey; label: string; fallback: string }[] = [
  {
    key: "valueForMoney",
    label: "Value for money",
    fallback: "How the asking price compares to the local area average and to the property's size in sq ft.",
  },
  {
    key: "locationQuality",
    label: "Location quality",
    fallback: "Transport links, schools, amenities and overall postcode desirability.",
  },
  {
    key: "listingTransparency",
    label: "Listing transparency",
    fallback: "How honest, complete and detailed the agent's listing description is.",
  },
  {
    key: "marketTiming",
    label: "Market timing",
    fallback: "Days on market, price reductions and demand signals for this property.",
  },
  {
    key: "riskLevel",
    label: "Risk level",
    fallback: "Higher score means lower risk — covers structural, legal and tenure red flags.",
  },
  {
    key: "resalePotential",
    label: "Resale potential",
    fallback: "Property type, tenure, size and the area's longer-term resale outlook.",
  },
];

function scoreColor(s: number): string {
  if (s > 7) return "#3B6D11";
  if (s >= 5) return "#BA7517";
  return "#A32D2D";
}

function ScoreInfoTooltip({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState<{ side: "top" | "bottom"; align: "left" | "right" }>({
    side: "top",
    align: "left",
  });
  const wrapperRef = useRef<HTMLSpanElement | null>(null);

  const computePlacement = () => {
    if (typeof window === "undefined" || !wrapperRef.current) return;
    const rect = wrapperRef.current.getBoundingClientRect();
    const isMobile = window.innerWidth < 768;
    const align: "left" | "right" =
      window.innerWidth - rect.left < 160 ? "right" : "left";
    setPlacement({ side: isMobile ? "bottom" : "top", align });
  };

  // Close on outside tap (mobile)
  useEffect(() => {
    if (!open) return;
    const onDocPointer = (e: PointerEvent) => {
      if (!wrapperRef.current) return;
      if (!wrapperRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDocPointer);
    return () => document.removeEventListener("pointerdown", onDocPointer);
  }, [open]);

  const onEnter = () => {
    if (typeof window !== "undefined" && window.matchMedia("(hover: hover)").matches) {
      computePlacement();
      setOpen(true);
    }
  };
  const onLeave = () => {
    if (typeof window !== "undefined" && window.matchMedia("(hover: hover)").matches) {
      setOpen(false);
    }
  };
  const onClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (!open) computePlacement();
    setOpen((o) => !o);
  };

  const tooltipStyle: CSSProperties = {
    position: "absolute",
    zIndex: 50,
    maxWidth: 280,
    width: "max-content",
    background: "#1A1108",
    color: "#FFFDF9",
    fontSize: 12,
    lineHeight: 1.6,
    borderRadius: 8,
    padding: "10px 14px",
    boxShadow: "0 8px 24px rgba(26,17,8,0.18)",
    pointerEvents: "none",
    opacity: open ? 1 : 0,
    transition: "opacity 150ms ease",
    ...(placement.side === "top"
      ? { bottom: "calc(100% + 8px)" }
      : { top: "calc(100% + 8px)" }),
    ...(placement.align === "left" ? { left: 0 } : { right: 0 }),
  };

  const arrowStyle: CSSProperties = {
    position: "absolute",
    width: 0,
    height: 0,
    borderLeft: "5px solid transparent",
    borderRight: "5px solid transparent",
    ...(placement.side === "top"
      ? { bottom: -5, borderTop: "5px solid #1A1108" }
      : { top: -5, borderBottom: "5px solid #1A1108" }),
    ...(placement.align === "left" ? { left: 8 } : { right: 8 }),
  };

  return (
    <span
      ref={wrapperRef}
      className="relative inline-flex"
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      <button
        type="button"
        onClick={onClick}
        aria-label="More info"
        aria-expanded={open}
        className="inline-flex items-center justify-center rounded-full focus:outline-none focus:ring-2 focus:ring-primary/40"
        style={{ color: "#888780", lineHeight: 0 }}
      >
        <Info size={14} aria-hidden="true" />
      </button>
      <span role="tooltip" aria-hidden={!open} style={tooltipStyle}>
        {text}
        <span style={arrowStyle} aria-hidden="true" />
      </span>
    </span>
  );
}

function SubScoreBreakdown({ analysis }: { analysis: AnalysisResult }) {
  const sub = analysis.subScores;
  const reasons = analysis.scoreReasons ?? {};
  const [showHint, setShowHint] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.innerWidth >= 768) return;
    try {
      if (!sessionStorage.getItem("roovr:scoreTooltipHintSeen")) {
        setShowHint(true);
        sessionStorage.setItem("roovr:scoreTooltipHintSeen", "1");
      }
    } catch { /* ignore */ }
  }, []);

  if (!sub) return null;
  return (
    <section className="mt-6">
      <div
        className="rounded-2xl p-6 sm:p-7"
        style={{ background: "#FFFDF9", border: "0.5px solid rgba(26,17,8,0.12)" }}
      >
        <h3 className="mb-4 text-sm font-medium uppercase tracking-wider" style={{ color: "#5F5E5A" }}>
          Score breakdown
        </h3>
        <div className="space-y-3">
          {SUB_SCORE_LABELS.map(({ key, label, fallback }) => {
            const v = Number(sub[key] ?? 0);
            const pct = Math.max(0, Math.min(100, (v / 10) * 100));
            const color = scoreColor(v);
            const reason = reasons[key];
            const tooltipText =
              reason && reason.trim().length > 0 ? reason : fallback;
            return (
              <div key={key} className="grid grid-cols-[140px_1fr_36px] items-center gap-4">
                <span className="inline-flex items-center gap-1.5" style={{ fontSize: 13, color: "#5F5E5A" }}>
                  {label}
                  <ScoreInfoTooltip text={tooltipText} />
                </span>
                <div
                  className="relative w-full overflow-hidden rounded-full"
                  style={{ height: 6, background: "#F1EFE8" }}
                >
                  <div
                    className="absolute inset-y-0 left-0 rounded-full"
                    style={{ width: `${pct}%`, background: color }}
                  />
                </div>
                <span className="text-right" style={{ fontSize: 13, fontWeight: 500, color: "#1A1108" }}>
                  {v.toFixed(1)}
                </span>
              </div>
            );
          })}
        </div>
        {showHint && (
          <p className="mt-4 text-center md:hidden" style={{ fontSize: 12, color: "#888780" }}>
            Tap ⓘ for details
          </p>
        )}
      </div>
    </section>
  );
}


function AreaContextSection({ analysis }: { analysis: AnalysisResult }) {
  const ac = analysis.areaContext;
  if (!ac) return null;
  const propPpsf = analysis.metrics?.pricePerSqFt;
  const areaPpsf = ac.avgPricePerSqFtArea;
  const haveBoth =
    typeof propPpsf === "number" && propPpsf > 0 &&
    typeof areaPpsf === "number" && areaPpsf > 0;
  const ppsfPct = haveBoth ? ((propPpsf - areaPpsf) / areaPpsf) * 100 : null;
  const ppsfText =
    ppsfPct === null
      ? "Insufficient data"
      : `${ppsfPct > 0 ? "+" : ""}${ppsfPct.toFixed(1)}%`;
  const ppsfColor =
    ppsfPct === null
      ? "#5F5E5A"
      : ppsfPct <= 0
      ? "#3B6D11"
      : ppsfPct > 10
      ? "#A32D2D"
      : "#A36A1F";
  const avgSqFt =
    typeof areaPpsf === "number" && areaPpsf > 0
      ? `£${Math.round(areaPpsf)}`
      : "—";
  return (
    <section className="mt-10">
      <h2 className="text-xl font-semibold tracking-tight">Area context</h2>
      <div className="mt-4 rounded-2xl border border-border bg-card p-6 shadow-soft">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-xl p-5" style={{ background: "#F1EFE8" }}>
            <div className="text-xs uppercase tracking-wider" style={{ color: "#5F5E5A" }}>
              Area avg price / sq ft
            </div>
            <div className="mt-2 text-2xl font-semibold tracking-tight" style={{ color: "#1A1108" }}>
              {avgSqFt}
            </div>
          </div>
          <div className="rounded-xl p-5" style={{ background: "#F1EFE8" }}>
            <div className="flex items-center gap-1.5 text-xs uppercase tracking-wider" style={{ color: "#5F5E5A" }}>
              <span>Price per sq ft vs area avg</span>
              <ScoreInfoTooltip text="Compares this property's price per sq ft against typical prices per sq ft for similar properties in the area. A negative % means better value per sq ft than average." />
            </div>
            <div className="mt-2 text-2xl font-semibold tracking-tight" style={{ color: ppsfColor }}>
              {ppsfText}
            </div>
          </div>
        </div>
        {ac.areaDescription && (
          <p className="mt-4 text-sm" style={{ color: "#1A1108" }}>{ac.areaDescription}</p>
        )}
        {ac.comparableNote && (
          <p className="mt-2 text-sm" style={{ color: "#5F5E5A" }}>{ac.comparableNote}</p>
        )}
        <p className="mt-4 text-xs" style={{ color: "#888780" }}>
          Area estimates based on listing data and Claude's training knowledge — not live Land Registry data.
        </p>
      </div>
    </section>
  );
}

function isAuctionAnalysis(a: AnalysisResult): boolean {
  if (a.negotiation?.isAuction) return true;
  const hay = [
    ...(a.redFlags ?? []).map((f) => `${f.title} ${f.detail}`),
    a.negotiation?.rationale ?? "",
    a.scoreLabel ?? "",
    a.property?.type ?? "",
  ]
    .join(" ")
    .toLowerCase();
  return /\bauction\b/.test(hay);
}

function AuctionWarning({ analysis }: { analysis: AnalysisResult }) {
  if (!isAuctionAnalysis(analysis)) return null;
  return (
    <section className="mt-10">
      <div
        className="flex items-start gap-4 p-5 sm:p-6"
        style={{ background: "#FAEEDA", color: "#633806", borderRadius: 12 }}
      >
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" style={{ color: "#D85A30" }} />
        <div>
          <h3 style={{ fontSize: 16, fontWeight: 600, color: "#633806" }}>
            Auction property — standard mortgages rarely apply
          </h3>
          <p className="mt-2 text-sm" style={{ color: "#633806" }}>
            Most lenders cannot process a mortgage within the 28–56 day auction completion window.
            Buyers typically need bridging finance (expensive, 1–2% per month) or cash. Some
            specialist lenders offer auction finance products but these carry higher rates. Factor
            this into your total cost calculation before bidding.
          </p>
        </div>
      </div>
    </section>
  );
}

const EPC_BANDS: { letter: string; bg: string; fg: string }[] = [
  { letter: "A", bg: "#0E7A3D", fg: "#FFFFFF" },
  { letter: "B", bg: "#2E9E4B", fg: "#FFFFFF" },
  { letter: "C", bg: "#8DC63F", fg: "#1A1108" },
  { letter: "D", bg: "#F5D63D", fg: "#1A1108" },
  { letter: "E", bg: "#F4A93C", fg: "#1A1108" },
  { letter: "F", bg: "#E97A4A", fg: "#FFFFFF" },
  { letter: "G", bg: "#D43A2F", fg: "#FFFFFF" },
];

function EpcSection({ analysis }: { analysis: AnalysisResult }) {
  const epc = analysis.epc;
  const rating =
    epc?.rating && /^[A-G]$/i.test(epc.rating.trim())
      ? epc.rating.trim().toUpperCase()
      : null;
  const activeBand = rating ? EPC_BANDS.find((b) => b.letter === rating) : null;

  return (
    <section className="mt-10">
      <h2 className="text-xl font-semibold tracking-tight">Energy performance (EPC)</h2>
      <div className="mt-4 rounded-2xl border border-border bg-card p-6 shadow-soft">
        {!rating ? (
          <p className="text-sm" style={{ color: "#1A1108" }}>
            EPC rating not shown in this listing — ask the agent before viewing. An EPC is legally required for all sales.
          </p>
        ) : (
          <>
            <div className="grid gap-6 sm:grid-cols-[1fr_auto] sm:items-center">
              <div className="space-y-1.5">
                {EPC_BANDS.map((b, i) => {
                  const active = b.letter === rating;
                  return (
                    <div key={b.letter} className="flex items-center gap-2">
                      <div
                        className="flex shrink-0 items-center justify-center text-base"
                        style={{ width: 18, color: active ? "#1A1108" : "transparent" }}
                        aria-hidden="true"
                      >
                        ▶
                      </div>
                      <div
                        className="flex flex-1 items-center justify-between rounded-md px-3 py-2 text-sm font-semibold transition-all"
                        style={{
                          background: b.bg,
                          color: b.fg,
                          width: `${55 + (6 - i) * 6}%`,
                          minWidth: 110,
                          borderLeft: active ? "6px solid #1A1108" : "6px solid transparent",
                          boxShadow: active ? "0 2px 8px rgba(26,17,8,0.25)" : "none",
                          transform: active ? "scale(1.02)" : "none",
                          transformOrigin: "left center",
                        }}
                      >
                        <span>{b.letter}</span>
                        {active && <span className="text-[10px] font-bold uppercase tracking-wider">This property</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div
                className="flex flex-col items-center justify-center rounded-xl px-6 py-5"
                style={{
                  background: activeBand?.bg ?? "#F1EFE8",
                  color: activeBand?.fg ?? "#1A1108",
                  minWidth: 130,
                }}
              >
                <div className="text-5xl font-bold leading-none tracking-tight">{rating}</div>
                {epc?.score != null && (
                  <div className="mt-2 text-sm opacity-90">Score {epc.score}</div>
                )}
                {epc?.potentialRating && (
                  <div className="mt-1 text-xs opacity-90">Potential: {epc.potentialRating}</div>
                )}
              </div>
            </div>
            {epc?.estimatedAnnualEnergyCost && (
              <div className="mt-4 text-sm" style={{ color: "#5F5E5A" }}>
                Estimated annual energy cost:{" "}
                <span style={{ color: "#1A1108", fontWeight: 500 }}>
                  {epc.estimatedAnnualEnergyCost}
                </span>
              </div>
            )}
            {epc?.commentary && (
              <p className="mt-3 text-sm" style={{ color: "#1A1108" }}>{epc.commentary}</p>
            )}
          </>
        )}
      </div>
    </section>
  );
}

function EmailReportButton({
  analysis,
  isPaid,
  userEmail,
}: {
  analysis: AnalysisResult;
  isPaid: boolean;
  userEmail: string | null;
}) {
  const sendFn = useServerFn(sendReportEmail);
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [showInput, setShowInput] = useState(false);
  const [emailInput, setEmailInput] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const send = async (to: string) => {
    setStatus("sending");
    setErrorMsg(null);
    try {
      const resultsUrl = typeof window !== "undefined" ? window.location.href : "";
      const r = await sendFn({ data: { email: to, analysis, resultsUrl, isPaid } });
      if (r.ok) {
        setSentTo(to);
        setStatus("sent");
        setShowInput(false);
      } else {
        setStatus("error");
        setErrorMsg("Couldn't send the report — try again or contact hello@roovr.co");
      }
    } catch {
      setStatus("error");
      setErrorMsg("Couldn't send the report — try again or contact hello@roovr.co");
    }
  };

  const onClick = () => {
    if (status === "sending") return;
    if (userEmail) {
      void send(userEmail);
    } else {
      setShowInput((s) => !s);
    }
  };

  const buttonStyle: CSSProperties = {
    border: "1.5px solid #1A1108",
    background: "transparent",
    color: "#1A1108",
    borderRadius: 100,
    fontSize: 13,
    fontWeight: 500,
    padding: "7px 14px",
  };

  if (status === "sent" && sentTo) {
    return (
      <div style={{ fontSize: 13, color: "#1A1108", display: "inline-flex", alignItems: "center", gap: 6 }}>
        <Check className="h-3.5 w-3.5" style={{ color: "#3B6D11" }} />
        Report sent to {sentTo}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-end gap-2">
      {showInput && !userEmail ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const v = emailInput.trim();
            if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) void send(v);
          }}
          className="flex items-center gap-2"
        >
          <input
            type="email"
            required
            value={emailInput}
            onChange={(e) => setEmailInput(e.target.value)}
            placeholder="your@email.com"
            disabled={status === "sending"}
            style={{
              border: "1px solid rgba(26,17,8,0.2)",
              background: "#FFFDF9",
              borderRadius: 100,
              fontSize: 13,
              padding: "7px 12px",
              color: "#1A1108",
              minWidth: 200,
            }}
          />
          <button
            type="submit"
            disabled={status === "sending"}
            className="inline-flex items-center gap-1.5"
            style={{ ...buttonStyle, background: "#1A1108", color: "#FFFDF9", borderColor: "#1A1108" }}
          >
            {status === "sending" ? "Sending..." : "Send →"}
          </button>
        </form>
      ) : (
        <button
          type="button"
          onClick={onClick}
          disabled={status === "sending"}
          className="inline-flex items-center gap-1.5 transition-colors hover:bg-[#1A1108] hover:text-[#FFFDF9]"
          style={buttonStyle}
        >
          {status === "sending" ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Sending...
            </>
          ) : (
            <>Email me my report →</>
          )}
        </button>
      )}
      {status === "error" && errorMsg && (
        <div style={{ fontSize: 12, color: "#B53A1A" }}>{errorMsg}</div>
      )}
    </div>
  );
}

const PRICE_EVENT_COLORS: Record<"sold" | "listed" | "reduced" | "relisted", string> = {
  sold: "#3B6D11",
  listed: "#185FA5",
  reduced: "#BA7517",
  relisted: "#5F5E5A",
};

function shortMoney(n: number): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: 0,
  }).format(n);
}

function PriceHistorySection({ analysis }: { analysis: AnalysisResult }) {
  try {
    const ph = analysis.priceHistory;

    const cardStyle: CSSProperties = {
      background: "#FFFDF9",
      border: "0.5px solid rgba(26,17,8,0.12)",
      borderRadius: 12,
      padding: 20,
    };

    const headingNode = (
      <h2 className="text-xl font-semibold tracking-tight" style={{ color: "#1A1108" }}>
        Price history
      </h2>
    );

    const entries = ph?.entries ?? [];
    const currentPrice = analysis.property?.price ?? 0;
    const isExactMatch = ph?.source === "land_registry" && ph?.nearbyMode !== true;

    // Scotland — Land Registry doesn't hold Scottish data
    if (ph?.scotland) {
      return (
        <section className="mt-10">
          {headingNode}
          <div className="mt-4" style={cardStyle}>
            <p style={{ fontSize: 14, color: "#1A1108", fontWeight: 500 }}>
              This property is in Scotland.
            </p>
            <p className="mt-2" style={{ fontSize: 12, color: "#5F5E5A", lineHeight: 1.6 }}>
              Sold price data is held by Registers of Scotland — search at{" "}
              <a
                href="https://www.ros.gov.uk/property-information"
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: "#185FA5", textDecoration: "underline" }}
              >
                ros.gov.uk/property-information
              </a>{" "}
              to find previous sale prices for this address.
            </p>
          </div>
        </section>
      );
    }

    // Empty state — no exact-match historical data for this address
    if (!ph || entries.length === 0 || !isExactMatch) {
      return (
        <section className="mt-10">
          {headingNode}
          <div className="mt-4" style={cardStyle}>
            <p style={{ fontSize: 14, color: "#1A1108", fontWeight: 500 }}>
              No sale history found
            </p>
            <p className="mt-2" style={{ fontSize: 12, color: "#5F5E5A", lineHeight: 1.6 }}>
              We couldn&apos;t find a previous sale record for this exact address.
              You can search directly at HM Land Registry to check historical prices.
            </p>
            <p className="mt-3" style={{ fontSize: 12, lineHeight: 1.6 }}>
              <a
                href="https://www.gov.uk/search-property-information-land-registry"
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: "#185FA5", textDecoration: "underline" }}
              >
                Search Land Registry →
              </a>
            </p>
          </div>
        </section>
      );
    }

    // Build timeline points: historical entries + current asking
    const timelinePoints: { label: string; date: string; price: number; color: string; isCurrent?: boolean }[] = entries.map((e) => ({
      label: e.event,
      date: e.date,
      price: e.price,
      color: PRICE_EVENT_COLORS[e.event] ?? "#5F5E5A",
    }));
    if (currentPrice > 0) {
      timelinePoints.push({
        label: "asking",
        date: "Now",
        price: currentPrice,
        color: "#D85A30",
        isCurrent: true,
      });
    }

    const lastSold = [...entries].reverse().find((e) => e.event === "sold") ?? entries[0];
    const totalAppreciation = ph.totalAppreciation;
    const annualGrowth = ph.annualGrowthRate;
    const priceChange =
      ph.firstSalePrice != null && currentPrice > 0
        ? currentPrice - ph.firstSalePrice
        : null;
    const priceChangePct = totalAppreciation;

    const aggressiveGrowth = typeof annualGrowth === "number" && annualGrowth > 8;
    const negativeAppreciation = typeof totalAppreciation === "number" && totalAppreciation < 0;
    const sharpRise = typeof priceChangePct === "number" && priceChangePct > 20;

    return (
      <section className="mt-10">
        {headingNode}
        <div className="mt-4" style={cardStyle}>
          {/* Timeline */}
          <div className="relative" style={{ paddingTop: 8, paddingBottom: 4 }}>
            <div
              style={{
                position: "absolute",
                left: 12,
                right: 12,
                top: 22,
                height: 2,
                background: "rgba(26,17,8,0.12)",
              }}
              aria-hidden="true"
            />
            <div className="relative flex items-start justify-between gap-2">
              {timelinePoints.map((p, i) => (
                <div
                  key={`${p.label}-${p.date}-${i}`}
                  className="flex flex-col items-center"
                  style={{ flex: 1, minWidth: 0 }}
                >
                  <div
                    style={{
                      width: 14,
                      height: 14,
                      borderRadius: "50%",
                      background: p.color,
                      border: "2px solid #FFFDF9",
                      boxShadow: "0 0 0 1px rgba(26,17,8,0.15)",
                      marginTop: 14,
                    }}
                    aria-hidden="true"
                  />
                  <div
                    style={{
                      fontSize: 10,
                      color: "#888780",
                      marginTop: 6,
                      textTransform: "uppercase",
                      letterSpacing: 0.4,
                      textAlign: "center",
                    }}
                  >
                    {p.isCurrent ? "Asking" : p.label}
                  </div>
                  <div style={{ fontSize: 11, color: "#5F5E5A", textAlign: "center" }}>
                    {p.date}
                  </div>
                  <div
                    style={{
                      fontSize: 12,
                      fontWeight: 500,
                      color: p.isCurrent ? "#D85A30" : "#1A1108",
                      textAlign: "center",
                    }}
                  >
                    {shortMoney(p.price)}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Metric tiles */}
          <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div
              style={{
                background: "#F1EFE8",
                borderRadius: 8,
                padding: 14,
              }}
            >
              <div style={{ fontSize: 11, color: "#888780", textTransform: "uppercase", letterSpacing: 0.4 }}>
                Last {lastSold.event === "sold" ? "sold" : lastSold.event}
              </div>
              <div style={{ fontSize: 14, fontWeight: 500, color: "#1A1108", marginTop: 4 }}>
                {lastSold.date} · {shortMoney(lastSold.price)}
              </div>
            </div>
            <div
              style={{
                background: "#F1EFE8",
                borderRadius: 8,
                padding: 14,
              }}
            >
              <div style={{ fontSize: 11, color: "#888780", textTransform: "uppercase", letterSpacing: 0.4 }}>
                Price change
              </div>
              <div
                style={{
                  fontSize: 14,
                  fontWeight: 500,
                  marginTop: 4,
                  color: negativeAppreciation
                    ? "#B23B1F"
                    : sharpRise
                      ? "#B23B1F"
                      : "#3B6D11",
                }}
              >
                {priceChange != null && priceChangePct != null
                  ? `${priceChange >= 0 ? "+" : "−"}${shortMoney(Math.abs(priceChange))} (${priceChangePct >= 0 ? "+" : ""}${priceChangePct.toFixed(1)}%)`
                  : "—"}
              </div>
            </div>
            <div
              style={{
                background: "#F1EFE8",
                borderRadius: 8,
                padding: 14,
              }}
            >
              <div style={{ fontSize: 11, color: "#888780", textTransform: "uppercase", letterSpacing: 0.4 }}>
                Annual growth
              </div>
              <div
                style={{
                  fontSize: 14,
                  fontWeight: 500,
                  marginTop: 4,
                  color: aggressiveGrowth ? "#BA7517" : negativeAppreciation ? "#B23B1F" : "#1A1108",
                }}
              >
                {typeof annualGrowth === "number" ? `${annualGrowth.toFixed(1)}% per year` : "—"}
              </div>
              <div style={{ fontSize: 10, color: "#888780", marginTop: 2 }}>
                UK avg ~5%/yr
              </div>
            </div>
          </div>

          {/* Commentary */}
          {ph.commentary && (
            <p
              style={{
                fontSize: 13,
                color: aggressiveGrowth ? "#BA7517" : "#5F5E5A",
                lineHeight: 1.6,
                marginTop: 14,
              }}
            >
              {aggressiveGrowth ? "⚠ " : ""}
              {ph.commentary}
            </p>
          )}

          {ph.source === "land_registry" && (
            <div
              className="mt-4 flex items-center gap-1.5"
              style={{ fontSize: 10, color: "#888780" }}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M3 21h18" />
                <path d="M5 21V8l7-4 7 4v13" />
                <path d="M9 21v-6h6v6" />
                <path d="M9 12h.01M12 12h.01M15 12h.01" />
              </svg>
              Source: HM Land Registry
            </div>
          )}
        </div>
      </section>
    );
  } catch (err) {
    console.error("[PriceHistorySection] render failed:", err);
    return null;
  }
}

function FloodRiskSection({ analysis, isBuyerPass }: { analysis: AnalysisResult; isBuyerPass: boolean }) {
  try {
    const fr = analysis.floodRisk;

    const cardStyle: CSSProperties = {
      background: "#FFFDF9",
      border: "0.5px solid rgba(26,17,8,0.12)",
      borderRadius: 12,
      padding: 20,
    };

    const headingNode = (
      <h2 className="text-xl font-semibold tracking-tight" style={{ color: "#1A1108" }}>
        Flood risk
      </h2>
    );

    // Locked teaser for free / single-report users
    if (!isBuyerPass) {
      return (
        <section className="mt-10">
          {headingNode}
          <div className="mt-4 relative overflow-hidden" style={cardStyle}>
            <div style={{ filter: "blur(5px)", userSelect: "none", pointerEvents: "none" }}>
              <div className="flex items-center justify-between">
                <p style={{ fontSize: 14, color: "#1A1108", fontWeight: 500 }}>
                  Flood risk assessment
                </p>
                <span style={{ background: "#FAECE7", color: "#A32D2D", borderRadius: 999, padding: "4px 10px", fontSize: 12, fontWeight: 500 }}>
                  Medium
                </span>
              </div>
              <div className="mt-3 space-y-2">
                <div style={{ fontSize: 13, color: "#5F5E5A" }}>Rivers and sea: Low</div>
                <div style={{ fontSize: 13, color: "#5F5E5A" }}>Surface water: Medium</div>
                <div style={{ fontSize: 13, color: "#5F5E5A" }}>Reservoir: No</div>
                <div style={{ fontSize: 13, color: "#5F5E5A" }}>Groundwater: Low</div>
              </div>
              <p style={{ fontSize: 13, color: "#5F5E5A", marginTop: 12 }}>
                Insurance and mortgage commentary based on Environment Agency data.
              </p>
            </div>
            <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-6">
              <div className="flex items-center gap-2" style={{ color: "#1A1108", fontWeight: 600, fontSize: 14 }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
                Flood risk assessment
              </div>
              <p className="mt-1" style={{ fontSize: 12, color: "#5F5E5A" }}>
                Unlock with Buyer Pass to see flood zone, insurance implications and mortgage risks
              </p>
            </div>
          </div>
        </section>
      );
    }

    // Scotland
    if (fr?.scotland) {
      return (
        <section className="mt-10">
          {headingNode}
          <div className="mt-4" style={cardStyle}>
            <p style={{ fontSize: 14, color: "#1A1108", fontWeight: 500 }}>
              This property is in Scotland.
            </p>
            <p className="mt-2" style={{ fontSize: 12, color: "#5F5E5A", lineHeight: 1.6 }}>
              Check flood risk at{" "}
              <a href="https://www.sepa.org.uk/environment/water/flooding/flood-risk" target="_blank" rel="noopener noreferrer" style={{ color: "#185FA5", textDecoration: "underline" }}>
                sepa.org.uk/environment/water/flooding/flood-risk
              </a>
            </p>
          </div>
        </section>
      );
    }

    // API failure / unavailable
    if (!fr || fr.unavailable) {
      return (
        <section className="mt-10">
          {headingNode}
          <div className="mt-4" style={cardStyle}>
            <p style={{ fontSize: 12, color: "#5F5E5A", lineHeight: 1.6 }}>
              Flood risk data temporarily unavailable. Check directly at{" "}
              <a href="https://check-long-term-flood-risk.service.gov.uk" target="_blank" rel="noopener noreferrer" style={{ color: "#185FA5", textDecoration: "underline" }}>
                check-long-term-flood-risk.service.gov.uk
              </a>
            </p>
          </div>
        </section>
      );
    }

    // No data returned by EA for this postcode (API responded but no risk values)
    const hasNoData =
      !fr.overallRisk &&
      !fr.riversAndSea &&
      !fr.surfaceWater &&
      !fr.groundwater &&
      fr.reservoir == null;
    if (hasNoData) {
      return (
        <section className="mt-10">
          {headingNode}
          <div
            className="mt-4"
            style={{
              background: "#F1EFE8",
              border: "0.5px solid rgba(26,17,8,0.12)",
              borderRadius: 12,
              padding: 20,
            }}
          >
            <p style={{ fontSize: 14, color: "#1A1108", fontWeight: 600 }}>
              Flood risk not returned for this postcode
            </p>
            <p className="mt-2" style={{ fontSize: 13, color: "#5F5E5A", lineHeight: 1.6 }}>
              The Environment Agency returned no specific flood risk data for this property. This
              may indicate a low-risk area, but we recommend verifying directly before making an
              offer.
            </p>
            <a
              href="https://check-long-term-flood-risk.service.gov.uk"
              target="_blank"
              rel="noopener noreferrer"
              className="mt-4 inline-flex items-center gap-1"
              style={{
                background: "#D85A30",
                color: "#FFFDF9",
                fontSize: 13,
                fontWeight: 500,
                borderRadius: 100,
                padding: "10px 18px",
                textDecoration: "none",
              }}
            >
              Check your flood risk at check-long-term-flood-risk.service.gov.uk →
            </a>
            <p className="mt-3" style={{ fontSize: 12, color: "#5F5E5A", lineHeight: 1.6 }}>
              Enter the property postcode on the Government's official flood risk checker for a
              confirmed result.
            </p>
            <div style={{ fontSize: 10, color: "#888780", marginTop: 12 }}>
              Source: Environment Agency
            </div>
          </div>
        </section>
      );
    }

    const badgeStyle = (level: string | null): CSSProperties => {
      const v = (level ?? "").toLowerCase();
      if (v === "high") return { background: "#FAECE7", color: "#A32D2D" };
      if (v === "medium") return { background: "#FAEEDA", color: "#633806" };
      if (v === "low") return { background: "#EAF3DE", color: "#27500A" };
      if (v === "very low") return { background: "#EAF3DE", color: "#27500A" };
      return { background: "#F1EFE8", color: "#5F5E5A" };
    };

    const Pill = ({ value }: { value: string | null }) => (
      <span
        style={{
          ...badgeStyle(value),
          borderRadius: 999,
          padding: "3px 10px",
          fontSize: 12,
          fontWeight: 500,
          display: "inline-block",
        }}
      >
        {value ?? "Unknown"}
      </span>
    );

    const isHigh = (fr.overallRisk ?? "").toLowerCase() === "high";

    return (
      <section className="mt-10">
        {headingNode}
        <div className="mt-4" style={cardStyle}>
          <div className="flex items-center justify-between gap-3">
            <p style={{ fontSize: 14, color: "#1A1108", fontWeight: 500 }}>
              Overall flood risk
            </p>
            <span
              style={{
                ...badgeStyle(fr.overallRisk),
                borderRadius: 999,
                padding: "4px 12px",
                fontSize: 12,
                fontWeight: 600,
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              {isHigh && (
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                  <line x1="12" y1="9" x2="12" y2="13" />
                  <line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
              )}
              {fr.overallRisk ?? "Unknown"}
            </span>
          </div>

          <div className="mt-4 space-y-2">
            {[
              { label: "Rivers and sea", value: fr.riversAndSea },
              { label: "Surface water", value: fr.surfaceWater },
              { label: "Reservoir", value: fr.reservoir == null ? null : fr.reservoir ? "Yes" : "No" },
              { label: "Groundwater", value: fr.groundwater },
            ].map((row) => (
              <div key={row.label} className="flex items-center justify-between">
                <span style={{ fontSize: 13, color: "#5F5E5A" }}>{row.label}</span>
                <Pill value={row.value} />
              </div>
            ))}
          </div>

          {fr.commentary && (
            <p style={{ fontSize: 13, color: "#5F5E5A", lineHeight: 1.6, marginTop: 14 }}>
              {fr.commentary}
            </p>
          )}

          <div style={{ fontSize: 10, color: "#888780", marginTop: 12 }}>
            Source: Environment Agency
          </div>
        </div>
      </section>
    );
  } catch (err) {
    console.error("[FloodRiskSection] render failed:", err);
    return null;
  }
}
