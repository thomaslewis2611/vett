import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { ArrowRight, LogOut, AlertTriangle, Pin } from "lucide-react";
import { SiteHeader, SiteFooter } from "@/components/site-chrome";
import { supabase } from "@/integrations/supabase/client";
import { formatGBP } from "@/lib/analysis.types";
import { createCheckoutSession } from "@/lib/checkout.functions";
import { computeWeightedScore } from "@/lib/score";

const PRICE_PASS = "price_1TWtPLCfTT0mXB2cU829oJlb";

export const Route = createFileRoute("/dashboard")({
  head: () => ({ meta: [{ title: "My Reports — vett" }] }),
  component: DashboardPage,
});

type SavedRow = {
  id: string;
  listing_url: string | null;
  analysis_json: any;
  created_at: string;
  is_pinned: boolean;
  pinned_at: string | null;
};

function sortRows(rows: SavedRow[]): SavedRow[] {
  return [...rows].sort((a, b) => {
    if (!!b.is_pinned !== !!a.is_pinned) return b.is_pinned ? 1 : -1;
    if (a.is_pinned && b.is_pinned) {
      const ap = a.pinned_at ? new Date(a.pinned_at).getTime() : 0;
      const bp = b.pinned_at ? new Date(b.pinned_at).getTime() : 0;
      return bp - ap;
    }
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });
}

type PassStatus = "active" | "expiring" | "expired";

// Derive the overall vett score from sub-scores. Mirrors the server-side
// weighting so dashboard matches the report page even for older saved rows
// where the stored `score` field is stale (Claude often returned 6.8).
function computeOverallScore(a: any): number | null {
  const sub = a?.subScores;
  if (sub && typeof sub === "object") {
    const v = computeWeightedScore(sub as Record<string, number>);
    if (isFinite(v)) return v;
  }
  return typeof a?.score === "number" ? a.score : null;
}

function formatDate(d: Date): string {
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" });
}

