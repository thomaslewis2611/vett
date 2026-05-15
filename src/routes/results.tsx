import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { Component, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
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
  Wifi,
  Signal,
  X,
} from "lucide-react";
import { SiteHeader, SiteFooter } from "@/components/site-chrome";
import { DisclaimerBar } from "@/components/disclaimer-bar";
import { formatGBP, type AnalysisResult } from "@/lib/mock-analysis";
import { startAnalysisJob, getAnalysisJob, fetchBuyerPassExtras, analyseEpcRating, analyseFloodZone, analyseManualSqft, refetchLocalDataForPostcode } from "@/lib/analyse.functions";
import { PropertyChat } from "@/components/property-chat";
import { createCheckoutSession, sendBuyerPassMagicLink, saveAnalysisForUser, getSavedAnalysis } from "@/lib/checkout.functions";
import { sendReportEmail } from "@/lib/email-report.functions";
import { validateSingleReportToken, checkBuyerPassByEmail, getSingleReportByEmail } from "@/lib/access.functions";
import { supabase } from "@/integrations/supabase/client";
import { UpsellPassModal, shouldShowPassUpsell } from "@/components/upsell-pass-modal";
import { usePassDiscount } from "@/hooks/use-pass-discount";

const PRICE_SINGLE = "price_1TWXsjCfTT0mXB2cPz7SPIOL";
const PRICE_PASS = "price_1TWtPLCfTT0mXB2cU829oJlb";

const ANALYSIS_CACHE_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

// Persist the current analysis_jobs id per listing URL so that when an
// unauthenticated user clicks "Get Buyer Pass" / "Get this report" we can
// pass it through Stripe metadata. The webhook then copies the analysis
// into saved_analyses for the new user's email.
function jobIdKey(url?: string | null) {
  return url ? `roovrJobId:${url}` : null;
}
function rememberJobId(url: string | undefined | null, jobId: string) {
  if (typeof window === "undefined") return;
  const key = jobIdKey(url);
  if (!key) return;
  try { sessionStorage.setItem(key, jobId); } catch { /* ignore */ }
}
function recallJobId(url: string | undefined | null): string | undefined {
  if (typeof window === "undefined") return undefined;
  const key = jobIdKey(url);
  if (!key) return undefined;
  try { return sessionStorage.getItem(key) ?? undefined; } catch { return undefined; }
}
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

function useAccess(listingUrl: string | undefined, token: string | undefined, savedId?: string, savedOwnerEmail?: string | null): {
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
            console.log("Access check — saved_id:", savedId ?? null, "user email:", email, "saved_analyses owner:", savedOwnerEmail ?? null, "access granted: pass");
            setState({ level: "pass", email, expiresAt: r.expiresAt, loading: false });
            return;
          }
          if (r.expired) {
            expiredFromPass = { expiresAt: r.expiresAt };
          }
        }
      } catch { /* ignore */ }

      // 2a. Saved report ownership: if the signed-in user owns this
      // saved_analyses row, they purchased a Single Report (or were granted
      // one) — always grant at least Single access regardless of subscription.
      if (savedId && signedInEmail && savedOwnerEmail &&
          signedInEmail.toLowerCase() === savedOwnerEmail.toLowerCase()) {
        if (!cancelled) {
          console.log("Access check — saved_id:", savedId, "user email:", signedInEmail, "saved_analyses owner:", savedOwnerEmail, "access granted: single");
          setState({ level: "single", email: signedInEmail, expiresAt: null, loading: false });
        }
        return;
      }

      // 2b. Signed-in user with a Single Report for THIS specific listing URL
      if (signedInEmail && listingUrl) {
        try {
          const r = await checkSingleByEmail({ data: { email: signedInEmail, listingUrl } });
          if (cancelled) return;
          if (r.token) {
            console.log("Access check — saved_id:", savedId ?? null, "user email:", signedInEmail, "saved_analyses owner:", savedOwnerEmail ?? null, "access granted: single");
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

      if (!cancelled) {
        console.log("Access check — saved_id:", savedId ?? null, "user email:", signedInEmail, "saved_analyses owner:", savedOwnerEmail ?? null, "access granted: none");
        setState({ level: "none", email: signedInEmail, expiresAt: null, loading: false });
      }
    })();
    return () => { cancelled = true; };
  }, [listingUrl, token, savedId, savedOwnerEmail, validateToken, checkPass, checkSingleByEmail]);

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
  const startJobFn = useServerFn(startAnalysisJob);
  const getJobFn = useServerFn(getAnalysisJob);
  const getSavedFn = useServerFn(getSavedAnalysis);

  const hasInput = Boolean(url || text || saved_id);

  const cached = saved_id ? undefined : readCachedAnalysis(url, text, token);

  const POLL_INTERVAL_MS = 2000;
  // Long timeout to tolerate mobile screen-locks suspending JS for minutes.
  const POLL_TIMEOUT_MS = 10 * 60_000;
  const [wasHidden, setWasHidden] = useState(false);
  const [showResumeBanner, setShowResumeBanner] = useState(false);

  type QueryResult = { analysis: AnalysisResult; savedOwnerEmail?: string | null; savedListingUrl?: string | null };

  const query = useQuery<QueryResult>({
    queryKey: ["analysis", url ?? "", text ?? "", token ?? "", saved_id ?? ""],
    queryFn: async ({ signal }): Promise<QueryResult> => {
      if (saved_id) {
        // Wait for auth session to hydrate so the bearer token is attached.
        const { data: sess } = await supabase.auth.getSession();
        if (!sess.session) {
          await new Promise((r) => setTimeout(r, 500));
        }
        console.log("[results] loading saved report", { saved_id });
        let r = await getSavedFn({ data: { id: saved_id } });
        if (!r.found) {
          console.warn("[results] saved report not found on first try, retrying in 1s", {
            saved_id,
            errorMessage: (r as { errorMessage?: string }).errorMessage,
          });
          await new Promise((res) => setTimeout(res, 1000));
          r = await getSavedFn({ data: { id: saved_id } });
        }
        if (!r.found) {
          console.error("[results] saved report unavailable after retry", {
            saved_id,
            errorMessage: (r as { errorMessage?: string }).errorMessage,
          });
          throw new Error("SAVED_NOT_FOUND");
        }
        return {
          analysis: r.analysis,
          savedOwnerEmail: (r as { userEmail?: string | null }).userEmail ?? null,
          savedListingUrl: r.listingUrl ?? null,
        };
      }

      // Async job pipeline: start a job (or resume an in-flight one stored in
      // sessionStorage), then poll until it completes. Resuming is what makes
      // mobile screen-lock recovery work — the server keeps running, and on
      // return we just re-attach to the same jobId.
      const { data: sess } = await supabase.auth.getSession();
      const sessionJwt = sess.session?.access_token ?? null;

      let jobId = recallJobId(url);
      // Verify any existing jobId is still known to the server before reusing.
      if (jobId) {
        try {
          const probe = await getJobFn({ data: { jobId, sessionJwt } });
          if (probe.status === "complete" && probe.analysis) {
            writeCachedAnalysis(probe.analysis, url, text, token);
            return { analysis: probe.analysis };
          }
          if (probe.status === "error" && /not found/i.test(probe.error ?? "")) {
            jobId = undefined;
          }
        } catch {
          jobId = undefined;
        }
      }
      if (!jobId) {
        const started = await startJobFn({
          data: { url, text, accessToken: token ?? null, sessionJwt },
        });
        jobId = started.jobId;
        rememberJobId(url, jobId);
      }

      const startedAt = Date.now();
      while (true) {
        if (signal?.aborted) throw new Error("ABORTED");
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        if (signal?.aborted) throw new Error("ABORTED");
        const status = await getJobFn({ data: { jobId, sessionJwt } });
        if (status.status === "complete" && status.analysis) {
          writeCachedAnalysis(status.analysis, url, text, token);
          return { analysis: status.analysis };
        }
        if (status.status === "error") {
          throw new Error(status.error || "Analysis failed");
        }
        if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
          throw new Error("ANALYSIS_TIMEOUT");
        }
      }
    },
    enabled: hasInput,
    retry: false,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    initialData: cached ? { analysis: cached } : undefined,
  });

  // Page Visibility: when the tab is hidden (mobile screen lock, tab switch),
  // browser timers may pause. On return, immediately re-poll so we don't
  // wait out the throttled interval; show a banner if the report is still
  // generating so the user knows to tap to refresh.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const onVis = () => {
      if (document.hidden) {
        if (query.isFetching || query.isPending) setWasHidden(true);
      } else {
        if (wasHidden && (query.isFetching || query.isPending)) {
          setShowResumeBanner(true);
        }
        if (query.isPending || query.isError) {
          query.refetch();
        }
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [query, wasHidden]);

  // NOTE: Do NOT clear the stored jobId on success. The Single Report
  // checkout flow needs to pass it through Stripe metadata so the webhook
  // can copy the existing analysis into saved_analyses for the buyer's
  // email — otherwise clicking the magic link from the receipt email
  // would land on /my-reports and the user would have to re-analyse.
  useEffect(() => {
    if (query.isSuccess) {
      setShowResumeBanner(false);
      setWasHidden(false);
    }
  }, [query.isSuccess]);

  if (!hasInput) {
    return (
      <div className="flex min-h-screen flex-col bg-background">
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
      <div className="flex min-h-screen flex-col bg-background">
        <SiteHeader />
        {showResumeBanner && (
          <button
            type="button"
            onClick={() => { setShowResumeBanner(false); query.refetch(); }}
            className="mx-auto mt-4 block max-w-xl rounded-xl border border-border bg-accent px-4 py-3 text-sm text-accent-foreground hover:opacity-90"
          >
            Your analysis is still running — tap to check results
          </button>
        )}
        <LoadingState url={url} />
        <DisclaimerBar />
        <SiteFooter />
      </div>
    );
  }

  if (query.isError) {
    const rawMsg = (query.error as Error)?.message || "Something went wrong while analysing this listing.";
    const isBlocked = rawMsg.startsWith("FETCH_BLOCKED");
    const isSavedMissing = rawMsg === "SAVED_NOT_FOUND" || Boolean(saved_id);
    const isTimeout = rawMsg === "ANALYSIS_TIMEOUT";
    // Sanitize: never expose raw HTML / JSON / upstream gateway errors to the user.
    const looksLikeHtml = /<\/?[a-z!][^>]*>/i.test(rawMsg);
    const looksLikeJson = /^\s*[{[]/.test(rawMsg);
    const looksLikeGateway = /\b(502|503|504|bad gateway|gateway time-?out|cloudflare)\b/i.test(rawMsg);
    const safeRawMsg =
      looksLikeHtml || looksLikeJson || looksLikeGateway || rawMsg.length > 200
        ? "Analysis failed — please try again."
        : rawMsg;
    const friendlyMsg = isBlocked
      ? "We couldn't automatically read this listing. You can paste the listing description below to get your full analysis."
      : isTimeout
        ? "This is taking longer than usual. Try again or try a different listing."
        : isSavedMissing
          ? "We couldn't load this report. Try opening it from your dashboard."
          : safeRawMsg;

    return (
      <div className="flex min-h-screen flex-col bg-background">
        <SiteHeader />
        <main className="mx-auto max-w-xl px-6 py-20">
          {isBlocked ? (
            <BlockedFallback url={url} message={friendlyMsg} />
          ) : (
            <div className="text-center">
              <h1 className="text-2xl font-semibold tracking-tight">
                {isSavedMissing ? "Report unavailable" : "Analysis failed"}
              </h1>
              <p className="mt-3 text-sm text-muted-foreground">{friendlyMsg}</p>
              <div className="mt-6 flex flex-wrap justify-center gap-3">
                <button
                  onClick={() => query.refetch()}
                  className="inline-flex items-center justify-center rounded-xl bg-primary px-5 py-3 text-sm font-medium text-primary-foreground hover:opacity-90"
                >
                  Try again
                </button>
                {isSavedMissing ? (
                  <button
                    onClick={() => navigate({ to: "/my-reports" })}
                    className="inline-flex items-center justify-center rounded-xl border border-border px-5 py-3 text-sm font-medium hover:bg-accent"
                  >
                    Go to My Reports →
                  </button>
                ) : (
                  <button
                    onClick={() => navigate({ to: "/" })}
                    className="inline-flex items-center justify-center rounded-xl border border-border px-5 py-3 text-sm font-medium hover:bg-accent"
                  >
                    Start over
                  </button>
                )}
              </div>
            </div>
          )}
        </main>
        <DisclaimerBar />
        <SiteFooter />
      </div>
    );
  }

  return (
    <ReportView
      analysis={query.data!.analysis}
      listingUrl={url ?? query.data!.savedListingUrl ?? undefined}
      token={token}
      fromSaved={Boolean(saved_id)}
      savedId={saved_id}
      savedOwnerEmail={query.data!.savedOwnerEmail ?? null}
    />
  );
}

function BlockedFallback({ url, message }: { url?: string; message: string }) {
  const navigate = useNavigate();
  const [text, setText] = useState("");
  const [showPaste, setShowPaste] = useState(false);
  const trimmed = text.trim();
  const isZoopla = Boolean(url && /zoopla\.co\.uk/i.test(url));
  const displayMessage = isZoopla
    ? "We find Rightmove listings easier to analyse accurately. If this property is listed on Rightmove, try that link for best results. Alternatively, paste the full listing description text below."
    : message;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (trimmed.length < 50) return;
    navigate({ to: "/results", search: { url, text: trimmed } });
  };

  const tryRightmove = () => {
    navigate({ to: "/", search: { url: "" } });
  };

  return (
    <div className="rounded-3xl border border-border bg-card p-6 shadow-card sm:p-8">
      <div className="inline-flex items-center gap-2 rounded-full bg-primary-soft px-3 py-1 text-xs font-medium text-primary">
        <AlertTriangle className="h-3.5 w-3.5" /> {isZoopla ? "Zoopla listing" : "Couldn't read the listing"}
      </div>
      <h1 className="mt-3 text-2xl font-semibold tracking-tight">
        {isZoopla ? "Try Rightmove for best results" : "Paste the listing description to continue"}
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">{displayMessage}</p>
      {url && (
        <p className="mt-2 truncate text-xs text-muted-foreground">{url}</p>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-4">
        <button
          type="button"
          onClick={() => setShowPaste((v) => !v)}
          className="inline-flex items-center justify-center rounded-xl bg-primary px-5 py-3 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
        >
          {showPaste ? "Hide paste box" : "Paste listing text instead"}
        </button>
        <button
          type="button"
          onClick={tryRightmove}
          className="text-sm font-medium text-primary underline-offset-4 hover:underline"
        >
          Try Rightmove instead →
        </button>
      </div>

      {showPaste && (
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
      )}
    </div>
  );
}

class SafeSection extends Component<{ children: ReactNode; name?: string }, { hasError: boolean }> {
  state = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(error: unknown) {
    console.error(`[SafeSection] ${this.props.name ?? "section"} failed to render`, error);
  }
  render() {
    if (this.state.hasError) return null;
    return this.props.children;
  }
}

const LOADING_STEPS: { label: string; tickAt: number }[] = [
  { label: "Fetching listing content", tickAt: 5 },
  { label: "Reading agent description", tickAt: 15 },
  { label: "Spotting red flags", tickAt: 30 },
  { label: "Calculating true costs", tickAt: 45 },
  { label: "Building negotiation strategy", tickAt: 60 },
];

const LOADING_TIPS = [
  "Tip: Average buyers view 8 properties before making an offer",
  "Tip: 68% of buyers say they missed red flags on their first viewing",
  "Tip: Properties with undisclosed square footage are often smaller than comparable listings",
  "Tip: The negotiation strategy is tailored to this specific property and market",
  "Tip: Your viewing checklist will be specific to the red flags found in this listing",
];

const CORAL = "#D85A30";

function prettyUrl(url?: string): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, "") + u.pathname;
  } catch {
    return url;
  }
}

