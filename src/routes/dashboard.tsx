import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowRight, LogOut } from "lucide-react";
import { SiteHeader, SiteFooter } from "@/components/site-chrome";
import { supabase } from "@/integrations/supabase/client";
import { formatGBP } from "@/lib/mock-analysis";

export const Route = createFileRoute("/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard — Roovr" }] }),
  component: DashboardPage,
});

type SavedRow = {
  id: string;
  listing_url: string | null;
  analysis_json: any;
  created_at: string;
};

function DashboardPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<SavedRow[]>([]);
  const [url, setUrl] = useState("");

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
      // Confirm Buyer Pass
      const { data: bp } = await supabase
        .from("buyer_pass_users")
        .select("email")
        .ilike("email", userEmail)
        .maybeSingle();
      if (!bp) {
        navigate({ to: "/" });
        return;
      }
      setEmail(userEmail);
      const { data: saved } = await supabase
        .from("saved_analyses")
        .select("id, listing_url, analysis_json, created_at")
        .order("created_at", { ascending: false })
        .limit(10);
      setRows((saved as SavedRow[]) ?? []);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  const onAnalyse = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = url.trim();
    if (!trimmed) return;
    navigate({ to: "/results", search: { url: trimmed } });
  };

  const onSignOut = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/" });
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background">
        <SiteHeader />
        <main className="mx-auto max-w-3xl px-6 py-24 text-center" style={{ color: "#5F5E5A" }}>
          Loading your dashboard…
        </main>
        <SiteFooter />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6 sm:py-12" style={{ boxSizing: "border-box" }}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
          <div className="min-w-0">
            <h1 className="text-3xl font-semibold tracking-tight">Welcome back</h1>
            <p className="mt-1 truncate text-sm" style={{ color: "#5F5E5A" }}>{email}</p>
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

        <form
          onSubmit={onAnalyse}
          className="mt-8 flex w-full flex-col gap-2 sm:flex-row sm:items-center"
          style={{ boxSizing: "border-box" }}
        >
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            type="url"
            placeholder="Paste a Rightmove or Zoopla listing URL"
            className="w-full bg-transparent px-4 py-3 outline-none sm:flex-1"
            style={{
              fontSize: 14,
              color: "#1A1108",
              background: "#F1EFE8",
              borderRadius: 100,
              border: "0.5px solid rgba(26,17,8,0.12)",
              boxSizing: "border-box",
            }}
          />
          <button
            type="submit"
            className="inline-flex w-full items-center justify-center gap-1 sm:w-auto"
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
          <h2 className="text-xl font-semibold tracking-tight">Your recent analyses</h2>
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
                const score = typeof a?.score === "number" ? a.score : null;
                return (
                  <li
                    key={r.id}
                    className="flex w-full flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
                    style={{ background: "#FFFDF9", borderRadius: 12, border: "0.5px solid rgba(26,17,8,0.12)", boxSizing: "border-box" }}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate" style={{ fontSize: 15, fontWeight: 500, color: "#1A1108" }}>{address}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs" style={{ color: "#888780" }}>
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
                      {r.listing_url && (
                        <Link
                          to="/results"
                          search={{ url: r.listing_url }}
                          style={{ fontSize: 13, color: "#D85A30" }}
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
