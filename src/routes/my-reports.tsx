import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowRight, LogOut, FileText } from "lucide-react";
import { SiteHeader, SiteFooter } from "@/components/site-chrome";
import { supabase } from "@/integrations/supabase/client";
import { formatGBP } from "@/lib/mock-analysis";

export const Route = createFileRoute("/my-reports")({
  head: () => ({ meta: [{ title: "My Reports — Roovr" }] }),
  component: MyReportsPage,
});

type SavedRow = {
  id: string;
  listing_url: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  analysis_json: any;
  created_at: string;
};

type PendingTokenRow = {
  token: string;
  listing_url: string | null;
  created_at: string;
  expires_at: string;
};

function MyReportsPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState<SavedRow[]>([]);
  const [pending, setPending] = useState<PendingTokenRow[]>([]);
  const [hasPass, setHasPass] = useState(false);

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
      setEmail(userEmail);

      // If they have a Buyer Pass, send them to the dashboard instead
      const { data: bp } = await supabase
        .from("buyer_pass_users")
        .select("email, expires_at")
        .ilike("email", userEmail)
        .maybeSingle();
      if (bp) {
        const exp = (bp as { expires_at: string | null }).expires_at;
        if (!exp || new Date(exp).getTime() > Date.now()) {
          setHasPass(true);
          navigate({ to: "/dashboard" });
          return;
        }
      }

      const { data: savedRows } = await supabase
        .from("saved_analyses")
        .select("id, listing_url, analysis_json, created_at")
        .order("created_at", { ascending: false });
      if (cancelled) return;
      const savedList = (savedRows as SavedRow[]) ?? [];
      setSaved(savedList);

      // Pending: paid single-report tokens that don't yet have a saved analysis
      const { data: tokenRows } = await supabase
        .from("single_report_tokens")
        .select("token, listing_url, created_at, expires_at")
        .ilike("user_email", userEmail)
        .order("created_at", { ascending: false });
      if (cancelled) return;
      const tokens = (tokenRows as PendingTokenRow[]) ?? [];
      const savedUrls = new Set(savedList.map((s) => s.listing_url).filter(Boolean));
      const now = Date.now();
      setPending(
        tokens.filter(
          (t) =>
            t.listing_url &&
            !savedUrls.has(t.listing_url) &&
            new Date(t.expires_at).getTime() > now
        )
      );

      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  const onSignOut = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/" });
  };

  if (loading || hasPass) {
    return (
      <div className="flex min-h-screen flex-col bg-background">
        <SiteHeader />
        <main className="mx-auto max-w-3xl px-6 py-24 text-center" style={{ color: "#5F5E5A" }}>
          Loading your reports…
        </main>
        <SiteFooter />
      </div>
    );
  }

  const isEmpty = saved.length === 0 && pending.length === 0;

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <SiteHeader />
      <main className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6 sm:py-12">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
          <div className="min-w-0">
            <h1 className="text-3xl font-semibold tracking-tight">My reports</h1>
            {email && (
              <p className="mt-1 truncate text-sm" style={{ color: "#5F5E5A" }}>
                {email}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onSignOut}
            className="inline-flex w-fit items-center gap-2"
            style={{ fontSize: 13, color: "#5F5E5A" }}
          >
            <LogOut className="h-4 w-4" /> Sign out
          </button>
        </div>

        <section className="mt-8">
          {isEmpty ? (
            <div
              className="p-8 text-center"
              style={{ background: "#F1EFE8", borderRadius: 12, color: "#5F5E5A", fontSize: 14 }}
            >
              We couldn't find any reports linked to this email. If you've just paid, give it a
              minute and refresh.
            </div>
          ) : (
            <ul className="space-y-3">
              {pending.map((p) => (
                <li
                  key={p.token}
                  className="flex w-full flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
                  style={{
                    background: "#FFFDF9",
                    borderRadius: 12,
                    border: "0.5px solid rgba(26,17,8,0.12)",
                  }}
                >
                  <div className="flex min-w-0 flex-1 items-start gap-3">
                    <div
                      className="inline-flex h-10 w-10 shrink-0 items-center justify-center"
                      style={{ background: "#FAECE7", borderRadius: 10 }}
                    >
                      <FileText className="h-5 w-5" style={{ color: "#993C1D" }} />
                    </div>
                    <div className="min-w-0">
                      <div
                        className="truncate"
                        style={{ fontSize: 15, fontWeight: 500, color: "#1A1108" }}
                      >
                        Your purchased report
                      </div>
                      {p.listing_url && (
                        <div
                          className="mt-1 truncate"
                          style={{ fontSize: 12, color: "#888780" }}
                        >
                          {p.listing_url}
                        </div>
                      )}
                    </div>
                  </div>
                  <Link
                    to="/results"
                    search={{ url: p.listing_url ?? undefined }}
                    className="inline-flex items-center justify-center gap-1"
                    style={{
                      background: "#1A1108",
                      color: "#FFFDF9",
                      fontSize: 13,
                      fontWeight: 500,
                      borderRadius: 100,
                      padding: "10px 18px",
                    }}
                  >
                    Open report <ArrowRight className="h-4 w-4" />
                  </Link>
                </li>
              ))}
              {saved.map((r) => {
                const a = r.analysis_json ?? {};
                const address = a?.property?.address ?? r.listing_url ?? "Untitled";
                const price = a?.property?.price ?? 0;
                const score = typeof a?.score === "number" ? a.score : null;
                return (
                  <li
                    key={r.id}
                    className="flex w-full flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
                    style={{
                      background: "#FFFDF9",
                      borderRadius: 12,
                      border: "0.5px solid rgba(26,17,8,0.12)",
                    }}
                  >
                    <div className="min-w-0 flex-1">
                      <div
                        className="truncate"
                        style={{ fontSize: 15, fontWeight: 500, color: "#1A1108" }}
                      >
                        {address}
                      </div>
                      <div
                        className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs"
                        style={{ color: "#888780" }}
                      >
                        {price > 0 && <span>{formatGBP(price)}</span>}
                        <span>{new Date(r.created_at).toLocaleDateString()}</span>
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

        <section className="mt-12">
          <h2 className="text-lg font-semibold tracking-tight">Want to analyse more properties?</h2>
          <p className="mt-2 text-sm" style={{ color: "#5F5E5A" }}>
            Your purchase covers a single report. To unlock unlimited analyses for 90 days,
            including AI chat, flood risk and nearby schools, upgrade to the Buyer Pass.
          </p>
          <div className="mt-4 flex gap-3">
            <Link
              to="/pricing"
              className="inline-flex items-center gap-1"
              style={{
                background: "#D85A30",
                color: "#FFFDF9",
                fontSize: 13,
                fontWeight: 500,
                borderRadius: 100,
                padding: "10px 18px",
              }}
            >
              Upgrade to Buyer Pass <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              to="/"
              className="inline-flex items-center gap-1"
              style={{
                border: "1.5px solid #1A1108",
                color: "#1A1108",
                fontSize: 13,
                fontWeight: 500,
                borderRadius: 100,
                padding: "8.5px 18px",
              }}
            >
              Try a free preview
            </Link>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