function LoadingState({ url }: { url?: string }) {
  const [elapsed, setElapsed] = useState(0);
  const [tipIdx, setTipIdx] = useState(0);

  useEffect(() => {
    const start = Date.now();
    const id = setInterval(() => {
      setElapsed(Math.floor((Date.now() - start) / 1000));
    }, 500);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const id = setInterval(() => {
      setTipIdx((i) => (i + 1) % LOADING_TIPS.length);
    }, 15_000);
    return () => clearInterval(id);
  }, []);

  // Progress 0 → 95% over 75 seconds, capped.
  const progress = Math.min(95, (elapsed / 75) * 95);
  const finalising = elapsed >= 60;
  const anchor = prettyUrl(url);

  return (
    <main className="mx-auto flex max-w-xl flex-col px-6 py-12 sm:py-16 animate-in fade-in duration-500">
      <div className="rounded-3xl border border-border bg-card p-6 shadow-card sm:p-8">
        {/* Progress bar */}
        <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full transition-[width] duration-700 ease-out"
            style={{ width: `${progress}%`, background: CORAL }}
          />
        </div>

        {/* Anchor: property URL */}
        {anchor && (
          <div className="mt-5">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Analysing
            </p>
            <p className="mt-1 truncate text-sm font-medium text-foreground" title={url}>
              {anchor}
            </p>
          </div>
        )}

        <h1 className="mt-6 text-xl font-semibold tracking-tight sm:text-2xl">
          Building your Roovr report
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Decoding agent jargon, estimating true costs and drafting your negotiation
          strategy. This usually takes 60–90 seconds.
        </p>

        {/* Step indicators */}
        <ul className="mt-6 space-y-3 text-sm">
          {LOADING_STEPS.map((step) => {
            const done = elapsed >= step.tickAt;
            const active = !done && elapsed >= step.tickAt - 5;
            return (
              <li
                key={step.label}
                className={`flex items-center gap-3 transition-opacity duration-500 ${
                  done || active ? "opacity-100" : "opacity-40"
                }`}
              >
                <span
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${
                    done ? "bg-emerald-500/15" : "bg-muted"
                  }`}
                >
                  {done ? (
                    <Check className="h-3.5 w-3.5 text-emerald-600" />
                  ) : active ? (
                    <Loader2 className="h-3 w-3 animate-spin" style={{ color: CORAL }} />
                  ) : (
                    <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40" />
                  )}
                </span>
                <span className={done ? "text-foreground" : "text-muted-foreground"}>
                  {step.label}
                </span>
              </li>
            );
          })}
          {finalising && (
            <li className="flex items-center gap-3 animate-in fade-in duration-500">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center">
                <Loader2 className="h-4 w-4 animate-spin" style={{ color: CORAL }} />
              </span>
              <span className="text-foreground">Finalising your report…</span>
            </li>
          )}
        </ul>

        {/* Rotating tip */}
        <div className="mt-8 rounded-xl bg-muted/60 p-4">
          <p
            key={tipIdx}
            className="text-xs leading-relaxed text-muted-foreground animate-in fade-in slide-in-from-bottom-1 duration-500"
          >
            {LOADING_TIPS[tipIdx]}
          </p>
        </div>
      </div>
    </main>
  );
}

function ReportView({ analysis: initialA, listingUrl, token, fromSaved, savedId, savedOwnerEmail }: { analysis: AnalysisResult; listingUrl?: string; token?: string; fromSaved?: boolean; savedId?: string; savedOwnerEmail?: string | null }) {
  const access = useAccess(listingUrl, token, savedId, savedOwnerEmail);
  const unlocked = access.level !== "none";
  const showChat = access.level === "pass";

  // Local copy of the analysis so we can patch in flood/schools after a Buyer
  // Pass upgrade — without ever re-running the Claude analysis.
  const [a, setA] = useState<AnalysisResult>(initialA);
  useEffect(() => { setA(initialA); }, [initialA]);

  // Auto-save analysis for signed-in paying users (Buyer Pass or Single Report).
  const saveFn = useServerFn(saveAnalysisForUser);
  const savedRef = useRef(false);
  useEffect(() => {
    const eligible = access.level === "pass" || access.level === "single";
    if (!fromSaved && eligible && access.email && !savedRef.current && listingUrl) {
      savedRef.current = true;
      saveFn({ data: { email: access.email, listingUrl, analysis: a } }).catch(() => { /* ignore */ });
    }
  }, [access.level, access.email, listingUrl, a, saveFn, fromSaved]);

  // Post-upgrade: if a Buyer Pass user is viewing a report that was analysed
  // BEFORE they had the pass, flood risk / nearby schools may be missing.
  // Fetch ONLY those two datasets and patch the saved row in-place.
  const extrasFn = useServerFn(fetchBuyerPassExtras);
  const [fetchingExtras, setFetchingExtras] = useState(false);
  const extrasRef = useRef(false);
  useEffect(() => {
    if (extrasRef.current) return;
    if (access.level !== "pass" || !access.email || !listingUrl) return;
    const needsFlood = a.floodRisk == null;
    const needsSchools = a.nearbySchools == null;
    const needsCrime = a.crime == null;
    const needsBroadband = a.broadband == null;
    const needsTransport = a.transport == null;
    if (!needsFlood && !needsSchools && !needsCrime && !needsBroadband && !needsTransport) return;
    extrasRef.current = true;
    setFetchingExtras(true);
    extrasFn({ data: { email: access.email, listingUrl } })
      .then((r) => {
        if (r?.ok) {
          setA((prev) => ({
            ...prev,
            floodRisk: r.floodRisk ?? prev.floodRisk,
            nearbySchools: r.nearbySchools ?? prev.nearbySchools,
            crime: r.crime ?? prev.crime,
            broadband: r.broadband ?? prev.broadband,
            transport: r.transport ?? prev.transport,
          }));
        }
      })
      .catch(() => { /* ignore */ })
      .finally(() => setFetchingExtras(false));
  }, [access.level, access.email, listingUrl, a.floodRisk, a.nearbySchools, a.crime, a.broadband, a.transport, extrasFn]);

  const [sdMode, setSdMode] = useState<StampDutyMode>("main");
  const stampDuty = calcStampDuty(a.property.price, sdMode);

  // Single shared "upgrade to Buyer Pass" handler used by inline upgrade
  // prompts on locked sections. Uses the existing checkout flow — does NOT
  // change any payment / Stripe logic.
  const checkoutFn = useServerFn(createCheckoutSession);
  const upgradeToPass = async (lurl?: string) => {
    try {
      const targetUrl = lurl ?? listingUrl ?? "";
      const r = await checkoutFn({
        data: {
          priceId: PRICE_PASS,
          listingUrl: targetUrl,
          tier: "pass",
          analysisJobId: recallJobId(targetUrl),
          source: "results_page_upgrade",
        },
      });
      if (r?.url) window.location.href = r.url;
    } catch (e) {
      console.error("[upgradeToPass] checkout failed:", e);
    }
  };
  const [upsellOpen, setUpsellOpen] = useState(false);
  const [pendingSingleUrl, setPendingSingleUrl] = useState<string | null>(null);

  const startSingleCheckout = async (lurl?: string) => {
    try {
      const targetUrl = lurl ?? listingUrl ?? "";
      const r = await checkoutFn({
        data: {
          priceId: PRICE_SINGLE,
          listingUrl: targetUrl,
          tier: "single",
          analysisJobId: recallJobId(targetUrl),
          source: "results_page_upgrade",
        },
      });
      if (r?.url) window.location.href = r.url;
    } catch (e) {
      console.error("[upgradeToSingle] checkout failed:", e);
    }
  };
  const upgradeToSingle = async (lurl?: string) => {
    if (shouldShowPassUpsell()) {
      setPendingSingleUrl(lurl ?? listingUrl ?? "");
      setUpsellOpen(true);
      return;
    }
    await startSingleCheckout(lurl);
  };

  return (
    <div className="flex min-h-screen w-full max-w-full flex-col overflow-x-hidden bg-background animate-in fade-in slide-in-from-bottom-2 duration-700">
      <SiteHeader />
      <UpsellPassModal
        open={upsellOpen}
        onClose={() => setUpsellOpen(false)}
        onChoosePass={() => {
          setUpsellOpen(false);
          upgradeToPass(pendingSingleUrl ?? undefined);
        }}
        onChooseSingle={() => {
          setUpsellOpen(false);
          startSingleCheckout(pendingSingleUrl ?? undefined);
        }}
      />

      {access.level === "pass" && (
        <div
          className="no-print w-full max-w-full overflow-x-hidden"
          style={{
            background: "#FAECE7",
            borderBottom: "0.5px solid rgba(153,60,29,0.15)",
          }}
        >
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-2 px-4 py-2 sm:px-8" style={{ fontSize: 12, color: "#993C1D" }}>
            <span className="truncate">Buyer Pass active</span>
            <Link to="/dashboard" style={{ color: "#993C1D", fontWeight: 500 }} className="shrink-0 hover:underline">
              View all your analyses →
            </Link>
          </div>
        </div>
      )}

      <main className="mx-auto w-full max-w-5xl overflow-x-hidden px-4 py-10 sm:px-6">

        <div className="flex items-center justify-between gap-4 no-print">
          <Link
            to="/"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            ← Analyse another property
          </Link>
          <EmailReportButton
            analysis={a}
            tier={access.level === "pass" ? "pass" : access.level === "single" ? "single" : "free"}
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
                {(a.property.sqft > 0 || a.manualSqftAnalysis?.sqft) && (
                  <PropertyPill>
                    {(a.manualSqftAnalysis?.sqft ?? a.property.sqft).toLocaleString()} sq ft
                    {a.manualSqftAnalysis?.sqft && !a.property.sqft && (
                      <span style={{ marginLeft: 4, opacity: 0.7 }}>(estimated)</span>
                    )}
                  </PropertyPill>
                )}
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
            <PricePerSqftCard
              analysis={a}
              listingUrl={listingUrl}
              userEmail={access.email}
              onUpdate={(patch) => setA((prev) => ({
                ...prev,
                manualSqftAnalysis: patch,
                property: { ...prev.property, sqft: patch.sqft },
                metrics: { ...prev.metrics, pricePerSqFt: patch.pricePerSqFt },
              }))}
            />
            <DaysOnMarketCard days={a.metrics.daysOnMarket} />
            <CouncilTaxBandCard
              band={a.metrics.councilTaxBand}
              onSave={(b) => setA((prev) => ({
                ...prev,
                metrics: { ...prev.metrics, councilTaxBand: b },
              }))}
            />
            <div className="rounded-2xl border border-border bg-card p-4 shadow-soft">
              <div className="flex items-center justify-between">
                <span className="text-xs uppercase tracking-wider text-muted-foreground">Stamp duty est.</span>
                <TrendingDown className="h-4 w-4 text-muted-foreground" />
              </div>
              <div className="mt-2 text-2xl font-semibold tracking-tight">{formatGBP(stampDuty)}</div>
              <div className="mt-3 border-t border-border pt-3">
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


        {/* Seller motivation — paid tiers only (Single Report + Buyer Pass) */}
        {unlocked && (
          <SafeSection name="sellerMotivation">
            <SellerMotivationSection analysis={a} unlocked={unlocked} />
          </SafeSection>
        )}

        {/* EPC */}
        <EpcSection
          analysis={a}
          listingUrl={listingUrl}
          userEmail={access.email}
          onEpcUpdate={(epc) => setA((prev) => ({ ...prev, epc }))}
        />


        {/* Area Pricing Analysis */}
        <AreaContextSection analysis={a} />

        {/* Planning reference (factual, all tiers) */}
        <PlanningReferenceSection analysis={a} />

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
            {(() => {
              const hasSqft = Boolean(a.manualSqftAnalysis?.sqft) || (a.property?.sqft ?? 0) > 0;
              const hasEpc = Boolean(a.epc?.rating);
              const hasFlood = Boolean(a.floodRisk?.manualZone) || Boolean(a.floodRisk?.riskLevel) || Boolean(a.floodRisk?.overallRisk);
              const filtered = (a.redFlags ?? []).filter((f) => {
                const t = `${f.title} ${f.detail}`.toLowerCase();
                const missingPhrase = /(no\s|missing|not\s+(disclosed|listed|provided|stated|recorded|shown|checked|given)|undisclosed|unknown|absent|without|hidden|not\s+available)/;
                if (hasSqft && /(sq\.?\s?ft|square\s?(foot|feet|footage)|floor\s?area)/.test(t) && missingPhrase.test(t)) {
                  return false;
                }
                if (hasEpc && /\bepc\b|energy\s+performance/.test(t) && missingPhrase.test(t)) {
                  return false;
                }
                if (hasFlood && /flood/.test(t) && missingPhrase.test(t)) {
                  return false;
                }
                return true;
              });
              const list = unlocked ? filtered : filtered.slice(0, 2);
              return list.map((f, i) => <RedFlagItem key={i} flag={f} />);
            })()}
          </div>
        </section>

        {/* Viewing checklist — all users (first 2 free, rest blurred for free) */}
        <SafeSection name="viewingChecklist">
          <ViewingChecklistSection analysis={a} unlocked={unlocked} />
        </SafeSection>

        {/* Paywall (free users only) — sits between preview sections and the paid sections */}
        {!unlocked && (
          <section className="mt-10">
            <LockedFeaturesGrid />
            <div className="mt-8">
              {access.level === "expired" ? (
                <ExpiredPassGate expiresAt={access.expiresAt} listingUrl={listingUrl} />
              ) : (
                <PaywallGate listingUrl={listingUrl} />
              )}
            </div>
          </section>
        )}

        {/* True cost breakdown (paid only) */}
        {unlocked && (
          <section className="mt-10">
            <UnlockedSection title="True cost breakdown">
              <CostBreakdown analysis={a} stampDuty={stampDuty} stampDutyMode={sdMode} />
            </UnlockedSection>
          </section>
        )}

        {/* Negotiation strategy (paid only) */}
        {unlocked && (
          <section className="mt-10">
            <UnlockedSection title="Negotiation strategy">
              <Negotiation analysis={a} />
            </UnlockedSection>
          </section>
        )}

        {/* Renovation cost estimator — paid only */}
        {unlocked && (
          <SafeSection name="renovationCosts">
            <RenovationCostsSection analysis={a} unlocked />
          </SafeSection>
        )}

        {/* Postcode-driven local data sections.
            - Full postcode in address: render normally.
            - Partial postcode only ("BA1"): show inline prompt above sections so
              user can supply the full postcode and trigger a refetch.
            - No postcode at all: hide entirely when the section has no data. */}
        {(() => {
          const isPaid = access.level === "single" || access.level === "pass";
          const fullPcRe = /\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/i;
          const hasFullPostcode = fullPcRe.test(a.property?.address ?? "");
          const hasPartialPostcode = !hasFullPostcode && Boolean(a.partialPostcode);
          const noPostcode = !hasFullPostcode && !hasPartialPostcode;

          const floodMissing = !a.floodRisk || a.floodRisk.unavailable === true;
          const schoolsMissing =
            !a.nearbySchools ||
            a.nearbySchools.unavailable === true ||
            (a.nearbySchools.schools?.length ?? 0) === 0;
          const crimeMissing = !a.crime || a.crime.unavailable === true;
          const broadbandMissing = !a.broadband || a.broadband.unavailable === true;

          const sectionFetching =
            access.level === "pass" && fetchingExtras;

          // Hide a section entirely when there's no postcode at all and we have
          // no data to show. Otherwise render as before (which will show its
          // own "unavailable" state for the partial-postcode case).
          const showFlood = !(noPostcode && floodMissing);
          const showSchools = !(noPostcode && schoolsMissing);
          const showCrime = !(noPostcode && crimeMissing);
          const showBroadband = !(noPostcode && broadbandMissing);

          const showBanner =
            isPaid &&
            hasPartialPostcode &&
            (floodMissing || schoolsMissing || crimeMissing || broadbandMissing) &&
            (showFlood || showSchools || showCrime || showBroadband);

          return (
            <>
              {showBanner && (
                <PostcodePromptBanner
                  partial={a.partialPostcode ?? null}
                  email={access.email}
                  listingUrl={listingUrl}
                  onSaved={(patch) =>
                    setA((prev) => ({
                      ...prev,
                      floodRisk: patch.floodRisk ?? prev.floodRisk,
                      nearbySchools: patch.nearbySchools ?? prev.nearbySchools,
                      crime: patch.crime ?? prev.crime,
                      broadband: patch.broadband ?? prev.broadband,
                      partialPostcode: null,
                    }))
                  }
                />
              )}

              {showFlood && (
                <FloodRiskSection
                  analysis={a}
                  isBuyerPass={isPaid}
                  fetching={sectionFetching && a.floodRisk == null}
                  onUpgrade={() => upgradeToSingle(listingUrl)}
                  onUpgradePass={() => upgradeToPass(listingUrl)}
                  listingUrl={listingUrl}
                  userEmail={access.email}
                  onFloodRiskUpdate={(fr) => setA((prev) => ({ ...prev, floodRisk: fr }))}
                />
              )}

              {showSchools && (
                <NearbySchoolsSection
                  analysis={a}
                  isBuyerPass={isPaid}
                  fetching={sectionFetching && a.nearbySchools == null}
                  onUpgrade={() => upgradeToSingle(listingUrl)}
                  onUpgradePass={() => upgradeToPass(listingUrl)}
                />
              )}

              {showCrime && (
                <CrimeSection
                  analysis={a}
                  isBuyerPass={isPaid}
                  fetching={sectionFetching && a.crime == null}
                  onUpgrade={() => upgradeToSingle(listingUrl)}
                  onUpgradePass={() => upgradeToPass(listingUrl)}
                />
              )}

              {showBroadband && (
                <BroadbandSection
                  analysis={a}
                  isBuyerPass={isPaid}
                  fetching={sectionFetching && a.broadband == null}
                  onUpgrade={() => upgradeToSingle(listingUrl)}
                  onUpgradePass={() => upgradeToPass(listingUrl)}
                />
              )}

              {/* If we used Claude to guess the postcode, surface that fact and
                  let the user override it with the true postcode. */}
              {isPaid && a.inferredPostcode === true && (
                <InferredPostcodeNotice
                  inferred={a.inferredPostcodeValue ?? null}
                  email={access.email}
                  listingUrl={listingUrl}
                  onSaved={(patch) =>
                    setA((prev) => ({
                      ...prev,
                      floodRisk: patch.floodRisk ?? prev.floodRisk,
                      nearbySchools: patch.nearbySchools ?? prev.nearbySchools,
                      crime: patch.crime ?? prev.crime,
                      broadband: patch.broadband ?? prev.broadband,
                      inferredPostcode: false,
                      inferredPostcodeValue: null,
                    }))
                  }
                />
              )}
            </>
          );
        })()}

        {/* Transport links — Single Report + Buyer Pass only; hidden entirely on free */}
        {(access.level === "single" || access.level === "pass") && (
          <TransportSection
            analysis={a}
            isBuyerPass={true}
            fetching={access.level === "pass" && fetchingExtras && a.transport == null}
            onUpgrade={() => upgradeToSingle(listingUrl)}
            onUpgradePass={() => upgradeToPass(listingUrl)}
          />
        )}

        {/* Sold price history (PropertyData / Land Registry) */}
        <PriceHistorySection
          analysis={a}
          unlocked={access.level === "single" || access.level === "pass"}
          onUpgrade={() => upgradeToSingle(listingUrl)}
        />

        {/* Capital growth (PropertyData) — headline for free/single, full breakdown for pass */}
        <CapitalGrowthSection
          analysis={a}
          tier={access.level === "pass" ? "pass" : access.level === "single" ? "single" : "free"}
          onUpgradeSingle={() => upgradeToSingle(listingUrl)}
          onUpgradePass={() => upgradeToPass(listingUrl)}
        />

        {/* AI chat — Buyer Pass only; hidden entirely on free and single */}
        {access.level === "pass" && (
          <section className="mt-10">
            <PropertyChat analysis={a} />
          </section>
        )}

        {/* Inline Buyer Pass upgrade — Single Report users only */}
        {access.level === "single" && (
          <InlineBuyerPassUpgrade listingUrl={listingUrl} />
        )}


        {unlocked && access.level === "pass" && (
          <div className="mt-10 text-center">
            <Link to="/dashboard" style={{ fontSize: 13, color: "#D85A30" }}>
              Go to your dashboard →
            </Link>
          </div>
        )}
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

type ManualSqftPatch = NonNullable<AnalysisResult["manualSqftAnalysis"]>;

function PricePerSqftCard({
  analysis,
  listingUrl,
  userEmail,
  onUpdate,
}: {
  analysis: AnalysisResult;
  listingUrl?: string;
  userEmail?: string | null;
  onUpdate: (patch: ManualSqftPatch) => void;
}) {
  const ppsf = analysis.metrics?.pricePerSqFt;
  const manual = analysis.manualSqftAnalysis ?? null;
  const hasValue = (typeof ppsf === "number" && ppsf > 0) || !!manual;
  const areaAvg = analysis.areaContext?.avgPricePerSqFtArea ?? null;

  const analyseFn = useServerFn(analyseManualSqft);
  const [editing, setEditing] = useState(!hasValue);
  const [input, setInput] = useState<string>(
    manual?.sqft ? String(manual.sqft) : "",
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    const cleaned = input.replace(/[^0-9]/g, "");
    const sqft = Number(cleaned);
    if (!sqft || sqft < 50 || sqft > 50000) {
      setError("Enter a sq ft between 50 and 50,000");
      return;
    }
    setSubmitting(true);
    try {
      const r = await analyseFn({
        data: {
          sqft,
          price: analysis.property?.price ?? 0,
          propertyType: analysis.property?.type ?? null,
          address: analysis.property?.address ?? null,
          areaAvgPricePerSqFt: areaAvg,
          email: userEmail ?? null,
          listingUrl: listingUrl ?? null,
        },
      });
      onUpdate({ ...r.manualSqftAnalysis, sqft });
      setEditing(false);
    } catch (err) {
      console.error("[PricePerSqftCard] failed", err);
      setError("Could not calculate. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const deltaColor =
    manual?.vsAreaAvgLabel === "below" ? "#3B6D11" : "#A32D2D";

  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-soft">
      <div className="flex items-center justify-between">
        <span className="text-xs uppercase tracking-wider text-muted-foreground">
          Price / sq ft
        </span>
        <PoundSterling className="h-4 w-4 text-muted-foreground" />
      </div>
      <div className="mt-2 text-2xl font-semibold tracking-tight">
        {hasValue && !editing
          ? `£${(manual?.pricePerSqFt ?? ppsf ?? 0).toLocaleString()}`
          : "—"}
      </div>
      {hasValue && !editing && manual && (
        <>
          {manual.vsAreaAvg &&
            !/n\/?a/i.test(String(manual.vsAreaAvg)) &&
            manual.vsAreaAvgLabel &&
            !/n\/?a/i.test(String(manual.vsAreaAvgLabel)) &&
            typeof areaAvg === "number" &&
            areaAvg > 0 && (
              <div
                className="mt-1 text-xs"
                style={{ color: deltaColor, fontWeight: 500 }}
              >
                {manual.vsAreaAvg} {manual.vsAreaAvgLabel} area avg
              </div>
            )}
          <div
            className="mt-2 text-[11px]"
            style={{ color: "#5F5E5A", lineHeight: 1.5 }}
          >
            {manual.commentary}
          </div>
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="mt-2 text-[11px]"
            style={{ color: "#D85A30", fontWeight: 500 }}
          >
            Edit →
          </button>
        </>
      )}
      {editing && (
        <div className="mt-2">
          {!submitting && (
            <div
              className="text-[11px]"
              style={{ color: "#5F5E5A", lineHeight: 1.4 }}
            >
              Know the sq ft? Add it for a price analysis
            </div>
          )}
          {submitting ? (
            <div
              className="mt-2 text-xs"
              style={{ color: "#5F5E5A" }}
            >
              Calculating…
            </div>
          ) : (
            <div className="mt-2 flex items-center gap-1.5">
              <div className="relative flex-1">
                <input
                  type="text"
                  inputMode="numeric"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="e.g. 1,200"
                  className="w-full rounded-md border border-border bg-background px-2 py-1 pr-10 text-xs"
                />
                <span
                  className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px]"
                  style={{ color: "#888780" }}
                >
                  sq ft
                </span>
              </div>
              <button
                type="button"
                onClick={submit}
                className="shrink-0 rounded-md px-2.5 py-1 text-[11px] font-medium text-white"
                style={{ background: "#D85A30" }}
              >
                Calculate →
              </button>
            </div>
          )}
          {error && (
            <div
              className="mt-1.5 text-[11px]"
              style={{ color: "#A32D2D" }}
            >
              {error}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

type PostcodePromptPatch = {
  floodRisk: AnalysisResult["floodRisk"] | null;
  nearbySchools: AnalysisResult["nearbySchools"] | null;
  crime: AnalysisResult["crime"] | null;
  broadband: AnalysisResult["broadband"] | null;
};

function PostcodePromptBanner({
  partial,
  email,
  listingUrl,
  onSaved,
}: {
  partial: string | null;
  email: string | null;
  listingUrl?: string;
  onSaved: (patch: PostcodePromptPatch) => void;
}) {
  const refetchFn = useServerFn(refetchLocalDataForPostcode);
  const [input, setInput] = useState<string>(partial ? `${partial} ` : "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    const cleaned = input.trim().toUpperCase();
    if (!/^[A-Z]{1,2}[0-9][0-9A-Z]?\s?[0-9][A-Z]{2}$/.test(cleaned)) {
      setError("Enter a full UK postcode, e.g. BA1 5NW");
      return;
    }
    if (!email) {
      setError("You must be signed in to refresh local data");
      return;
    }
    if (!listingUrl) {
      setError("Missing listing URL");
      return;
    }
    setSubmitting(true);
    try {
      const r = await refetchFn({ data: { email, listingUrl, postcode: cleaned } });
      if (!r?.ok) {
        setError(r?.error ?? "Could not load data for that postcode");
        return;
      }
      onSaved({
        floodRisk: r.floodRisk,
        nearbySchools: r.nearbySchools,
        crime: r.crime,
        broadband: r.broadband,
      });
    } catch (err) {
      console.error("[PostcodePromptBanner] failed", err);
      setError("Could not load data for that postcode. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="mt-10 rounded-2xl border border-border p-4"
      style={{ background: "#FFFDF9", border: "0.5px solid rgba(26,17,8,0.12)" }}
    >
      <div className="flex flex-col gap-1">
        <span
          className="text-xs uppercase tracking-wider"
          style={{ color: "#888780" }}
        >
          Enter full postcode for local data
        </span>
        <span style={{ fontSize: 12, color: "#5F5E5A", lineHeight: 1.5 }}>
          The listing only included a partial postcode
          {partial ? ` (${partial})` : ""}. Add the full postcode to unlock flood
          risk, schools, crime and broadband data for this address.
        </span>
      </div>
      <div className="mt-3 flex items-center gap-1.5">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="e.g. BA1 5NW"
          autoCapitalize="characters"
          className="flex-1 rounded-md border border-border bg-background px-2 py-1 text-xs"
          disabled={submitting}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
        />
        <button
          type="button"
          onClick={submit}
          disabled={submitting}
          className="shrink-0 rounded-md px-3 py-1 text-[11px] font-medium text-white disabled:opacity-60"
          style={{ background: "#D85A30" }}
        >
          {submitting ? "Loading…" : "Save →"}
        </button>
      </div>
      {error && (
        <div className="mt-1.5 text-[11px]" style={{ color: "#A32D2D" }}>
          {error}
        </div>
      )}
    </div>
  );
}

function InferredPostcodeNotice({
  inferred,
  email,
  listingUrl,
  onSaved,
}: {
  inferred: string | null;
  email: string | null;
  listingUrl?: string;
  onSaved: (patch: PostcodePromptPatch) => void;
}) {
  const refetchFn = useServerFn(refetchLocalDataForPostcode);
  const [editing, setEditing] = useState(false);
  const [input, setInput] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    const cleaned = input.trim().toUpperCase();
    if (!/^[A-Z]{1,2}[0-9][0-9A-Z]?\s?[0-9][A-Z]{2}$/.test(cleaned)) {
      setError("Enter a full UK postcode, e.g. BA1 5NW");
      return;
    }
    if (!email) {
      setError("You must be signed in to update");
      return;
    }
    if (!listingUrl) {
      setError("Missing listing URL");
      return;
    }
    setSubmitting(true);
    try {
      const r = await refetchFn({ data: { email, listingUrl, postcode: cleaned } });
      if (!r?.ok) {
        setError(r?.error ?? "Could not load data for that postcode");
        return;
      }
      onSaved({
        floodRisk: r.floodRisk,
        nearbySchools: r.nearbySchools,
        crime: r.crime,
        broadband: r.broadband,
      });
    } catch (err) {
      console.error("[InferredPostcodeNotice] failed", err);
      setError("Could not load data for that postcode. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mt-3">
      <p style={{ fontSize: 11, color: "#888780", lineHeight: 1.5 }}>
        Postcode estimated from address
        {inferred ? ` (${inferred})` : ""} — data may vary.{" "}
        {!editing && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="hover:underline"
            style={{ color: "#D85A30", background: "transparent", border: 0, cursor: "pointer" }}
          >
            Enter the correct postcode →
          </button>
        )}
      </p>
      {editing && (
        <div className="mt-2 flex items-center gap-1.5" style={{ maxWidth: 360 }}>
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="e.g. BA1 5NW"
            autoCapitalize="characters"
            disabled={submitting}
            className="flex-1 rounded-md border border-border bg-background px-2 py-1 text-xs"
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
            }}
          />
          <button
            type="button"
            onClick={submit}
            disabled={submitting}
            className="shrink-0 rounded-md px-3 py-1 text-[11px] font-medium text-white disabled:opacity-60"
            style={{ background: "#D85A30" }}
          >
            {submitting ? "Loading…" : "Save →"}
          </button>
        </div>
      )}
      {error && (
        <div className="mt-1.5 text-[11px]" style={{ color: "#A32D2D" }}>
          {error}
        </div>
      )}
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
    <div className="rounded-2xl border border-border bg-card p-4 shadow-soft">
      <div className="flex items-center justify-between">
        <span className="text-xs uppercase tracking-wider text-muted-foreground">{label}</span>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </div>
      <div className="mt-2 text-2xl font-semibold tracking-tight">{value}</div>
      {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}

function DaysOnMarketCard({ days }: { days: number }) {
  const known = days > 0;
  let interpretation: string | null = null;
  if (known) {
    if (days < 30) interpretation = "Fast sale — limited negotiation leverage";
    else if (days <= 60) interpretation = "Normal market time — standard negotiation position";
    else if (days <= 90) interpretation = "Above average — some negotiation leverage";
    else interpretation = "Significantly above average — strong negotiation leverage";
  }
  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-soft">
      <div className="flex items-center justify-between">
        <span className="text-xs uppercase tracking-wider text-muted-foreground">Days on market</span>
        <Calendar className="h-4 w-4 text-muted-foreground" />
      </div>
      <div className="mt-2 text-2xl font-semibold tracking-tight">{known ? `${days}` : "—"}</div>
      {known && (
        <>
          <div className="mt-1 text-[11px]" style={{ color: "#888780" }}>
            UK average is ~45 days
          </div>
          <div className="mt-1 text-[11px]" style={{ color: "#888780", lineHeight: 1.4 }}>
            {interpretation}
          </div>
        </>
      )}
    </div>
  );
}

// England average annual council tax by band (2024/25, rounded).
// Used as a fallback when we don't know the property's local authority.
const COUNCIL_TAX_ENGLAND_AVG: Record<string, number> = {
  A: 1478,
  B: 1724,
  C: 1971,
  D: 2217,
  E: 2710,
  F: 3202,
  G: 3695,
  H: 4434,
};

const COUNCIL_TAX_BANDS = ["A", "B", "C", "D", "E", "F", "G", "H"] as const;
type CouncilTaxBand = (typeof COUNCIL_TAX_BANDS)[number];

export function isKnownCouncilTaxBand(v: string | undefined | null): v is CouncilTaxBand {
  if (!v) return false;
  const t = String(v).trim().toUpperCase();
  return (COUNCIL_TAX_BANDS as readonly string[]).includes(t);
}

export function annualCouncilTaxFor(band: string | undefined | null): number | null {
  if (!isKnownCouncilTaxBand(band)) return null;
  return COUNCIL_TAX_ENGLAND_AVG[String(band).trim().toUpperCase()] ?? null;
}

function CouncilTaxBandCard({
  band,
  onSave,
}: {
  band: string | undefined | null;
  onSave: (b: CouncilTaxBand) => void;
}) {
  const known = isKnownCouncilTaxBand(band);
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState<string>(known ? String(band).trim().toUpperCase() : "");
  const annual = known ? annualCouncilTaxFor(band) : null;

  const submit = () => {
    if (!isKnownCouncilTaxBand(selected)) return;
    onSave(selected.toUpperCase() as CouncilTaxBand);
    setEditing(false);
  };

  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-soft">
      <div className="flex items-center justify-between">
        <span className="text-xs uppercase tracking-wider text-muted-foreground">
          Council tax band
        </span>
        <PoundSterling className="h-4 w-4 text-muted-foreground" />
      </div>
      <div className="mt-2 text-2xl font-semibold tracking-tight">
        {known ? String(band).trim().toUpperCase() : "Unknown"}
      </div>
      {known && annual != null && !editing && (
        <>
          <div className="mt-1 text-xs" style={{ color: "#5F5E5A", fontWeight: 500 }}>
            ≈ £{annual.toLocaleString()}/yr (England avg)
          </div>
          <button
            type="button"
            onClick={() => {
              setSelected(String(band).trim().toUpperCase());
              setEditing(true);
            }}
            className="mt-2 text-[11px]"
            style={{ color: "#D85A30", fontWeight: 500 }}
          >
            Edit →
          </button>
        </>
      )}
      {(!known || editing) && (
        <div className="mt-2">
          <div className="text-[11px]" style={{ color: "#5F5E5A", lineHeight: 1.4 }}>
            Know the band? Add it for cost analysis
          </div>
          <div className="mt-2 flex items-center gap-1.5">
            <select
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
              className="flex-1 rounded-md border border-border bg-background px-2 py-1 text-xs"
              aria-label="Council tax band"
            >
              <option value="">Select…</option>
              {COUNCIL_TAX_BANDS.map((b) => (
                <option key={b} value={b}>
                  Band {b}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={submit}
              disabled={!isKnownCouncilTaxBand(selected)}
              className="shrink-0 rounded-md px-2.5 py-1 text-[11px] font-medium text-white disabled:opacity-50"
              style={{ background: "#D85A30" }}
            >
              Save →
            </button>
          </div>
        </div>
      )}
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

const FULL_REPORT_FEATURES: { title: string; sub: string; note?: string }[] = [
  { title: "All red flags", sub: "See every issue we found" },
  { title: "True cost breakdown", sub: "Total upfront + monthly costs" },
  { title: "Negotiation strategy", sub: "Recommended offer and your leverage" },
  { title: "Flood risk", sub: "Environment Agency data — insurance and mortgage implications" },
  { title: "Nearby schools", sub: "Ofsted ratings within 5 miles" },
  { title: "Crime statistics", sub: "Local crime data by category" },
  { title: "Broadband & connectivity", sub: "Real download speeds for this postcode" },
  { title: "Transport links", sub: "Nearest stations, buses and commute times", note: "London properties only" },
  { title: "EPC analysis", sub: "Energy rating and improvement costs" },
  { title: "Stamp duty calculator", sub: "First-time buyer, main residence and additional property" },
  { title: "Viewing checklist", sub: "What to check on the day" },
  { title: "Renovation cost estimate", sub: "What it would cost to improve" },
  { title: "Seller motivation score", sub: "How motivated is the vendor to sell?" },
  { title: "Area pricing analysis", sub: "Local comparables and price per sq ft" },
];

function LockedFeaturesGrid() {
  return (
    <div>
      <div className="mb-4">
        <h2 className="text-xl font-semibold tracking-tight">What's included in the full report</h2>
        <p className="text-sm text-muted-foreground">Everything you unlock below.</p>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {FULL_REPORT_FEATURES.map((f) => (
          <div
            key={f.title}
            style={{
              background: "#F1EFE8",
              borderRadius: 12,
              padding: 14,
            }}
          >
            <div className="flex items-center gap-1.5">
              <Lock className="h-3.5 w-3.5 shrink-0" style={{ color: "#D85A30" }} />
              <h4 className="text-sm font-semibold tracking-tight" style={{ color: "#1A1108" }}>
                {f.title}
              </h4>
            </div>
            <p className="mt-1 text-[12px]" style={{ color: "#5F5E5A", lineHeight: 1.45 }}>
              {f.sub}
            </p>
            {f.note && (
              <p className="mt-1 text-[10px]" style={{ color: "#888780", lineHeight: 1.4 }}>
                {f.note}
              </p>
            )}
          </div>
        ))}
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
        data: {
          priceId: PRICE_PASS,
          listingUrl: listingUrl ?? "",
          tier: "pass",
          analysisJobId: recallJobId(listingUrl),
          source: "results_page_upgrade",
        },
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
  const annualCouncilTax = annualCouncilTaxFor(analysis.metrics?.councilTaxBand);
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
        {annualCouncilTax != null && (
          <div className="mt-4 rounded-xl p-4" style={{ background: "#F1EFE8" }}>
            <div className="text-xs uppercase tracking-wider" style={{ color: "#5F5E5A" }}>
              Annual council tax (Band {String(analysis.metrics.councilTaxBand).trim().toUpperCase()})
            </div>
            <div className="mt-1 text-lg font-semibold tracking-tight" style={{ color: "#1A1108" }}>
              {formatGBP(annualCouncilTax)}/yr
              <span className="ml-2 text-xs font-normal" style={{ color: "#5F5E5A" }}>
                ≈ {formatGBP(Math.round(annualCouncilTax / 12))}/mo
              </span>
            </div>
            <div className="mt-1 text-[11px]" style={{ color: "#888780" }}>
              England average — actual rate varies by local authority.
            </div>
          </div>
        )}
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
  const [upsellOpen, setUpsellOpen] = useState(false);
  const passDiscount = usePassDiscount();

  const startCheckout = async (tier: "single" | "pass") => {
    setErr(null);
    setLoadingTier(tier);
    try {
      const priceId =
        tier === "single"
          ? PRICE_SINGLE
          : passDiscount.eligible
            ? passDiscount.priceId
            : PRICE_PASS;
      const res = await checkoutFn({
        data: {
          priceId,
          listingUrl: listingUrl ?? "",
          tier,
          analysisJobId: recallJobId(listingUrl),
          source: "results_page_upgrade",
        },
      });
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

  const handleBuy = async (tier: "single" | "pass") => {
    if (tier === "single" && shouldShowPassUpsell()) {
      setUpsellOpen(true);
      return;
    }
    await startCheckout(tier);
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
      <UpsellPassModal
        open={upsellOpen}
        onClose={() => { setUpsellOpen(false); setLoadingTier(null); }}
        onChoosePass={() => { setUpsellOpen(false); startCheckout("pass"); }}
        onChooseSingle={() => { setUpsellOpen(false); startCheckout("single"); }}
      />
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
        <PlanCard
          id="buyer-pass-card"
          title="Buyer Pass"
          price={passDiscount.eligible ? "£20.00" : "£24.99"}
          originalPrice={passDiscount.eligible ? "£24.99" : undefined}
          cadence="90-day pass · one-off payment"
          cta={passDiscount.eligible ? "Upgrade for £20 →" : "Get Buyer Pass"}
          highlight
          loading={loadingTier === "pass"}
          onClick={() => handleBuy("pass")}
          subnote={
            passDiscount.eligible
              ? "You've already spent £4.99 on a Single Report — we'll deduct it from your Buyer Pass"
              : undefined
          }
          plusIntro="Everything in Single Report, plus:"
          features={[
            "Unlimited analyses for 90 days",
            "AI chat on every property",
            "Compare your property scores",
            "All reports saved to dashboard",
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

const SUB_SCORE_LABELS: { key: SubScoreKey; label: string; how: string }[] = [
  {
    key: "valueForMoney",
    label: "Value for money",
    how: "Based on price per sq ft vs local comparables, days on market, and recent sold prices in the area.",
  },
  {
    key: "locationQuality",
    label: "Location quality",
    how: "Based on local schools, crime rates, transport links, broadband, and area growth data.",
  },
  {
    key: "listingTransparency",
    label: "Listing transparency",
    how: "Based on information disclosed in the listing — sq ft, EPC, council tax, floor plans, photos.",
  },
  {
    key: "marketTiming",
    label: "Market timing",
    how: "Based on days on market, price reductions, seasonal trends, and local demand signals.",
  },
  {
    key: "riskLevel",
    label: "Risk level",
    how: "Based on red flags identified, property type, age, and legal/structural considerations.",
  },
  {
    key: "resalePotential",
    label: "Resale potential",
    how: "Based on location quality, property type, local growth trends, and market demand.",
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
        style={{ color: "#D85A30", lineHeight: 0 }}
      >
        <Info size={18} aria-hidden="true" strokeWidth={2.25} />
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
        <div className="space-y-4">
          {SUB_SCORE_LABELS.map(({ key, label, how }) => {
            const v = Number(sub[key] ?? 0);
            const pct = Math.max(0, Math.min(100, (v / 10) * 100));
            const color = scoreColor(v);
            const reason = reasons[key];
            const summary = reason && reason.trim().length > 0 ? reason.trim() : null;
            return (
              <div key={key}>
                <div className="grid grid-cols-[minmax(140px,160px)_1fr_36px] items-center gap-4">
                  <span className="inline-flex items-center gap-1.5" style={{ fontSize: 13, color: "#5F5E5A" }}>
                    {label}
                    <ScoreInfoTooltip text={how} />
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
                {summary && (
                  <p className="mt-1.5" style={{ fontSize: 12, color: "#888780", lineHeight: 1.5 }}>
                    {summary}
                  </p>
                )}
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
  // Prefer manual sqft analysis when present so the Area Pricing Analysis card
  // updates reactively the moment the user saves a sq ft value via the
  // "Edit sq ft" field on the Price / sq ft card.
  const manualPpsf = analysis.manualSqftAnalysis?.pricePerSqFt;
  const propPpsf =
    typeof manualPpsf === "number" && manualPpsf > 0
      ? manualPpsf
      : analysis.metrics?.pricePerSqFt;
  const areaPpsf = ac.avgPricePerSqFtArea;
  const haveBoth =
    typeof propPpsf === "number" && propPpsf > 0 &&
    typeof areaPpsf === "number" && areaPpsf > 0;
  const ppsfPct = haveBoth ? ((propPpsf - areaPpsf) / areaPpsf) * 100 : null;
  const ppsfText =
    ppsfPct === null
      ? null
      : `${ppsfPct > 0 ? "+" : ""}${ppsfPct.toFixed(1)}%`;
  const ppsfColor =
    ppsfPct === null
      ? "#5F5E5A"
      : ppsfPct <= 0
      ? "#3B6D11"
      : ppsfPct > 10
      ? "#A32D2D"
      : "#A36A1F";
  const hasAreaPpsf = typeof areaPpsf === "number" && areaPpsf > 0;
  const avgSqFt = hasAreaPpsf ? `£${Math.round(areaPpsf)}` : null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pd = (analysis as any).propertyData ?? null;
  const askingAvg =
    pd?.pricesPerSqf?.average && pd.pricesPerSqf.average > 0
      ? Math.round(pd.pricesPerSqf.average)
      : null;
  const soldAvg =
    pd?.soldPricesPerSqf?.average && pd.soldPricesPerSqf.average > 0
      ? Math.round(pd.soldPricesPerSqf.average)
      : null;
  return (
    <section className="mt-10">
      <h2 className="text-xl font-semibold tracking-tight">Area Pricing Analysis</h2>
      <div className="mt-4 rounded-2xl border border-border bg-card p-6 shadow-soft">
        {(hasAreaPpsf || ppsfText) && (
          <div className="grid gap-4 sm:grid-cols-2">
            {hasAreaPpsf && (
              <div className="rounded-xl p-5" style={{ background: "#F1EFE8" }}>
                <div className="text-xs uppercase tracking-wider" style={{ color: "#5F5E5A" }}>
                  Area avg price / sq ft (sold)
                </div>
                <div className="mt-2 text-2xl font-semibold tracking-tight" style={{ color: "#1A1108" }}>
                  {avgSqFt}
                </div>
                {askingAvg && soldAvg && (
                  <div className="mt-2 text-[11px]" style={{ color: "#5F5E5A", lineHeight: 1.5 }}>
                    Current asking £{askingAvg.toLocaleString()}/sqft vs sold £{soldAvg.toLocaleString()}/sqft
                  </div>
                )}
              </div>
            )}
            {ppsfText && (
              <div className="rounded-xl p-5" style={{ background: "#F1EFE8" }}>
                <div className="flex items-center gap-1.5 text-xs uppercase tracking-wider" style={{ color: "#5F5E5A" }}>
                  <span>Price per sq ft vs area avg</span>
                  <ScoreInfoTooltip text="Compares this property's price per sq ft against the local sold £/sqft average from Land Registry data. A negative % means better value per sq ft than typical sold prices." />
                </div>
                <div className="mt-2 text-2xl font-semibold tracking-tight" style={{ color: ppsfColor }}>
                  {ppsfText}
                </div>
                <div className="mt-1 text-[11px]" style={{ color: "#5F5E5A" }}>
                  {ppsfPct !== null && ppsfPct > 0 ? "above" : "below"} area avg
                </div>
              </div>
            )}
          </div>
        )}
        {ac.areaDescription && (
          <p className="mt-4 text-sm" style={{ color: "#1A1108" }}>{ac.areaDescription}</p>
        )}
        {ac.comparableNote && (
          <p className="mt-2 text-sm" style={{ color: "#1A1108" }}>{ac.comparableNote}</p>
        )}
        <p className="mt-4 text-xs" style={{ color: "#888780" }}>
          {soldAvg
            ? "Area £/sqft from PropertyData (Land Registry sold transactions)."
            : "Area estimates based on listing data and Claude's training knowledge."}
        </p>
      </div>
    </section>
  );
}

function PlanningReferenceSection({ analysis }: { analysis: AnalysisResult }) {
  const pr = analysis.planningReference;
  if (!pr || !pr.found || !pr.reference) return null;
  return (
    <section className="mt-10">
      <div
        style={{
          background: "#FFFDF9",
          border: "0.5px solid rgba(26,17,8,0.12)",
          borderRadius: 12,
          padding: 20,
        }}
      >
        <div
          style={{
            fontSize: 10,
            color: "#D85A30",
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            fontWeight: 600,
          }}
        >
          Planning reference found
        </div>
        <h3
          className="mt-1"
          style={{ fontSize: 16, fontWeight: 600, color: "#1A1108" }}
        >
          Planning application reference: {pr.reference}
        </h3>
        {pr.relatesTo && (
          <p className="mt-1" style={{ fontSize: 13, color: "#5F5E5A" }}>
            Relates to: {pr.relatesTo}
          </p>
        )}
        {pr.applicationType && (
          <span
            className="mt-3 inline-block"
            style={{
              background: "#F1EFE8",
              color: "#1A1108",
              fontSize: 12,
              fontWeight: 500,
              borderRadius: 100,
              padding: "4px 10px",
            }}
          >
            {pr.applicationType}
          </span>
        )}
        {pr.commentary && (
          <p className="mt-3" style={{ fontSize: 13, color: "#5F5E5A", lineHeight: 1.55 }}>
            {pr.commentary}
          </p>
        )}
        <div
          className="mt-4"
          style={{
            background: "#F1EFE8",
            borderRadius: 8,
            padding: "10px 12px",
            fontSize: 12,
            color: "#1A1108",
          }}
        >
          Request the planning decision notice and building regs completion certificate from the seller's solicitors during conveyancing.
        </div>
        <div className="mt-3">
          <a
            href="https://www.planningportal.co.uk"
            target="_blank"
            rel="noopener noreferrer"
            style={{ fontSize: 13, color: "#D85A30", fontWeight: 500 }}
          >
            Search this reference at planningportal.co.uk →
          </a>
        </div>
        <p className="mt-3" style={{ fontSize: 11, color: "#888780" }}>
          Reference extracted from listing text — verify with local authority.
        </p>
      </div>
    </section>
  );
}

function isAuctionAnalysis(a: AnalysisResult): boolean {
  // Trust only the explicit auction flag from analysis, or unambiguous
  // auction language in the property type itself. Do NOT scan red-flag
  // text or rationale — those routinely mention "auction" in passing
  // (e.g. "not an auction property", "guide price ≠ auction") and were
  // causing false positives on standard residential listings.
  if (a.negotiation?.isAuction === true) return true;
  const type = (a.property?.type ?? "").toLowerCase();
  if (/\bauction\b|\bauctioneer\b|\blot\s*number\b|modern method of auction/.test(type)) {
    return true;
  }
  return false;
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

type EpcData = NonNullable<AnalysisResult["epc"]>;

const EPC_SESSION_PREFIX = "roovr:epc:";
function epcSessionKey(listingUrl?: string) {
  return listingUrl ? `${EPC_SESSION_PREFIX}${listingUrl}` : null;
}
function readSessionEpc(listingUrl?: string): EpcData | null {
  const key = epcSessionKey(listingUrl);
  if (!key || typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as EpcData) : null;
  } catch {
    return null;
  }
}
function writeSessionEpc(listingUrl: string | undefined, epc: EpcData) {
  const key = epcSessionKey(listingUrl);
  if (!key || typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(key, JSON.stringify(epc));
  } catch {
    /* ignore quota errors */
  }
}

function EpcSection({
  analysis,
  listingUrl,
  userEmail,
  onEpcUpdate,
}: {
  analysis: AnalysisResult;
  listingUrl?: string;
  userEmail?: string | null;
  onEpcUpdate?: (epc: EpcData) => void;
}) {
  const analyseFn = useServerFn(analyseEpcRating);

  // Hydrate from sessionStorage on mount for free users who entered a rating
  // earlier and refreshed the page.
  useEffect(() => {
    if (analysis.epc?.rating) return;
    const cached = readSessionEpc(listingUrl);
    if (cached && onEpcUpdate) onEpcUpdate(cached);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const epc = analysis.epc;
  const rating =
    epc?.rating && /^[A-G]$/i.test(epc.rating.trim())
      ? epc.rating.trim().toUpperCase()
      : null;
  const activeBand = rating ? EPC_BANDS.find((b) => b.letter === rating) : null;

  const [editing, setEditing] = useState(false);
  const [pick, setPick] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startEdit = () => {
    setPick(rating ?? null);
    setError(null);
    setEditing(true);
  };

  const handleAnalyse = async () => {
    if (!pick) return;
    setSubmitting(true);
    setError(null);
    try {
      const r = await analyseFn({
        data: {
          epcRating: pick,
          propertyType: analysis.property?.type ?? null,
          sqft: analysis.property?.sqft ?? null,
          address: analysis.property?.address ?? null,
          price: analysis.property?.price ?? null,
          email: userEmail ?? null,
          listingUrl: listingUrl ?? null,
        },
      });
      const next: EpcData = r.epc;
      writeSessionEpc(listingUrl, next);
      onEpcUpdate?.(next);
      setEditing(false);
    } catch (err) {
      console.error("[EpcSection] analyse failed:", err);
      setError("Could not analyse that EPC rating. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const showInput = editing || !rating;

  return (
    <section className="mt-10">
      <h2 className="text-xl font-semibold tracking-tight">Energy performance (EPC)</h2>
      <div className="mt-4 rounded-2xl border border-border bg-card p-6 shadow-soft">
        {showInput ? (
          <div>
            <p className="text-sm" style={{ color: "#1A1108" }}>
              Know the EPC rating? Enter it below and we'll analyse what it means for this property.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {EPC_BANDS.map((b) => {
                const selected = pick === b.letter;
                return (
                  <button
                    key={b.letter}
                    type="button"
                    onClick={() => setPick(b.letter)}
                    disabled={submitting}
                    aria-pressed={selected}
                    className="inline-flex items-center justify-center rounded-full text-sm font-semibold transition-all"
                    style={{
                      width: 44,
                      height: 44,
                      background: selected ? "#D85A30" : "transparent",
                      color: selected ? "#FFFFFF" : "#5F5E5A",
                      border: selected ? "1px solid #D85A30" : "1px solid #5F5E5A",
                    }}
                  >
                    {b.letter}
                  </button>
                );
              })}
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={handleAnalyse}
                disabled={!pick || submitting}
                className="inline-flex items-center justify-center rounded-full transition-opacity hover:opacity-90 disabled:opacity-50"
                style={{
                  background: "#D85A30",
                  color: "#FFFDF9",
                  fontSize: 13,
                  fontWeight: 500,
                  padding: "10px 20px",
                }}
              >
                {submitting ? (
                  <>
                    <span
                      aria-hidden
                      className="mr-2 inline-block h-3 w-3 animate-spin rounded-full"
                      style={{ border: "2px solid #FFFDF9", borderTopColor: "transparent" }}
                    />
                    Analysing energy performance…
                  </>
                ) : (
                  "Analyse EPC →"
                )}
              </button>
              {editing && rating && (
                <button
                  type="button"
                  onClick={() => setEditing(false)}
                  disabled={submitting}
                  className="text-sm transition-colors hover:text-foreground"
                  style={{ color: "#888780" }}
                >
                  Cancel
                </button>
              )}
            </div>
            {error && (
              <p className="mt-3 text-sm" style={{ color: "#D43A2F" }}>{error}</p>
            )}
            <p className="mt-3" style={{ fontSize: 11, color: "#888780" }}>
              You can find the EPC rating on the agent's brochure, the EPC register at epcregister.com, or by asking the agent directly.
            </p>
          </div>
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
            <button
              type="button"
              onClick={startEdit}
              className="mt-4 transition-colors hover:text-foreground"
              style={{ fontSize: 11, color: "#888780" }}
            >
              Edit EPC rating →
            </button>
          </>
        )}
      </div>
    </section>
  );
}

function EmailReportButton({
  analysis,
  tier,
  userEmail,
}: {
  analysis: AnalysisResult;
  tier: "free" | "single" | "pass";
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
      const r = await sendFn({ data: { email: to, analysis, resultsUrl, tier } });
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
    <div className="flex w-full min-w-0 max-w-full flex-col items-end gap-2">
      {showInput && !userEmail ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const v = emailInput.trim();
            if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) void send(v);
          }}
          className="flex w-full min-w-0 items-center gap-2"
        >
          <input
            type="email"
            required
            value={emailInput}
            onChange={(e) => setEmailInput(e.target.value)}
            placeholder="your@email.com"
            disabled={status === "sending"}
            className="w-full min-w-0 sm:min-w-[200px]"
            style={{
              border: "1px solid rgba(26,17,8,0.2)",
              background: "#FFFDF9",
              borderRadius: 100,
              fontSize: 13,
              padding: "7px 12px",
              color: "#1A1108",
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

function TransportSection({ analysis, isBuyerPass, fetching: _fetching, onUpgrade, onUpgradePass }: { analysis: AnalysisResult; isBuyerPass: boolean; fetching?: boolean; onUpgrade?: () => void; onUpgradePass?: () => void }) {
  void _fetching;
  const ptal = analysis.ptal;

  // Hide the entire section when there is no PTAL data (e.g. postcode outside
  // London, or PropertyData returned nothing). No "unavailable" placeholder.
  if (isBuyerPass && !ptal) return null;

  const cardStyle: CSSProperties = {
    background: "#FFFDF9",
    border: "0.5px solid rgba(26,17,8,0.12)",
    borderRadius: 12,
    padding: 20,
  };
  const heading = (
    <h2 className="text-xl font-semibold tracking-tight" style={{ color: "#1A1108" }}>
      Transport links
    </h2>
  );

  if (!isBuyerPass) {
    return (
      <section className="mt-10">
        {heading}
        <div className="mt-4 relative overflow-hidden" style={cardStyle}>
          <div style={{ filter: "blur(5px)", userSelect: "none", pointerEvents: "none" }}>
            <div className="flex items-center justify-between">
              <p style={{ fontSize: 14, color: "#1A1108", fontWeight: 500 }}>PTAL score</p>
              <span style={{ background: "#EAF3DE", color: "#27500A", borderRadius: 999, padding: "4px 10px", fontSize: 12, fontWeight: 500 }}>6a · Excellent</span>
            </div>
            <p className="mt-3" style={{ fontSize: 13, color: "#5F5E5A" }}>
              Multiple frequent bus and tube connections within walking distance.
            </p>
          </div>
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-6">
            <Lock className="h-5 w-5 mb-2" style={{ color: "#D85A30" }} />
            <p style={{ fontSize: 13, color: "#1A1108", maxWidth: 340 }}>
              Unlock with a Single Report — £4.99 to see transport links and PTAL scores
            </p>
            <div className="mt-3 flex flex-col items-center gap-1">
              {onUpgrade && (
                <button type="button" onClick={onUpgrade} className="hover:underline" style={{ fontSize: 13, color: "#D85A30", background: "transparent", border: 0, cursor: "pointer", fontWeight: 500 }}>
                  Get Single Report — £4.99 →
                </button>
              )}
              {onUpgradePass && (
                <button type="button" onClick={onUpgradePass} className="hover:underline" style={{ fontSize: 13, color: "#D85A30", background: "transparent", border: 0, cursor: "pointer", fontWeight: 500 }}>
                  Or unlock Buyers Pass for all features and unlimited reports for 90 days — £24.99 →
                </button>
              )}
            </div>
          </div>
        </div>
      </section>
    );
  }

  if (!ptal) return null;

  const ratingBadge = (label: string): CSSProperties => {
    const v = label.toLowerCase();
    if (v.includes("excellent")) return { background: "#27500A", color: "#FFFFFF" };
    if (v.includes("very good") || v === "good") return { background: "#EAF3DE", color: "#27500A" };
    if (v.includes("moderate")) return { background: "#FAEEDA", color: "#633806" };
    return { background: "#FAECE7", color: "#A32D2D" };
  };

  return (
    <section className="mt-10">
      {heading}
      <div className="mt-4" style={cardStyle}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p style={{ fontSize: 11, color: "#888780", textTransform: "uppercase", letterSpacing: 0.4 }}>
              PTAL · Public Transport Accessibility Level
            </p>
            <p className="mt-1" style={{ fontSize: 22, color: "#1A1108", fontWeight: 600, lineHeight: 1.2 }}>
              {ptal.grade}
            </p>
          </div>
          <span style={{ ...ratingBadge(ptal.label), borderRadius: 999, padding: "4px 12px", fontSize: 12, fontWeight: 500, whiteSpace: "nowrap" }}>
            {ptal.label}
          </span>
        </div>

        <p className="mt-4" style={{ fontSize: 13, color: "#1A1108", lineHeight: 1.6 }}>
          {ptal.explanation}
        </p>

        <p className="mt-4" style={{ fontSize: 10, color: "#888780" }}>
          Source: {ptal.source ?? "PropertyData / TfL PTAL"}. PTAL ranges from 0 (very poor) to 6b (excellent).
        </p>
      </div>
    </section>
  );
}



function OfstedBadge({ rating }: { rating: number | null }) {
  const map: Record<number, { label: string; bg: string; fg: string }> = {
    1: { label: "Outstanding", bg: "#EAF3DE", fg: "#27500A" },
    2: { label: "Good", bg: "#F1F7E5", fg: "#3F6B12" },
    3: { label: "Requires Improvement", bg: "#FAEEDA", fg: "#633806" },
    4: { label: "Inadequate", bg: "#FAECE7", fg: "#A32D2D" },
  };
  const m = rating && map[rating];
  if (!m) {
    return (
      <span style={{ background: "#F1EFE8", color: "#5F5E5A", borderRadius: 999, padding: "3px 8px", fontSize: 11, fontWeight: 500 }}>
        Not yet rated
      </span>
    );
  }
  return (
    <span style={{ background: m.bg, color: m.fg, borderRadius: 999, padding: "3px 8px", fontSize: 11, fontWeight: 500 }}>
      {m.label}
    </span>
  );
}

function SchoolRow({ s }: { s: NonNullable<AnalysisResult["nearbySchools"]>["schools"][number] }) {
  return (
    <li className="flex items-start justify-between gap-3 py-2.5" style={{ borderTop: "0.5px solid rgba(26,17,8,0.08)" }}>
      <div className="min-w-0 flex-1">
        <div className="truncate" style={{ fontSize: 13, fontWeight: 500, color: "#1A1108" }}>{s.name}</div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3" style={{ fontSize: 11, color: "#888780" }}>
          <span>{s.distanceMiles.toFixed(1)} miles</span>
          {s.schoolType && <span>{s.schoolType}</span>}
        </div>
      </div>
      <div className="shrink-0">
        <OfstedBadge rating={s.ofstedRating} />
      </div>
    </li>
  );
}

function NearbySchoolsSection({ analysis, isBuyerPass, fetching, onUpgrade, onUpgradePass }: { analysis: AnalysisResult; isBuyerPass: boolean; fetching?: boolean; onUpgrade?: () => void; onUpgradePass?: () => void }) {
  const cardStyle: CSSProperties = {
    background: "#FFFDF9",
    border: "0.5px solid rgba(26,17,8,0.12)",
    borderRadius: 12,
    padding: 20,
  };

  const heading = (
    <h2 className="text-xl font-semibold tracking-tight" style={{ color: "#1A1108" }}>
      Nearby schools
    </h2>
  );

  if (!isBuyerPass) {
    return (
      <section className="mt-10">
        {heading}
        <div className="mt-4 relative overflow-hidden" style={cardStyle}>
          <div style={{ filter: "blur(5px)", userSelect: "none", pointerEvents: "none" }}>
            <p style={{ fontSize: 14, color: "#1A1108", fontWeight: 500 }}>St Mary's Primary School</p>
            <p className="mt-1" style={{ fontSize: 11, color: "#888780" }}>0.4 miles · Primary</p>
            <p className="mt-3" style={{ fontSize: 14, color: "#1A1108", fontWeight: 500 }}>Greenfield Secondary</p>
            <p className="mt-1" style={{ fontSize: 11, color: "#888780" }}>0.7 miles · Secondary</p>
          </div>
          <div className="absolute inset-0 flex flex-col items-center justify-center" style={{ background: "rgba(255,253,249,0.85)" }}>
            <Lock className="h-5 w-5 mb-2" style={{ color: "#D85A30" }} />
            <p className="text-center" style={{ fontSize: 13, color: "#1A1108", maxWidth: 320 }}>
              Unlock with a Single Report — £4.99 to see nearby schools and Ofsted ratings
            </p>
            <div className="mt-3 flex flex-col items-center gap-1">
              {onUpgrade && (
                <button type="button" onClick={onUpgrade} className="hover:underline" style={{ fontSize: 13, color: "#D85A30", background: "transparent", border: 0, cursor: "pointer", fontWeight: 500 }}>
                  Get Single Report — £4.99 →
                </button>
              )}
              {onUpgradePass && (
                <button type="button" onClick={onUpgradePass} className="hover:underline" style={{ fontSize: 13, color: "#D85A30", background: "transparent", border: 0, cursor: "pointer", fontWeight: 500 }}>
                  Or unlock Buyers Pass for all features and unlimited reports for 90 days — £24.99 →
                </button>
              )}
            </div>
          </div>
        </div>
      </section>
    );
  }

  const ns = analysis.nearbySchools;
  const allSchools = [...(ns?.schools ?? [])].sort(
    (a, b) => (a.distanceMiles ?? 999) - (b.distanceMiles ?? 999),
  );
  const primary = allSchools.filter((s) => s.phase === "primary").slice(0, 5);
  const secondary = allSchools.filter((s) => s.phase === "secondary").slice(0, 5);
  const empty = primary.length === 0 && secondary.length === 0;

  return (
    <section className="mt-10">
      {heading}
      <div className="mt-4" style={cardStyle}>
        {ns?.unavailable || empty ? (() => {
          const addr = analysis.property?.address ?? "";
          const pcMatch = addr.match(/[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}/i);
          const pc = pcMatch ? pcMatch[0].toUpperCase() : "";
          const giasUrl = pc
            ? `https://www.get-information-schools.service.gov.uk/Search?SelectedTab=Establishments&Searchtext=${encodeURIComponent(pc)}`
            : "https://www.get-information-schools.service.gov.uk";
          return (
            <p style={{ fontSize: 13, color: "#5F5E5A", lineHeight: 1.6 }}>
              No schools found within 5 miles{pc ? ` of ${pc}` : ""}. Search schools{pc ? ` near ${pc}` : ""} at{" "}
              <a
                href={giasUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: "#D85A30" }}
                className="hover:underline"
              >
                get-information-schools.service.gov.uk
              </a>
              .
            </p>
          );
        })() : (
          <div className="flex flex-col gap-6">
            {primary.length > 0 && (
              <div>
                <h3 style={{ fontSize: 12, fontWeight: 500, color: "#888780", textTransform: "uppercase", letterSpacing: 0.5 }}>
                  Primary
                </h3>
                <ul className="mt-2">
                  {primary.map((s, i) => <SchoolRow key={`p-${i}`} s={s} />)}
                </ul>
              </div>
            )}
            {secondary.length > 0 && (
              <div>
                <h3 style={{ fontSize: 12, fontWeight: 500, color: "#888780", textTransform: "uppercase", letterSpacing: 0.5 }}>
                  Secondary
                </h3>
                <ul className="mt-2">
                  {secondary.map((s, i) => <SchoolRow key={`s-${i}`} s={s} />)}
                </ul>
              </div>
            )}
          </div>
        )}
        <p className="mt-4" style={{ fontSize: 10, color: "#888780" }}>
          {ns?.aiSourced
            ? "School information based on AI knowledge — verify at get-information-schools.service.gov.uk"
            : "Source: DfE / Ofsted — schools within 5 miles"}
        </p>
      </div>
    </section>
  );
}