function formatDateShort(d: Date): string {
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function DashboardPage() {
  const navigate = useNavigate();
  const checkoutFn = useServerFn(createCheckoutSession);
  const [email, setEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<SavedRow[]>([]);
  const [url, setUrl] = useState("");
  const [expiresAt, setExpiresAt] = useState<Date | null>(null);
  const [passStatus, setPassStatus] = useState<PassStatus>("active");
  const [renewing, setRenewing] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const loadForUser = async (userEmail: string, authUserId: string | null) => {
      if (cancelled) return;
      console.log("[dashboard] authenticated user", { userId: authUserId, email: userEmail });
      // Confirm Buyer Pass row exists (active OR expired)
      const { data: bp } = await supabase
        .from("buyer_pass_users")
        .select("email, expires_at, activated_at")
        .ilike("email", userEmail)
        .maybeSingle();
      if (!bp) {
        navigate({ to: "/" });
        return;
      }
      const expiresRaw = (bp as { expires_at: string | null }).expires_at;
      const exp = expiresRaw ? new Date(expiresRaw) : null;
      setExpiresAt(exp);
      let nextPassStatus: PassStatus = "active";
      if (exp) {
        const msLeft = exp.getTime() - Date.now();
        if (msLeft <= 0) nextPassStatus = "expired";
        else if (msLeft <= 14 * 24 * 60 * 60 * 1000) nextPassStatus = "expiring";
      }
      setPassStatus(nextPassStatus);
      setEmail(userEmail);
      // Pull every saved analysis for this user (RLS-scoped to the
      // current email). We deliberately do NOT cap by limit here so a Buyer
      // Pass upgrade never appears to "hide" earlier Single Report rows.
      const { data: saved, error: savedError } = await supabase
        .from("saved_analyses")
        .select("id, listing_url, analysis_json, created_at, is_pinned, pinned_at")
        .ilike("user_email", userEmail)
        .order("created_at", { ascending: false });

      // Also pull any Single Report tokens the user has purchased. Match on
      // BOTH user_id (auth account) and user_email (Stripe receipt email),
      // because the email Stripe captures at checkout may differ from the
      // email on the user's account (different casing, OAuth alias, etc.).
      const tokenQueries = await Promise.all([
        supabase
          .from("single_report_tokens")
          .select("id, token, listing_url, analysis_json, created_at, expires_at, user_email, user_id")
          .or(`user_email.ilike.${userEmail},user_email.eq.${userEmail.toLowerCase()}`)
          .order("created_at", { ascending: false }),
        authUserId
          ? supabase
              .from("single_report_tokens")
              .select("id, token, listing_url, analysis_json, created_at, expires_at, user_email, user_id")
              .eq("user_id", authUserId)
              .order("created_at", { ascending: false })
          : Promise.resolve({ data: [], error: null }),
      ]);
      const tokensByEmail = (tokenQueries[0].data as any[]) ?? [];
      const tokensById = (tokenQueries[1].data as any[]) ?? [];
      const tokensError = tokenQueries[0].error || tokenQueries[1].error;

      // Merge + dedupe by token id.
      const tokenMap = new Map<string, any>();
      for (const t of [...tokensByEmail, ...tokensById]) tokenMap.set(t.id, t);
      const tokens = Array.from(tokenMap.values());

      const savedRows = (saved as unknown as SavedRow[]) ?? [];
      const tokenRows = (tokens as unknown as Array<{
        id: string;
        token: string;
        listing_url: string | null;
        analysis_json: any;
        created_at: string;
        expires_at: string;
        user_email: string | null;
        user_id: string | null;
      }>) ?? [];

      console.log("[dashboard] single_report_tokens lookup", {
        authUserId,
        lookupEmail: userEmail,
        tokenCountByEmail: tokensByEmail.length,
        tokenCountByUserId: tokensById.length,
        mergedTokenCount: tokenRows.length,
        error: tokensError?.message ?? null,
        tokens: tokenRows.map((t) => ({
          id: t.id,
          token: t.token,
          storedUserEmail: t.user_email,
          storedUserId: t.user_id,
          userEmailMatchesAuthEmail: (t.user_email ?? "").toLowerCase() === userEmail.toLowerCase(),
          userIdMatchesAuth: t.user_id === authUserId,
          hasListingUrl: Boolean(t.listing_url),
          listingUrl: t.listing_url,
          hasAnalysisJson: Boolean(t.analysis_json),
          createdAt: t.created_at,
          expiresAt: t.expires_at,
        })),
      });

      // Merge: saved_analyses rows are authoritative (they carry pin state
      // and the freshest analysis_json). For any single_report_token whose
      // listing_url is not already represented in saved_analyses, add a
      // synthetic row so the user still sees that purchase in the list.
      const seen = new Set<string>();
      const merged: SavedRow[] = [];
      for (const r of savedRows) {
        const key = r.listing_url ?? `__no_url__${r.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        merged.push(r);
      }
      for (const t of tokenRows) {
        const key = t.listing_url ?? `__no_url__token_${t.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        merged.push({
          id: `token:${t.token}`,
          listing_url: t.listing_url,
          analysis_json: t.analysis_json ?? {},
          created_at: t.created_at,
          is_pinned: false,
          pinned_at: null,
        });
      }
      const sortedRows = sortRows(merged);
      console.log("[dashboard] merged report rows", {
        passStatus: nextPassStatus,
        savedCount: savedRows.length,
        savedError: savedError?.message ?? null,
        tokenCount: tokenRows.length,
        mergedCount: sortedRows.length,
        rows: sortedRows.map((r) => ({
          id: r.id,
          source: r.id.startsWith("token:") ? "single_report_token" : "saved_analyses",
          listingUrl: r.listing_url,
          hasAnalysisJson: Boolean(r.analysis_json && Object.keys(r.analysis_json).length > 0),
          createdAt: r.created_at,
        })),
      });
      setRows(sortedRows);
      setLoading(false);
    };

    // onAuthStateChange fires after the initial session is resolved, including
    // after a magic link hash token exchange completes. Using getUser() here
    // would race with the exchange and redirect prematurely.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (cancelled) return;
      const userEmail = session?.user?.email ?? null;
      const userId = session?.user?.id ?? null;
      if (userEmail) {
        loadForUser(userEmail, userId);
      } else if (event === "INITIAL_SESSION") {
        // Only redirect if there is no pending magic link token in the hash.
        if (typeof window === "undefined" || !window.location.hash.includes("access_token")) {
          navigate({ to: "/" });
        }
      } else if (event === "SIGNED_OUT") {
        navigate({ to: "/" });
      }
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [navigate]);

  const onAnalyse = (e: React.FormEvent) => {
    e.preventDefault();
    if (passStatus === "expired") return;
    const trimmed = url.trim();
    if (!trimmed) return;
    navigate({ to: "/results", search: { url: trimmed } });
  };

  const onSignOut = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/" });
  };

  const onRenew = async () => {
    setRenewing(true);
    try {
      const res = await checkoutFn({
        data: { priceId: PRICE_PASS, listingUrl: "", tier: "pass" },
      });
      window.location.href = res.url;
    } catch {
      setRenewing(false);
    }
  };

  const togglePin = async (id: string, current: boolean) => {
    // Synthetic rows backed by single_report_tokens (no saved_analyses row
    // yet) cannot be pinned — they have no DB row to update.
    if (id.startsWith("token:")) return;
    const next = !current;
    const nextPinnedAt = next ? new Date().toISOString() : null;
    setRows((prev) =>
      sortRows(
        prev.map((r) =>
          r.id === id ? { ...r, is_pinned: next, pinned_at: nextPinnedAt } : r,
        ),
      ),
    );
    const { error } = await supabase
      .from("saved_analyses")
      .update({ is_pinned: next, pinned_at: nextPinnedAt })
      .eq("id", id);
    if (error) {
      setRows((prev) =>
        sortRows(
          prev.map((r) =>
            r.id === id ? { ...r, is_pinned: current, pinned_at: current ? r.pinned_at : null } : r,
          ),
        ),
      );
    }
  };

  const HEADING = "'Playfair Display', Georgia, serif";

  if (loading) {
    return (
      <div className="flex min-h-screen flex-col" style={{ background: "#F1EFE8" }}>
        <SiteHeader />
        <main className="mx-auto max-w-3xl px-6 py-24 text-center flex-1" style={{ fontWeight: 300, color: "#5F5E5A" }}>
          Loading your dashboard…
        </main>
        <SiteFooter />
      </div>
    );
  }

  const expired = passStatus === "expired";
  const expiringSoon = passStatus === "expiring";
  const expiryDateLong = expiresAt ? formatDate(expiresAt) : "";
  const expiryDateShort = expiresAt ? formatDateShort(expiresAt) : "";

  return (
    <div className="flex min-h-screen flex-col" style={{ background: "#F1EFE8", width: "100%", maxWidth: "100%", overflowX: "hidden", boxSizing: "border-box" }}>
      <SiteHeader />
      <main
        className="mx-auto w-full max-w-4xl flex-1 px-4 py-10 sm:px-6 sm:py-14"
        style={{ boxSizing: "border-box", maxWidth: "100%", overflowX: "hidden" }}
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4" style={{ maxWidth: "100%", boxSizing: "border-box" }}>
          <div className="min-w-0" style={{ maxWidth: "100%" }}>
            <h1 style={{ fontFamily: HEADING, fontWeight: 400, fontSize: 38, color: "#1A1108", letterSpacing: "-0.6px", lineHeight: 1.1 }}>
              My Reports
            </h1>
            <p className="mt-2 truncate" style={{ fontSize: 14, fontWeight: 300, color: "#5F5E5A" }}>{email}</p>
            {passStatus === "active" && expiresAt && (
              <span
                className="mt-2 inline-flex items-center"
                style={{
                  background: "#EAF3DE",
                  color: "#2D6A4F",
                  fontSize: 11,
                  fontWeight: 500,
                  borderRadius: 100,
                  padding: "4px 10px",
                  letterSpacing: "0.02em",
                }}
              >
                Buyer Pass active · Expires {expiryDateShort}
              </span>
            )}
            <button
              type="button"
              onClick={onSignOut}
              className="mt-2 inline-flex items-center gap-1.5 sm:hidden"
              style={{ fontSize: 12, color: "#888780" }}
            >
              <LogOut className="h-3.5 w-3.5" /> Sign out
            </button>
          </div>
          <button
            type="button"
            onClick={onSignOut}
            className="hidden w-fit items-center gap-2 sm:inline-flex"
            style={{ fontSize: 13, color: "#5F5E5A" }}
          >
            <LogOut className="h-4 w-4" /> Sign out
          </button>
        </div>

        {expiringSoon && expiresAt && (
          <div
            className="mt-6 flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
            style={{
              background: "#FAEEDA",
              border: "0.5px solid rgba(133,79,11,0.25)",
              borderRadius: 12,
              boxSizing: "border-box",
            }}
          >
            <div className="flex items-start gap-2" style={{ color: "#854F0B", fontSize: 14, fontWeight: 300 }}>
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                Your Buyer Pass expires on {expiryDateLong} — renew now to keep
                access.
              </span>
            </div>
            <button
              type="button"
              onClick={onRenew}
              disabled={renewing}
              className="inline-flex w-full items-center justify-center sm:w-auto transition-opacity hover:opacity-90"
              style={{
                background: "#2D6A4F",
                color: "#FFFDF9",
                fontSize: 13,
                fontWeight: 500,
                borderRadius: 100,
                padding: "10px 18px",
              }}
            >
              {renewing ? "Starting checkout…" : "Renew for £24.99 →"}
            </button>
          </div>
        )}

        {expired && expiresAt && (
          <div
            className="mt-6 flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
            style={{
              background: "#FAECE7",
              border: "0.5px solid rgba(153,60,29,0.25)",
              borderRadius: 12,
              boxSizing: "border-box",
            }}
          >
            <div className="flex items-start gap-2" style={{ color: "#993C1D", fontSize: 14, fontWeight: 300 }}>
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>Your Buyer Pass expired on {expiryDateLong}.</span>
            </div>
            <button
              type="button"
              onClick={onRenew}
              disabled={renewing}
              className="inline-flex w-full items-center justify-center sm:w-auto transition-opacity hover:opacity-90"
              style={{
                background: "#2D6A4F",
                color: "#FFFDF9",
                fontSize: 13,
                fontWeight: 500,
                borderRadius: 100,
                padding: "10px 18px",
              }}
            >
              {renewing ? "Starting checkout…" : "Renew your Buyer Pass — £24.99 for 90 days →"}
            </button>
          </div>
        )}

        <form
          onSubmit={onAnalyse}
          className="mt-8 flex w-full flex-col gap-2 sm:flex-row sm:items-center"
          style={{ boxSizing: "border-box" }}
        >
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            type="url"
            disabled={expired}
            placeholder={
              expired
                ? "Renew your Buyer Pass to analyse new properties"
                : "Paste a Rightmove listing URL"
            }
            className="w-full bg-transparent px-4 py-3 outline-none sm:flex-1"
            style={{
              fontSize: 14,
              color: "#1A1108",
              background: "#F1EFE8",
              borderRadius: 100,
              border: "0.5px solid rgba(26,17,8,0.12)",
              boxSizing: "border-box",
              opacity: expired ? 0.6 : 1,
            }}
          />
          <button
            type="submit"
            disabled={expired}
            className="inline-flex w-full items-center justify-center gap-1 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
            style={{
              background: "#2D6A4F",
              color: "#FFFDF9",
              fontSize: 14,
              fontWeight: 500,
              borderRadius: 100,
              padding: "13px 24px",
            }}
          >
            Analyse <ArrowRight className="h-4 w-4" />
          </button>
        </form>

        <section className="mt-14">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <h2 style={{ fontFamily: HEADING, fontWeight: 400, fontSize: 26, color: "#1A1108", letterSpacing: "-0.3px" }}>
              Your recent reports
            </h2>
            {!expired && rows.length >= 2 && (
              <Link
                to="/compare"
                className="inline-flex items-center"
                style={{
                  border: "0.5px solid #1A1108",
                  borderRadius: 100,
                  padding: "9px 18px",
                  fontSize: 13,
                  fontWeight: 500,
                  color: "#1A1108",
                  background: "transparent",
                }}
              >
                Compare two properties →
              </Link>
            )}
          </div>
          {rows.length === 0 ? (
            <div
              className="mt-5 p-10 text-center"
              style={{ background: "#FFFDF9", border: "0.5px solid rgba(26,17,8,0.1)", borderRadius: 16 }}
            >
              <h3 style={{ fontFamily: HEADING, fontWeight: 400, fontSize: 22, color: "#1A1108", letterSpacing: "-0.3px" }}>
                No reports yet
              </h3>
              <p className="mt-2" style={{ fontSize: 14, fontWeight: 300, color: "#5F5E5A" }}>
                Paste a Rightmove listing above to generate your first analysis.
              </p>
            </div>
          ) : (
            <ul className="mt-5 space-y-3">
              {rows.map((r) => {
                const a = r.analysis_json ?? {};
                const address = a?.property?.address ?? r.listing_url ?? "Untitled";
                const price = a?.property?.price ?? 0;
                const score = computeOverallScore(a);
                return (
                  <li
                    key={r.id}
                    className="group relative flex w-full flex-col gap-2 p-5 pr-12 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:pr-12"
                    style={{ background: "#FFFDF9", borderRadius: 16, border: "0.5px solid rgba(26,17,8,0.1)", boxSizing: "border-box" }}
                  >
                    {!r.id.startsWith("token:") && (
                      <button
                        type="button"
                        onClick={() => togglePin(r.id, r.is_pinned)}
                        aria-label={r.is_pinned ? "Unpin report" : "Pin report"}
                        title={r.is_pinned ? "Unpin from top" : "Pin to top"}
                        className={`absolute right-3 top-3 rounded-full p-1.5 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100 ${r.is_pinned ? "sm:opacity-100" : ""}`}
                        style={{ color: r.is_pinned ? "#2D6A4F" : "#B8B6AE" }}
                      >
                        <Pin
                          className="h-4 w-4"
                          fill={r.is_pinned ? "#2D6A4F" : "none"}
                          strokeWidth={2}
                        />
                      </button>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="truncate" style={{ fontFamily: HEADING, fontSize: 18, fontWeight: 400, color: "#1A1108", letterSpacing: "-0.2px" }}>{address}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1" style={{ fontSize: 12, fontWeight: 300, color: "#888780" }}>
                        {price > 0 && <span>{formatGBP(price)}</span>}
                        <span>{new Date(r.created_at).toLocaleDateString()}</span>
                      </div>
                    </div>
                    <div className="flex items-center justify-between gap-3 sm:justify-end">
                      {score !== null && (
                        <span
                          style={{
                            background: "#F1EFE8",
                            color: "#2D6A4F",
                            fontSize: 12,
                            fontWeight: 500,
                            borderRadius: 100,
                            padding: "5px 12px",
                          }}
                        >
                          {score.toFixed(1)} / 10
                        </span>
                      )}
                      {r.id.startsWith("token:") ? (
                        <Link
                          to="/results"
                          search={{
                            token: r.id.slice("token:".length),
                            url: r.listing_url ?? undefined,
                          }}
                          style={{ fontSize: 13, fontWeight: 500, color: "#2D6A4F" }}
                        >
                          View →
                        </Link>
                      ) : (
                        <Link
                          to="/results"
                          search={{ saved_id: r.id }}
                          style={{ fontSize: 13, fontWeight: 500, color: "#2D6A4F" }}
                        >
                          View →
                        </Link>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
