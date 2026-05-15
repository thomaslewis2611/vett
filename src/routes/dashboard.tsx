import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { ArrowRight, LogOut, AlertTriangle, Pin } from "lucide-react";
import { SiteHeader, SiteFooter } from "@/components/site-chrome";
import { supabase } from "@/integrations/supabase/client";
import { formatGBP } from "@/lib/mock-analysis";
import { createCheckoutSession } from "@/lib/checkout.functions";

const PRICE_PASS = "price_1TWtPLCfTT0mXB2cU829oJlb";

export const Route = createFileRoute("/dashboard")({
  head: () => ({ meta: [{ title: "My Reports — Roovr" }] }),
  component: DashboardPage,
});

type SavedRow = {
  id: string;
  listing_url: string | null;
  analysis_json: any;
  created_at: string;
  pinned: boolean;
};

type PassStatus = "active" | "expiring" | "expired";

// Derive the overall Roovr score from sub-scores. Mirrors the server-side
// weighting so dashboard matches the report page even for older saved rows
// where the stored `score` field is stale (Claude often returned 6.8).
const SCORE_WEIGHTS: Record<string, number> = {
  valueForMoney: 0.25,
  locationQuality: 0.20,
  riskLevel: 0.20,
  resalePotential: 0.15,
  listingTransparency: 0.10,
  marketTiming: 0.10,
};
function computeOverallScore(a: any): number | null {
  const sub = a?.subScores;
  if (sub && typeof sub === "object") {
    let weightedSum = 0;
    let totalWeight = 0;
    for (const [k, w] of Object.entries(SCORE_WEIGHTS)) {
      const v = Number(sub[k]);
      if (isFinite(v) && v > 0) { weightedSum += v * w; totalWeight += w; }
    }
    if (totalWeight > 0) return Math.round((weightedSum / totalWeight) * 10) / 10;
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
    (async () => {
      const { data } = await supabase.auth.getUser();
      if (cancelled) return;
      const userEmail = data.user?.email ?? null;
      if (!userEmail) {
        navigate({ to: "/" });
        return;
      }
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
      const expiresRaw =
        (bp as { expires_at: string | null }).expires_at ??
        (bp as { activated_at: string }).activated_at;
      const exp = expiresRaw ? new Date(expiresRaw) : null;
      setExpiresAt(exp);
      if (exp) {
        const msLeft = exp.getTime() - Date.now();
        if (msLeft <= 0) setPassStatus("expired");
        else if (msLeft <= 14 * 24 * 60 * 60 * 1000) setPassStatus("expiring");
        else setPassStatus("active");
      }
      setEmail(userEmail);
      const { data: saved } = await supabase
        .from("saved_analyses")
        .select("id, listing_url, analysis_json, created_at, pinned")
        .order("created_at", { ascending: false })
        .limit(50);
      // Deduplicate by listing_url, keeping the most recent entry per URL.
      const seen = new Set<string>();
      const deduped: SavedRow[] = [];
      for (const r of (saved as SavedRow[]) ?? []) {
        const key = r.listing_url ?? `__no_url__${r.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        deduped.push(r);
        if (deduped.length >= 10) break;
      }
      // Sort: pinned first (by date desc), then unpinned (by date desc).
      deduped.sort((a, b) => {
        if (!!b.pinned !== !!a.pinned) return b.pinned ? 1 : -1;
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      });
      setRows(deduped);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
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
    const next = !current;
    setRows((prev) => {
      const updated = prev.map((r) => (r.id === id ? { ...r, pinned: next } : r));
      updated.sort((a, b) => {
        if (!!b.pinned !== !!a.pinned) return b.pinned ? 1 : -1;
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      });
      return updated;
    });
    const { error } = await supabase
      .from("saved_analyses")
      .update({ pinned: next })
      .eq("id", id);
    if (error) {
      // Revert on failure
      setRows((prev) => {
        const reverted = prev.map((r) => (r.id === id ? { ...r, pinned: current } : r));
        reverted.sort((a, b) => {
          if (!!b.pinned !== !!a.pinned) return b.pinned ? 1 : -1;
          return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
        });
        return reverted;
      });
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen flex-col bg-background">
        <SiteHeader />
        <main className="mx-auto max-w-3xl px-6 py-24 text-center" style={{ color: "#5F5E5A" }}>
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
    <div className="flex min-h-screen flex-col bg-background" style={{ width: "100%", maxWidth: "100%", overflowX: "hidden", boxSizing: "border-box" }}>
      <SiteHeader />
      <main
        className="mx-auto w-full max-w-4xl flex-1 px-4 py-8 sm:px-6 sm:py-12"
        style={{ boxSizing: "border-box", maxWidth: "100%", overflowX: "hidden" }}
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4" style={{ maxWidth: "100%", boxSizing: "border-box" }}>
          <div className="min-w-0" style={{ maxWidth: "100%" }}>
            <h1 className="text-3xl font-semibold tracking-tight">Welcome back</h1>
            <p className="mt-1 truncate text-sm" style={{ color: "#5F5E5A" }}>{email}</p>
            {passStatus === "active" && expiresAt && (
              <p className="mt-1" style={{ fontSize: 11, color: "#888780" }}>
                Buyer Pass active · Expires {expiryDateShort}
              </p>
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
              background: "#FEF3C7",
              border: "1px solid #F59E0B",
              borderRadius: 12,
              boxSizing: "border-box",
            }}
          >
            <div className="flex items-start gap-2" style={{ color: "#92400E", fontSize: 14 }}>
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
              className="inline-flex w-full items-center justify-center sm:w-auto"
              style={{
                background: "#D85A30",
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
              background: "#FEE2E2",
              border: "1px solid #DC2626",
              borderRadius: 12,
              boxSizing: "border-box",
            }}
          >
            <div className="flex items-start gap-2" style={{ color: "#991B1B", fontSize: 14 }}>
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>Your Buyer Pass expired on {expiryDateLong}.</span>
            </div>
            <button
              type="button"
              onClick={onRenew}
              disabled={renewing}
              className="inline-flex w-full items-center justify-center sm:w-auto"
              style={{
                background: "#D85A30",
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
              background: "#D85A30",
              color: "#FFFDF9",
              fontSize: 13,
              fontWeight: 500,
              borderRadius: 100,
              padding: "12px 20px",
            }}
          >
            Analyse <ArrowRight className="h-4 w-4" />
          </button>
        </form>

        <section className="mt-12">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <h2 className="text-xl font-semibold tracking-tight">Your recent reports</h2>
            {!expired && rows.length >= 2 && (
              <Link
                to="/compare"
                className="inline-flex items-center"
                style={{
                  border: "1.5px solid #1A1108",
                  borderRadius: 100,
                  padding: "8px 16px",
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
              className="mt-4 p-8 text-center"
              style={{ background: "#F1EFE8", borderRadius: 12, color: "#5F5E5A", fontSize: 14 }}
            >
              You haven't analysed any properties yet. Paste a listing above to get started.
            </div>
          ) : (
            <ul className="mt-4 space-y-3">
              {rows.map((r) => {
                const a = r.analysis_json ?? {};
                const address = a?.property?.address ?? r.listing_url ?? "Untitled";
                const price = a?.property?.price ?? 0;
                const score = computeOverallScore(a);
                return (
                  <li
                    key={r.id}
                    className="group flex w-full flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
                    style={{ background: "#FFFDF9", borderRadius: 12, border: "0.5px solid rgba(26,17,8,0.12)", boxSizing: "border-box" }}
                  >
                    <div className="flex min-w-0 flex-1 items-start gap-3">
                      <button
                        type="button"
                        onClick={() => togglePin(r.id, r.pinned)}
                        aria-label={r.pinned ? "Unpin report" : "Pin report"}
                        title={r.pinned ? "Unpin from top" : "Pin to top"}
                        className={`shrink-0 rounded-full p-1 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 ${r.pinned ? "sm:opacity-100" : ""}`}
                        style={{ color: r.pinned ? "#D85A30" : "#B8B6AE" }}
                      >
                        <Pin
                          className="h-4 w-4"
                          fill={r.pinned ? "#D85A30" : "none"}
                          strokeWidth={2}
                        />
                      </button>
                      <div className="min-w-0 flex-1">
                        <div className="truncate" style={{ fontSize: 15, fontWeight: 500, color: "#1A1108" }}>{address}</div>
                        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs" style={{ color: "#888780" }}>
                          {price > 0 && <span>{formatGBP(price)}</span>}
                          <span>{new Date(r.created_at).toLocaleDateString()}</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center justify-between gap-3 sm:justify-end">
                      {score !== null && (
                        <span
                          style={{
                            background: "#FAECE7",
                            color: "#993C1D",
                            fontSize: 12,
                            fontWeight: 500,
                            borderRadius: 8,
                            padding: "4px 10px",
                          }}
                        >
                          {score.toFixed(1)} / 10
                        </span>
                      )}
                      <Link
                        to="/results"
                        search={{ saved_id: r.id }}
                        style={{ fontSize: 13, color: "#D85A30" }}
                      >
                        View →
                      </Link>
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