function CrimeSection({ analysis, isBuyerPass, fetching, onUpgrade, onUpgradePass }: { analysis: AnalysisResult; isBuyerPass: boolean; fetching?: boolean; onUpgrade?: () => void; onUpgradePass?: () => void }) {
  const cardStyle: CSSProperties = {
    background: "#FFFDF9",
    border: "0.5px solid rgba(26,17,8,0.12)",
    borderRadius: 12,
    padding: 20,
  };
  const heading = (
    <h2 className="text-xl font-semibold tracking-tight" style={{ color: "#1A1108" }}>
      Crime statistics
    </h2>
  );

  if (!isBuyerPass) {
    return (
      <section className="mt-10">
        {heading}
        <div className="mt-4 relative overflow-hidden" style={cardStyle}>
          <div style={{ filter: "blur(5px)", userSelect: "none", pointerEvents: "none" }}>
            <div className="flex items-center justify-between">
              <p style={{ fontSize: 14, color: "#1A1108", fontWeight: 500 }}>Recorded crimes (last month)</p>
              <span style={{ background: "#FAEEDA", color: "#633806", borderRadius: 999, padding: "4px 10px", fontSize: 12, fontWeight: 500 }}>Moderate</span>
            </div>
            <div className="mt-3 space-y-2">
              <div style={{ fontSize: 13, color: "#5F5E5A" }}>Anti-social behaviour: 42</div>
              <div style={{ fontSize: 13, color: "#5F5E5A" }}>Violence and sexual offences: 28</div>
              <div style={{ fontSize: 13, color: "#5F5E5A" }}>Vehicle crime: 14</div>
              <div style={{ fontSize: 13, color: "#5F5E5A" }}>Burglary: 9</div>
            </div>
          </div>
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-6">
            <Lock className="h-5 w-5 mb-2" style={{ color: "#D85A30" }} />
            <p style={{ fontSize: 13, color: "#1A1108", maxWidth: 340 }}>
              Unlock with a Single Report — £4.99 to see local crime statistics
            </p>
            <div className="mt-3 flex flex-col items-center gap-1">
              {onUpgrade && (
                <button type="button" onClick={onUpgrade} className="hover:underline" style={{ fontSize: 13, color: "#D85A30", background: "transparent", border: 0, cursor: "pointer", fontWeight: 500 }}>
                  Get Single Report — £4.99 →
                </button>
              )}
              {onUpgradePass && (
                <button type="button" onClick={onUpgradePass} className="hover:underline" style={{ fontSize: 13, color: "#D85A30", background: "transparent", border: 0, cursor: "pointer", fontWeight: 500 }}>
                  Or unlock Buyers Pass for all features and unlimited reports for 90 days — £24.99 →
                </button>
              )}
            </div>
          </div>
        </div>
      </section>
    );
  }

  const crime = analysis.crime;

  if (fetching && !crime) {
    return (
      <section className="mt-10">
        {heading}
        <div className="mt-4" style={cardStyle}>
          <p style={{ fontSize: 13, color: "#5F5E5A" }}>Loading crime statistics…</p>
        </div>
      </section>
    );
  }

  if (!crime || crime.unavailable) {
    return (
      <section className="mt-10">
        {heading}
        <div className="mt-4" style={cardStyle}>
          <p style={{ fontSize: 13, color: "#5F5E5A" }}>
            Crime data is currently unavailable for this postcode. Check{" "}
            <a href="https://www.police.uk/pu/your-area/" target="_blank" rel="noopener noreferrer" style={{ color: "#D85A30" }} className="hover:underline">
              police.uk
            </a>{" "}
            directly.
          </p>
        </div>
      </section>
    );
  }

  const badgeStyle = (level: string): CSSProperties => {
    const v = level.toLowerCase();
    if (v === "very high") return { background: "#7A1D1D", color: "#FFFFFF" };
    if (v === "high") return { background: "#FAECE7", color: "#A32D2D" };
    if (v === "moderate") return { background: "#FAEEDA", color: "#633806" };
    return { background: "#EAF3DE", color: "#27500A" };
  };

  const top = crime.topCategories.slice(0, 4);
  const maxCount = top.reduce((m, c) => Math.max(m, c.count), 1);
  const monthLabel = (() => {
    const [y, m] = crime.month.split("-").map(Number);
    if (!y || !m) return crime.month;
    return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
  })();

  return (
    <section className="mt-10">
      {heading}
      <div className="mt-4" style={cardStyle}>
        <div className="flex items-center justify-between">
          <div>
            <p style={{ fontSize: 14, color: "#1A1108", fontWeight: 500 }}>
              {crime.totalCrimes} recorded crime{crime.totalCrimes === 1 ? "" : "s"}
            </p>
            <p style={{ fontSize: 11, color: "#888780", marginTop: 2 }}>Within ~1 mile · {monthLabel}</p>
          </div>
          <span style={{ ...badgeStyle(crime.riskLevel), borderRadius: 999, padding: "4px 12px", fontSize: 12, fontWeight: 500 }}>
            {crime.riskLevel}
          </span>
        </div>

        {top.length > 0 && (
          <ul className="mt-4 space-y-2.5">
            {top.map((c) => (
              <li key={c.category}>
                <div className="flex items-center justify-between" style={{ fontSize: 13, color: "#1A1108" }}>
                  <span>{c.label}</span>
                  <span style={{ color: "#5F5E5A", fontVariantNumeric: "tabular-nums" }}>{c.count}</span>
                </div>
                <div style={{ marginTop: 4, height: 4, background: "#F1EFE8", borderRadius: 4, overflow: "hidden" }}>
                  <div style={{ width: `${Math.max(4, (c.count / maxCount) * 100)}%`, height: "100%", background: "#D85A30" }} />
                </div>
              </li>
            ))}
          </ul>
        )}

        {crime.commentary && (
          <p className="mt-4" style={{ fontSize: 13, color: "#5F5E5A", lineHeight: 1.6 }}>
            {crime.commentary}
          </p>
        )}

        <p className="mt-3" style={{ fontSize: 11, color: "#888780" }}>
          Based on {monthLabel} data. Crime rates vary — always check local knowledge.
        </p>
        <div className="mt-3 flex items-center justify-between flex-wrap gap-2">
          <span style={{ fontSize: 10, color: "#888780" }}>Source: data.police.uk</span>
          <a
            href="https://www.police.uk/pu/your-area/"
            target="_blank"
            rel="noopener noreferrer"
            style={{ fontSize: 12, color: "#D85A30" }}
            className="hover:underline"
          >
            View full crime map →
          </a>
        </div>
      </div>
    </section>
  );
}

function BroadbandSection({ analysis, isBuyerPass, fetching, onUpgrade, onUpgradePass }: { analysis: AnalysisResult; isBuyerPass: boolean; fetching?: boolean; onUpgrade?: () => void; onUpgradePass?: () => void }) {
  const cardStyle: CSSProperties = {
    background: "#FFFDF9",
    border: "0.5px solid rgba(26,17,8,0.12)",
    borderRadius: 12,
    padding: 20,
  };
  const heading = (
    <h2 className="text-xl font-semibold tracking-tight" style={{ color: "#1A1108" }}>
      Broadband &amp; connectivity
    </h2>
  );

  if (!isBuyerPass) {
    return (
      <section className="mt-10">
        {heading}
        <div className="mt-4 relative overflow-hidden" style={cardStyle}>
          <div style={{ filter: "blur(5px)", userSelect: "none", pointerEvents: "none" }}>
            <div className="flex items-center justify-between">
              <p style={{ fontSize: 14, color: "#1A1108", fontWeight: 500 }}>Estimated download speed</p>
              <span style={{ background: "#EAF3DE", color: "#27500A", borderRadius: 999, padding: "4px 10px", fontSize: 12, fontWeight: 500 }}>Good</span>
            </div>
            <div className="mt-3 space-y-2">
              <div style={{ fontSize: 13, color: "#5F5E5A" }}>Download: Up to 67 Mbps</div>
              <div style={{ fontSize: 13, color: "#5F5E5A" }}>Upload: Up to 18 Mbps</div>
              <div style={{ fontSize: 13, color: "#5F5E5A" }}>Connection: Fibre to cabinet</div>
              <div style={{ fontSize: 13, color: "#5F5E5A" }}>Mobile signal: Good</div>
            </div>
          </div>
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-6">
            <Lock className="h-5 w-5 mb-2" style={{ color: "#D85A30" }} />
            <p style={{ fontSize: 13, color: "#1A1108", maxWidth: 340 }}>
              Unlock with a Single Report — £4.99 to see broadband speeds and connectivity
            </p>
            <div className="mt-3 flex flex-col items-center gap-1">
              {onUpgrade && (
                <button type="button" onClick={onUpgrade} className="hover:underline" style={{ fontSize: 13, color: "#D85A30", background: "transparent", border: 0, cursor: "pointer", fontWeight: 500 }}>
                  Get Single Report — £4.99 →
                </button>
              )}
              {onUpgradePass && (
                <button type="button" onClick={onUpgradePass} className="hover:underline" style={{ fontSize: 13, color: "#D85A30", background: "transparent", border: 0, cursor: "pointer", fontWeight: 500 }}>
                  Or unlock Buyers Pass for all features and unlimited reports for 90 days — £24.99 →
                </button>
              )}
            </div>
          </div>
        </div>
      </section>
    );
  }

  const bb = analysis.broadband;

  if (fetching && !bb) {
    return (
      <section className="mt-10">
        {heading}
        <div className="mt-4" style={cardStyle}>
          <p style={{ fontSize: 13, color: "#5F5E5A" }}>Loading broadband data…</p>
        </div>
      </section>
    );
  }

  if (!bb || bb.unavailable) {
    return (
      <section className="mt-10">
        {heading}
        <div className="mt-4" style={cardStyle}>
          <p style={{ fontSize: 13, color: "#5F5E5A" }}>
            Broadband data is currently unavailable for this postcode. Check{" "}
            <a href="https://checker.ofcom.org.uk" target="_blank" rel="noopener noreferrer" style={{ color: "#D85A30" }} className="hover:underline">
              checker.ofcom.org.uk
            </a>{" "}
            directly.
          </p>
        </div>
      </section>
    );
  }

  const ratingBadge = (rating: string): CSSProperties => {
    const v = rating.toLowerCase();
    if (v === "excellent") return { background: "#27500A", color: "#FFFFFF" };
    if (v === "good") return { background: "#EAF3DE", color: "#27500A" };
    if (v === "average") return { background: "#FAEEDA", color: "#633806" };
    return { background: "#FAECE7", color: "#A32D2D" };
  };

  const connectionPill = (type: string): CSSProperties => {
    if (type === "Full fibre") return { background: "#EAF3DE", color: "#27500A" };
    if (type === "Fibre to cabinet") return { background: "#FAEEDA", color: "#633806" };
    return { background: "#FAECE7", color: "#A32D2D" };
  };

  return (
    <section className="mt-10">
      {heading}
      <div className="mt-4" style={cardStyle}>
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <Wifi className="h-4 w-4" style={{ color: "#D85A30" }} />
            <p style={{ fontSize: 14, color: "#1A1108", fontWeight: 500 }}>Estimated speeds at this postcode</p>
          </div>
          <span style={{ ...ratingBadge(bb.speedRating), borderRadius: 999, padding: "4px 12px", fontSize: 12, fontWeight: 500 }}>
            {bb.speedRating}
          </span>
        </div>

        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div style={{ padding: 12, background: "#F8F5EF", borderRadius: 8 }}>
            <div style={{ fontSize: 11, color: "#888780", textTransform: "uppercase", letterSpacing: 0.4 }}>Download</div>
            <div style={{ fontSize: 16, color: "#1A1108", fontWeight: 600, marginTop: 2 }}>{bb.downloadSpeed}</div>
          </div>
          <div style={{ padding: 12, background: "#F8F5EF", borderRadius: 8 }}>
            <div style={{ fontSize: 11, color: "#888780", textTransform: "uppercase", letterSpacing: 0.4 }}>Upload</div>
            <div style={{ fontSize: 16, color: "#1A1108", fontWeight: 600, marginTop: 2 }}>{bb.uploadSpeed}</div>
          </div>
        </div>

        <div className="mt-4 flex items-center gap-2 flex-wrap">
          <span style={{ ...connectionPill(bb.connectionType), borderRadius: 999, padding: "4px 12px", fontSize: 12, fontWeight: 500 }}>
            {bb.connectionType}
          </span>
        </div>

        <div className="mt-4 space-y-2">
          <div className="flex items-center gap-2" style={{ fontSize: 13, color: "#1A1108" }}>
            {bb.suitableForRemoteWork ? (
              <Check className="h-4 w-4" style={{ color: "#27500A" }} />
            ) : (
              <X className="h-4 w-4" style={{ color: "#A32D2D" }} />
            )}
            <span>Suitable for remote working</span>
          </div>
          <div className="flex items-center gap-2" style={{ fontSize: 13, color: "#1A1108" }}>
            <Signal className="h-4 w-4" style={{ color: "#5F5E5A" }} />
            <span>Mobile signal: <strong style={{ fontWeight: 500 }}>{bb.mobileSignal}</strong></span>
          </div>
        </div>

        {bb.commentary && (
          <p className="mt-4" style={{ fontSize: 13, color: "#5F5E5A", lineHeight: 1.6 }}>
            {bb.commentary}
          </p>
        )}

        <div className="mt-4 flex items-center justify-between flex-wrap gap-2">
          <span style={{ fontSize: 10, color: "#888780" }}>Source: Ofcom Connected Nations</span>
          <a
            href="https://checker.ofcom.org.uk"
            target="_blank"
            rel="noopener noreferrer"
            style={{ fontSize: 12, color: "#D85A30" }}
            className="hover:underline"
          >
            Check full coverage at checker.ofcom.org.uk →
          </a>
        </div>
      </div>
    </section>
  );
}

function FloodRiskSection({
  analysis,
  isBuyerPass,
  fetching,
  onUpgrade,
  onUpgradePass,
  listingUrl,
  userEmail,
  onFloodRiskUpdate,
}: {
  analysis: AnalysisResult;
  isBuyerPass: boolean;
  fetching?: boolean;
  onUpgrade?: () => void;
  onUpgradePass?: () => void;
  listingUrl?: string;
  userEmail?: string | null;
  onFloodRiskUpdate?: (fr: NonNullable<AnalysisResult["floodRisk"]>) => void;
}) {
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
                Unlock with a Single Report — £4.99 to see flood zone, insurance implications and mortgage risks
              </p>
              <div className="mt-3 flex flex-col items-center gap-1">
                {onUpgrade && (
                  <button type="button" onClick={onUpgrade} className="hover:underline" style={{ fontSize: 13, color: "#D85A30", background: "transparent", border: 0, cursor: "pointer", fontWeight: 500 }}>
                    Get Single Report — £4.99 →
                  </button>
                )}
                {onUpgradePass && (
                  <button type="button" onClick={onUpgradePass} className="hover:underline" style={{ fontSize: 13, color: "#D85A30", background: "transparent", border: 0, cursor: "pointer", fontWeight: 500 }}>
                    Or unlock Buyers Pass for all features and unlimited reports for 90 days — £24.99 →
                  </button>
                )}
              </div>
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

    // No data returned by EA for this postcode (or API unavailable) — offer manual zone input
    const hasNoData =
      !fr ||
      fr.unavailable ||
      (!fr.manualZone &&
        !fr.overallRisk &&
        !fr.riversAndSea &&
        !fr.surfaceWater &&
        !fr.groundwater &&
        fr.reservoir == null);
    if (hasNoData) {
      return (
        <section className="mt-10">
          {headingNode}
          <div className="mt-4" style={cardStyle}>
            <FloodRiskNoDataCard
              analysis={analysis}
              listingUrl={listingUrl}
              userEmail={userEmail}
              onFloodRiskUpdate={onFloodRiskUpdate}
            />
          </div>
        </section>
      );
    }

    const badgeStyle = (level: string | null): CSSProperties => {
      const v = (level ?? "").toLowerCase();
      if (v === "high" || v === "very high") return { background: "#FAECE7", color: "#A32D2D" };
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

    // Manual zone assessment view (user entered a flood zone)
    if (fr && fr.manualZone) {
      const zoneLabel = `Zone ${fr.manualZone}`;
      const isHighZone = fr.manualZone === "3a" || fr.manualZone === "3b";
      return (
        <section className="mt-10">
          {headingNode}
          <div className="mt-4" style={cardStyle}>
            <div className="flex items-center justify-between gap-3">
              <p style={{ fontSize: 14, color: "#1A1108", fontWeight: 500 }}>
                Flood {zoneLabel}{" "}
                <span style={{ fontSize: 12, color: "#888780", fontWeight: 400 }}>
                  · manually entered
                </span>
              </p>
              <span
                style={{
                  ...badgeStyle(fr.riskLevel ?? fr.overallRisk ?? null),
                  borderRadius: 999,
                  padding: "4px 12px",
                  fontSize: 12,
                  fontWeight: 600,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                {isHighZone && (
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                    <line x1="12" y1="9" x2="12" y2="13" />
                    <line x1="12" y1="17" x2="12.01" y2="17" />
                  </svg>
                )}
                {fr.riskLevel ?? fr.overallRisk ?? "Unknown"}
              </span>
            </div>

            <div className="mt-4 space-y-3">
              {fr.insuranceImplications && (
                <div>
                  <div style={{ fontSize: 11, fontWeight: 500, color: "#888780", textTransform: "uppercase", letterSpacing: 0.5 }}>
                    Buildings insurance
                  </div>
                  <p className="mt-1" style={{ fontSize: 13, color: "#1A1108", lineHeight: 1.6 }}>
                    {fr.insuranceImplications}
                  </p>
                </div>
              )}
              {fr.mortgageImplications && (
                <div>
                  <div style={{ fontSize: 11, fontWeight: 500, color: "#888780", textTransform: "uppercase", letterSpacing: 0.5 }}>
                    Mortgage availability
                  </div>
                  <p className="mt-1" style={{ fontSize: 13, color: "#1A1108", lineHeight: 1.6 }}>
                    {fr.mortgageImplications}
                  </p>
                </div>
              )}
              {fr.resaleImpact && (
                <div>
                  <div style={{ fontSize: 11, fontWeight: 500, color: "#888780", textTransform: "uppercase", letterSpacing: 0.5 }}>
                    Resale impact
                  </div>
                  <p className="mt-1" style={{ fontSize: 13, color: "#1A1108", lineHeight: 1.6 }}>
                    {fr.resaleImpact}
                  </p>
                </div>
              )}
            </div>

            {fr.commentary && (
              <p style={{ fontSize: 13, color: "#5F5E5A", lineHeight: 1.6, marginTop: 14 }}>
                {fr.commentary}
              </p>
            )}

            <div className="mt-4 flex items-center justify-between">
              <div style={{ fontSize: 10, color: "#888780" }}>
                Source: Manual flood zone entry · AI assessment
              </div>
              <button
                type="button"
                onClick={() => onFloodRiskUpdate?.({ ...fr, manualZone: null })}
                className="hover:underline"
                style={{ fontSize: 12, color: "#D85A30", fontWeight: 500 }}
              >
                Edit flood zone →
              </button>
            </div>
          </div>
        </section>
      );
    }

    const isHigh = (fr?.overallRisk ?? "").toLowerCase() === "high";

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
                ...badgeStyle(fr?.overallRisk ?? null),
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
              {fr?.overallRisk ?? "Unknown"}
            </span>
          </div>

          <div className="mt-4 space-y-2">
            {[
              { label: "Rivers and sea", value: fr?.riversAndSea ?? null },
              { label: "Surface water", value: fr?.surfaceWater ?? null },
              { label: "Reservoir", value: fr?.reservoir == null ? null : fr.reservoir ? "Yes" : "No" },
              { label: "Groundwater", value: fr?.groundwater ?? null },
            ].map((row) => (
              <div key={row.label} className="flex items-center justify-between">
                <span style={{ fontSize: 13, color: "#5F5E5A" }}>{row.label}</span>
                <Pill value={row.value} />
              </div>
            ))}
          </div>

          {fr?.commentary && (
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

const FLOOD_ZONES: { id: "1" | "2" | "3a" | "3b"; label: string; desc: string }[] = [
  { id: "1", label: "Zone 1", desc: "Less than 0.1% annual chance of flooding" },
  { id: "2", label: "Zone 2", desc: "Between 0.1% and 1% annual chance" },
  { id: "3a", label: "Zone 3a", desc: "Greater than 1% annual chance" },
  { id: "3b", label: "Zone 3b", desc: "Regularly floods — highest risk category" },
];

function FloodRiskNoDataCard({
  analysis,
  listingUrl,
  userEmail,
  onFloodRiskUpdate,
}: {
  analysis: AnalysisResult;
  listingUrl?: string;
  userEmail?: string | null;
  onFloodRiskUpdate?: (fr: NonNullable<AnalysisResult["floodRisk"]>) => void;
}) {
  const analyseFn = useServerFn(analyseFloodZone);
  const [pick, setPick] = useState<"1" | "2" | "3a" | "3b" | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleAnalyse = async () => {
    if (!pick) return;
    setSubmitting(true);
    setError(null);
    try {
      const r = await analyseFn({
        data: {
          floodZone: pick,
          propertyType: analysis.property?.type ?? null,
          address: analysis.property?.address ?? null,
          price: analysis.property?.price ?? null,
          email: userEmail ?? null,
          listingUrl: listingUrl ?? null,
        },
      });
      onFloodRiskUpdate?.(r.floodRisk);
    } catch (err) {
      console.error("[FloodRiskNoDataCard] analyse failed:", err);
      setError("Could not assess that flood zone. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <p style={{ fontSize: 14, color: "#1A1108", fontWeight: 600 }}>
        No flood risk data found for this postcode
      </p>
      <p className="mt-2" style={{ fontSize: 13, color: "#5F5E5A", lineHeight: 1.6 }}>
        Properties outside mapped flood zones may not appear in the Environment Agency database —
        this doesn't necessarily mean there is no flood risk. We recommend checking directly at the
        Environment Agency using this property's postcode.
      </p>
      <p className="mt-3" style={{ fontSize: 13, color: "#5F5E5A", lineHeight: 1.6 }}>
        If you know the flood zone for this property — from the Environment Agency checker, your
        surveyor, or local knowledge — enter it below for a full assessment of what it means for
        insurance, mortgages and resale value.
      </p>
      <p className="mt-3">
        <a
          href="https://check-long-term-flood-risk.service.gov.uk"
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: "#185FA5", textDecoration: "underline", fontSize: 13, fontWeight: 500 }}
        >
          Check at Environment Agency →
        </a>
      </p>
      <div
        className="mt-5 grid gap-3"
        style={{ gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))" }}
      >
        {FLOOD_ZONES.map((z) => {
          const selected = pick === z.id;
          return (
            <div key={z.id} className="flex flex-col items-stretch">
              <button
                type="button"
                onClick={() => setPick(z.id)}
                disabled={submitting}
                aria-pressed={selected}
                className="inline-flex items-center justify-center rounded-full transition-all"
                style={{
                  background: selected ? "#D85A30" : "transparent",
                  color: selected ? "#FFFFFF" : "#5F5E5A",
                  border: selected ? "1px solid #D85A30" : "1px solid #5F5E5A",
                  padding: "8px 16px",
                  fontSize: 13,
                  fontWeight: 500,
                }}
              >
                {z.label}
              </button>
              <p
                className="mt-2 text-center"
                style={{ fontSize: 11, color: "#888780", lineHeight: 1.4 }}
              >
                {z.desc}
              </p>
            </div>
          );
        })}
      </div>
      <div className="mt-4">
        <button
          type="button"
          onClick={handleAnalyse}
          disabled={!pick || submitting}
          className="inline-flex items-center justify-center rounded-full transition-opacity hover:opacity-90 disabled:opacity-50"
          style={{
            background: "#D85A30",
            color: "#FFFDF9",
            fontSize: 13,
            fontWeight: 500,
            padding: "10px 20px",
          }}
        >
          {submitting ? (
            <>
              <span
                aria-hidden
                className="mr-2 inline-block h-3 w-3 animate-spin rounded-full"
                style={{ border: "2px solid #FFFDF9", borderTopColor: "transparent" }}
              />
              Assessing flood risk…
            </>
          ) : (
            "Assess flood risk →"
          )}
        </button>
      </div>
      {error && (
        <p className="mt-3" style={{ fontSize: 13, color: "#D43A2F" }}>
          {error}
        </p>
      )}
    </div>
  );
}

/* ============================================================
 * Seller motivation, viewing checklist, renovation costs
 * ============================================================ */

const CARD_STYLE: CSSProperties = {
  background: "#FFFDF9",
  border: "0.5px solid rgba(26,17,8,0.12)",
  borderRadius: 12,
  padding: 20,
};

function SellerMotivationSection({ analysis, unlocked }: { analysis: AnalysisResult; unlocked: boolean }) {
  const sm = analysis.sellerMotivation;
  if (!sm) return null;

  let bg = "#F1EFE8";
  let fg = "#5F5E5A";
  if (sm.score >= 9) { bg = "#FEE2E2"; fg = "#A32D2D"; }
  else if (sm.score >= 7) { bg = "#FAECE7"; fg = "#993C1D"; }
  else if (sm.score >= 5) { bg = "#FAEEDA"; fg = "#7A5A0A"; }

  const hasDetails = sm.signals.length > 0 || !!sm.commentary;

  return (
    <section className="mt-10">
      <h2 className="text-xl font-semibold tracking-tight" style={{ color: "#1A1108" }}>
        Seller motivation
      </h2>
      <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between" style={CARD_STYLE}>
        <div className="min-w-0 flex-1 relative">
          <div style={!unlocked && hasDetails ? { filter: "blur(4px)", userSelect: "none", pointerEvents: "none" } : undefined}>
            {sm.signals.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {sm.signals.map((s, i) => (
                  <span
                    key={i}
                    style={{
                      background: "#F1EFE8",
                      color: "#5F5E5A",
                      fontSize: 11,
                      borderRadius: 100,
                      padding: "3px 9px",
                    }}
                  >
                    {s}
                  </span>
                ))}
              </div>
            )}
            <p className="mt-3" style={{ fontSize: 13, color: "#5F5E5A", lineHeight: 1.6 }}>
              {sm.commentary}
            </p>
          </div>
          {!unlocked && hasDetails && (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-4">
              <Lock className="h-5 w-5 mb-2" style={{ color: "#D85A30" }} />
              <p style={{ fontSize: 13, color: "#1A1108", maxWidth: 320 }}>
                Unlock seller motivation details with Single Report or Buyer Pass
              </p>
            </div>
          )}
        </div>
        <div className="flex flex-row items-center gap-3 sm:flex-col sm:items-end sm:gap-1">
          <div
            className="flex items-center justify-center"
            style={{
              width: 64,
              height: 64,
              borderRadius: "50%",
              background: bg,
              color: fg,
              fontSize: 18,
              fontWeight: 600,
            }}
          >
            {sm.score}/10
          </div>
          <div style={{ fontSize: 12, fontWeight: 500, color: "#1A1108" }}>{sm.label}</div>
        </div>
      </div>
    </section>
  );
}

const CHECKLIST_CATEGORIES = ["Structure", "Legal", "Running costs", "Negotiation", "Practical"] as const;

function ChecklistItem({ item, why }: { item: string; why: string }) {
  return (
    <li className="flex gap-2.5">
      <span
        aria-hidden
        className="mt-0.5 shrink-0"
        style={{
          width: 14,
          height: 14,
          borderRadius: 3,
          border: "1px solid rgba(26,17,8,0.25)",
          background: "#FFFDF9",
        }}
      />
      <div className="min-w-0">
        <div style={{ fontSize: 13, color: "#1A1108", lineHeight: 1.5 }}>{item}</div>
        <div className="mt-0.5" style={{ fontSize: 12, color: "#888780", lineHeight: 1.5 }}>
          {why}
        </div>
      </div>
    </li>
  );
}

function ViewingChecklistSection({ analysis, unlocked }: { analysis: AnalysisResult; unlocked: boolean }) {
  const vc = analysis.viewingChecklist;
  // Debug: temporary red border so we can verify the section's actual layout position.
  // If this border ever appears below the paywall on screen, the issue is real CSS reordering.
  // If you don't see this border at all, the section is returning null (no checklist data).
  const debugBorder = import.meta.env.DEV ? { outline: "3px solid red", outlineOffset: 4 } : {};
  if (!vc || vc.items.length === 0) {
    // Render a visible placeholder instead of null so the section is never silently missing.
    // This guarantees the checklist always sits ABOVE the paywall in the DOM, matching JSX order.
    return (
      <section className="mt-10" style={debugBorder} data-section="viewing-checklist-empty">
        <h2 className="text-xl font-semibold tracking-tight" style={{ color: "#1A1108" }}>
          Viewing checklist
        </h2>
        <p className="mt-1 text-sm" style={{ color: "#5F5E5A" }}>
          Specific to this property — take this to your viewing
        </p>
        <div className="mt-4" style={CARD_STYLE}>
          <p className="text-sm" style={{ color: "#5F5E5A" }}>
            Your viewing checklist is being prepared. Refresh in a moment, or unlock the full report below to see every item.
          </p>
        </div>
      </section>
    );
  }

  const renderCategoryGroups = (items: typeof vc.items) => (
    <div className="flex flex-col gap-5">
      {CHECKLIST_CATEGORIES.map((cat) => {
        const catItems = items.filter((it) => it.category === cat);
        if (catItems.length === 0) return null;
        return (
          <div key={cat}>
            <div
              style={{
                fontSize: 11,
                fontWeight: 500,
                color: "#888780",
                textTransform: "uppercase",
                letterSpacing: 0.5,
              }}
            >
              {cat}
            </div>
            <ul className="mt-2 space-y-3">
              {catItems.map((it, i) => (
                <ChecklistItem key={i} item={it.item} why={it.why} />
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );

  return (
    <section className="mt-10" style={debugBorder} data-section="viewing-checklist">
      <h2 className="text-xl font-semibold tracking-tight" style={{ color: "#1A1108" }}>
        Viewing checklist
      </h2>
      <p className="mt-1 text-sm" style={{ color: "#5F5E5A" }}>
        Specific to this property — take this to your viewing
      </p>
      <div className="mt-4" style={CARD_STYLE}>
        {unlocked ? (
          renderCategoryGroups(vc.items)
        ) : (
          <>
            <ul className="space-y-3">
              {vc.items.slice(0, 2).map((it, i) => (
                <ChecklistItem key={i} item={it.item} why={it.why} />
              ))}
            </ul>
            {vc.items.length > 2 && (
              <div className="relative mt-5 overflow-hidden">
                <div style={{ filter: "blur(4px)", userSelect: "none", pointerEvents: "none" }}>
                  {renderCategoryGroups(vc.items.slice(2, 6))}
                </div>
                <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-6">
                  <Lock className="h-5 w-5 mb-2" style={{ color: "#D85A30" }} />
                  <p style={{ fontSize: 13, color: "#1A1108", maxWidth: 320 }}>
                    Unlock full viewing checklist with Single Report or Buyer Pass
                  </p>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}

function RenovationCostsSection({ analysis, unlocked }: { analysis: AnalysisResult; unlocked: boolean }) {
  if (!unlocked) {
    return (
      <section className="mt-10">
        <h2 className="text-xl font-semibold tracking-tight" style={{ color: "#1A1108" }}>
          Renovation estimate
        </h2>
        <div className="mt-4 relative overflow-hidden" style={CARD_STYLE}>
          <div style={{ filter: "blur(5px)", userSelect: "none", pointerEvents: "none" }}>
            <div className="flex items-center justify-between">
              <span style={{ fontSize: 13, color: "#1A1108", fontWeight: 500 }}>Replace boiler</span>
              <span style={{ fontSize: 13, color: "#1A1108" }}>£3,000 – £4,500</span>
            </div>
            <div className="mt-2 flex items-center justify-between">
              <span style={{ fontSize: 13, color: "#1A1108", fontWeight: 500 }}>Refurb kitchen</span>
              <span style={{ fontSize: 13, color: "#1A1108" }}>£12,000 – £20,000</span>
            </div>
            <div className="mt-3" style={{ fontSize: 13, color: "#5F5E5A" }}>
              Total estimated renovation: £15,000 – £24,500
            </div>
          </div>
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-6">
            <Lock className="h-5 w-5 mb-2" style={{ color: "#D85A30" }} />
            <p style={{ fontSize: 13, color: "#1A1108", maxWidth: 320 }}>
              Unlock to see the full renovation cost estimate for this property
            </p>
          </div>
        </div>
      </section>
    );
  }

  const rc = analysis.renovationCosts;
  if (!rc || rc.items.length === 0) return null;

  const priorityStyle = (p: string): CSSProperties => {
    const n = (p || "").toLowerCase();
    if (n === "high priority" || n === "essential" || n === "high") return { background: "#FEE2E2", color: "#A32D2D" };
    if (n === "medium priority" || n === "recommended" || n === "medium") return { background: "#FAEEDA", color: "#7A5A0A" };
    return { background: "#F1EFE8", color: "#5F5E5A" };
  };
  const displayPriority = (p: string): string => {
    const n = (p || "").toLowerCase();
    if (n === "essential") return "High priority";
    if (n === "recommended") return "Medium priority";
    if (n === "optional") return "Low priority";
    return p;
  };

  return (
    <section className="mt-10">
      <h2 className="text-xl font-semibold tracking-tight" style={{ color: "#1A1108" }}>
        Renovation estimate
      </h2>
      <p className="mt-1 text-sm" style={{ color: "#5F5E5A" }}>
        Based on issues identified in this listing
      </p>
      <div className="mt-4" style={CARD_STYLE}>
        <ul className="space-y-4">
          {rc.items.map((it, i) => (
            <li key={i}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span style={{ fontSize: 13, color: "#1A1108", fontWeight: 500 }}>{it.issue}</span>
                    <span
                      style={{
                        ...priorityStyle(it.priority),
                        fontSize: 11,
                        fontWeight: 500,
                        borderRadius: 100,
                        padding: "2px 8px",
                      }}
                    >
                      {displayPriority(it.priority)}
                    </span>
                  </div>
                  {it.notes && (
                    <div className="mt-1" style={{ fontSize: 12, color: "#888780", lineHeight: 1.5 }}>
                      {it.notes}
                    </div>
                  )}
                </div>
                <div className="shrink-0 text-right" style={{ fontSize: 13, color: "#1A1108" }}>
                  {it.estimatedCost}
                </div>
              </div>
            </li>
          ))}
        </ul>
        <div
          className="mt-5 pt-4 flex items-center justify-between"
          style={{ borderTop: "0.5px solid rgba(26,17,8,0.12)" }}
        >
          <span style={{ fontSize: 13, fontWeight: 500, color: "#1A1108" }}>Total estimated renovation</span>
          <span style={{ fontSize: 13, fontWeight: 500, color: "#1A1108" }}>
            {formatGBP(rc.totalEstimatedMin)} – {formatGBP(rc.totalEstimatedMax)}
          </span>
        </div>
        {rc.commentary && (
          <p className="mt-3" style={{ fontSize: 13, color: "#5F5E5A", lineHeight: 1.6 }}>
            {rc.commentary}
          </p>
        )}
        <p className="mt-3" style={{ fontSize: 11, color: "#888780" }}>
          Estimates based on typical UK contractor rates 2026. Get quotes before proceeding.
        </p>
      </div>
    </section>
  );
}

function AIChatLockedTeaser({ onUpgrade }: { onUpgrade?: () => void }) {
  return (
    <section className="mt-10">
      <h2 className="text-xl font-semibold tracking-tight" style={{ color: "#1A1108" }}>
        AI chat
      </h2>
      <div
        className="mt-4 relative overflow-hidden"
        style={{
          background: "#FFFDF9",
          border: "0.5px solid rgba(26,17,8,0.12)",
          borderRadius: 12,
          padding: 20,
          minHeight: 160,
        }}
      >
        <div style={{ filter: "blur(5px)", userSelect: "none", pointerEvents: "none" }}>
          <p style={{ fontSize: 13, color: "#5F5E5A" }}>You: Is this fair value for the area?</p>
          <p className="mt-2" style={{ fontSize: 13, color: "#1A1108" }}>
            Roovr: Based on comparable sales in SW18 over the last 12 months…
          </p>
          <p className="mt-3" style={{ fontSize: 13, color: "#5F5E5A" }}>You: What should I ask at the viewing?</p>
        </div>
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-6" style={{ background: "rgba(255,253,249,0.85)" }}>
          <Lock className="h-5 w-5 mb-2" style={{ color: "#D85A30" }} />
          <p style={{ fontSize: 13, color: "#1A1108", maxWidth: 320 }}>
            Unlock with Buyer Pass — £24.99 to ask anything about this property
          </p>
          {onUpgrade && (
            <button
              type="button"
              onClick={onUpgrade}
              className="mt-3 hover:underline"
              style={{ fontSize: 13, color: "#D85A30", background: "transparent", border: 0, cursor: "pointer", fontWeight: 500 }}
            >
              Unlock with Buyer Pass — £24.99 →
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

function InlineBuyerPassUpgrade({ listingUrl }: { listingUrl?: string }) {
  const checkoutFn = useServerFn(createCheckoutSession);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const handleClick = async () => {
    setErr(null);
    setLoading(true);
    try {
      const r = await checkoutFn({
        data: {
          priceId: "price_1TXLgzCfTT0mXB2cJMfAE4DW",
          listingUrl: listingUrl ?? "",
          tier: "pass",
          source: "single_upgrade_discount",
        },
      });
      if (r?.url) window.location.href = r.url;
    } catch (e) {
      setErr((e as Error).message ?? "Couldn't start checkout. Try again.");
      setLoading(false);
    }
  };

  return (
    <section
      className="mt-10"
      style={{
        background: "#FAECE7",
        borderRadius: 12,
        padding: "32px 24px",
        textAlign: "center",
      }}
    >
      <h3
        style={{
          fontSize: 22,
          color: "#1A1108",
          fontWeight: 500,
          margin: 0,
          letterSpacing: "-0.01em",
        }}
      >
        Upgrade to Buyer Pass — we'll deduct what you've already paid
      </h3>
      <p
        style={{
          fontSize: 14,
          color: "#5F5E5A",
          margin: "10px auto 0",
          lineHeight: 1.55,
          maxWidth: 560,
        }}
      >
        You've already spent £4.99 on this report. Upgrade to Buyer Pass today for just £20 more and get unlimited analyses for 90 days, AI chat on every property, and property comparison.
      </p>
      <button
        type="button"
        onClick={handleClick}
        disabled={loading}
        style={{
          display: "inline-block",
          marginTop: 20,
          background: "#D85A30",
          color: "#FFFDF9",
          borderRadius: 100,
          padding: "14px 28px",
          fontSize: 15,
          fontWeight: 500,
          border: 0,
          cursor: loading ? "default" : "pointer",
          opacity: loading ? 0.7 : 1,
        }}
      >
        {loading ? "Redirecting to checkout…" : "Upgrade for £20 today →"}
      </button>
      <p style={{ fontSize: 12, color: "#888780", margin: "10px 0 0" }}>
        One-off payment · 90 days access
      </p>
      {err && (
        <p style={{ fontSize: 12, color: "#A32D2D", margin: "10px 0 0" }}>{err}</p>
      )}
    </section>
  );
}

// ---------- Sold price history (PropertyData / Land Registry) ----------
function PriceHistorySection({
  analysis,
  unlocked,
  onUpgrade,
}: {
  analysis: AnalysisResult;
  unlocked: boolean;
  onUpgrade?: () => void;
}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw = (analysis.propertyData?.soldPrices as any) ?? null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const list: any[] = Array.isArray(raw) ? raw : Array.isArray(raw?.data) ? raw.data : Array.isArray(raw?.transactions) ? raw.transactions : [];
  if (!list.length) return null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const norm = list.map((s: any) => ({
    date: String(s?.date ?? s?.sold_date ?? s?.transaction_date ?? "").slice(0, 10),
    price: Number(s?.price ?? s?.sold_price ?? s?.amount ?? 0),
    type: String(s?.property_type ?? s?.type ?? "—"),
    address: String(s?.address ?? s?.paon ?? "").trim(),
  })).filter((r) => r.price > 0);

  const visible = unlocked ? norm.slice(0, 10) : norm.slice(0, 3);

  const card: CSSProperties = { background: "#FFFDF9", border: "0.5px solid rgba(26,17,8,0.12)", borderRadius: 12, padding: 20 };

  return (
    <section className="mt-10">
      <h2 className="text-xl font-semibold tracking-tight" style={{ color: "#1A1108" }}>
        Sold price history
      </h2>
      <div className="mt-4 relative overflow-hidden" style={card}>
        <div className="overflow-x-auto">
          <table style={{ width: "100%", fontSize: 13, color: "#1A1108", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left", color: "#888780", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                <th style={{ padding: "8px 8px 8px 0" }}>Date</th>
                <th style={{ padding: "8px" }}>Price</th>
                <th style={{ padding: "8px" }}>Type</th>
                <th style={{ padding: "8px 0 8px 8px" }}>Address</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r, i) => (
                <tr key={i} style={{ borderTop: "0.5px solid rgba(26,17,8,0.08)" }}>
                  <td style={{ padding: "10px 8px 10px 0" }}>{r.date || "—"}</td>
                  <td style={{ padding: "10px 8px", fontWeight: 500 }}>{formatGBP(r.price)}</td>
                  <td style={{ padding: "10px 8px", color: "#5F5E5A" }}>{r.type}</td>
                  <td style={{ padding: "10px 0 10px 8px", color: "#5F5E5A" }}>{r.address || "—"}</td>
                </tr>
              ))}
              {!unlocked && norm.length > 3 && (
                <tr>
                  <td colSpan={4} style={{ padding: 0 }}>
                    <div style={{ position: "relative", height: 120 }}>
                      <div style={{ position: "absolute", inset: 0, filter: "blur(5px)", userSelect: "none", pointerEvents: "none", padding: "10px 0" }}>
                        <div style={{ height: 18, background: "rgba(26,17,8,0.06)", borderRadius: 4, marginBottom: 10 }} />
                        <div style={{ height: 18, background: "rgba(26,17,8,0.06)", borderRadius: 4, marginBottom: 10 }} />
                        <div style={{ height: 18, background: "rgba(26,17,8,0.06)", borderRadius: 4 }} />
                      </div>
                      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", padding: 16 }}>
                        <Lock className="h-5 w-5 mb-2" style={{ color: "#D85A30" }} />
                        <p style={{ fontSize: 13, color: "#1A1108", margin: 0 }}>
                          Unlock with a Single Report — £4.99 to see the full sold price history
                        </p>
                        {onUpgrade && (
                          <button type="button" onClick={onUpgrade} className="mt-3 hover:underline" style={{ fontSize: 13, color: "#D85A30", background: "transparent", border: 0, cursor: "pointer", fontWeight: 500 }}>
                            Get Single Report — £4.99 →
                          </button>
                        )}
                      </div>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p style={{ marginTop: 12, fontSize: 11, color: "#888780" }}>
          Source: HM Land Registry via PropertyData. Verify at landregistry.gov.uk.
        </p>
      </div>
    </section>
  );
}

// ---------- Capital growth (PropertyData) ----------
function CapitalGrowthSection({
  analysis,
  tier,
  onUpgradeSingle,
  onUpgradePass,
}: {
  analysis: AnalysisResult;
  tier: "free" | "single" | "pass";
  onUpgradeSingle?: () => void;
  onUpgradePass?: () => void;
}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw = (analysis.propertyData?.growth as any) ?? null;
  if (!raw) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any = raw?.data ?? raw;
  const num = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" ? parseFloat(v) : NaN);

  const g1 = num(data?.["1yr"] ?? data?.year_1 ?? data?.oneYear);
  const g3 = num(data?.["3yr"] ?? data?.year_3 ?? data?.threeYear);
  const g5 = num(data?.["5yr"] ?? data?.year_5 ?? data?.fiveYear);
  const headlineNum = !isNaN(g5) ? g5 : !isNaN(g3) ? g3 : !isNaN(g1) ? g1 : NaN;
  const headlineWindow = !isNaN(g5) ? "5 years" : !isNaN(g3) ? "3 years" : "1 year";
  if (isNaN(headlineNum)) return null;

  const fmt = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
  const card: CSSProperties = { background: "#FFFDF9", border: "0.5px solid rgba(26,17,8,0.12)", borderRadius: 12, padding: 20 };

  return (
    <section className="mt-10">
      <h2 className="text-xl font-semibold tracking-tight" style={{ color: "#1A1108" }}>
        Capital growth
      </h2>
      <div className="mt-4" style={card}>
        <div style={{ fontSize: 28, fontWeight: 500, color: "#1A1108", lineHeight: 1.1 }}>
          {fmt(headlineNum)} <span style={{ fontSize: 14, color: "#5F5E5A", fontWeight: 400 }}>over {headlineWindow}</span>
        </div>
        {tier === "pass" ? (
          <div className="mt-4 grid grid-cols-3 gap-3">
            {[
              { label: "1 year", v: g1 },
              { label: "3 years", v: g3 },
              { label: "5 years", v: g5 },
            ].map((row) => (
              <div key={row.label} style={{ background: "#FAF8F4", borderRadius: 8, padding: 12 }}>
                <div style={{ fontSize: 11, color: "#888780", textTransform: "uppercase", letterSpacing: "0.06em" }}>{row.label}</div>
                <div style={{ fontSize: 18, fontWeight: 500, color: "#1A1108", marginTop: 4 }}>
                  {isNaN(row.v) ? "—" : fmt(row.v)}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-4 relative overflow-hidden" style={{ background: "#FAF8F4", borderRadius: 8, padding: 16 }}>
            <div style={{ filter: "blur(4px)", userSelect: "none", pointerEvents: "none" }}>
              <div className="grid grid-cols-3 gap-3">
                <div style={{ fontSize: 18, fontWeight: 500 }}>+3.2%</div>
                <div style={{ fontSize: 18, fontWeight: 500 }}>+8.5%</div>
                <div style={{ fontSize: 18, fontWeight: 500 }}>+12.3%</div>
              </div>
            </div>
            <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-4">
              <p style={{ fontSize: 13, color: "#1A1108", margin: 0 }}>
                {tier === "single"
                  ? "Upgrade to Buyer Pass for the full 1yr / 3yr / 5yr breakdown"
                  : "Buyer Pass unlocks the full 1yr / 3yr / 5yr breakdown"}
              </p>
              {tier === "single" && onUpgradePass && (
                <button type="button" onClick={onUpgradePass} className="mt-2 hover:underline" style={{ fontSize: 13, color: "#D85A30", background: "transparent", border: 0, cursor: "pointer", fontWeight: 500 }}>
                  Upgrade to Buyer Pass — £24.99 →
                </button>
              )}
              {tier === "free" && onUpgradeSingle && (
                <button type="button" onClick={onUpgradeSingle} className="mt-2 hover:underline" style={{ fontSize: 13, color: "#D85A30", background: "transparent", border: 0, cursor: "pointer", fontWeight: 500 }}>
                  Get Single Report — £4.99 →
                </button>
              )}
            </div>
          </div>
        )}
        <p style={{ marginTop: 12, fontSize: 11, color: "#888780" }}>
          Source: PropertyData area capital growth. Past performance is not a guarantee of future returns.
        </p>
      </div>
    </section>
  );
}
