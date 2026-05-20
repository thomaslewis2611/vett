import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowRight, LogOut, FileText } from "lucide-react";
import { SiteHeader, SiteFooter } from "@/components/site-chrome";
import { supabase } from "@/integrations/supabase/client";
import { formatGBP } from "@/lib/analysis.types";
import { getMyReportsData } from "@/lib/checkout.functions";

export const Route = createFileRoute("/my-reports")({
  head: () => ({ meta: [{ title: "My Reports — vett" }] }),
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
  job_id: string | null;
  address: string | null;
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
    let loaded = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const loadForUser = async (accessToken: string) => {
      if (cancelled || loaded) return;
      loaded = true;
      if (timeoutId) clearTimeout(timeoutId);
      try {
        const result = await getMyReportsData({ data: { token: accessToken } });
        if (cancelled) return;

        if (!result.email) {
          // Token invalid or expired — send to home
          navigate({ to: "/" });
          return;
        }

        setEmail(result.email);

        if (result.hasBuyerPass) {
          setHasPass(true);
          navigate({ to: "/dashboard" });
          return;
        }

        setSaved(result.savedAnalyses as SavedRow[]);
        setPending(result.pendingTokens as PendingTokenRow[]);
      } catch (err) {
        console.error("[my-reports] loadForUser error:", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (cancelled) return;
      const accessToken = session?.access_token ?? null;
      if (accessToken) {
        loadForUser(accessToken);
      } else if (event === "INITIAL_SESSION") {
        const hash = typeof window !== "undefined" ? window.location.hash : "";
        if (hash.includes("access_token")) {
          // Hash token is being exchanged; wait for SIGNED_IN, but cap at 8 s
          timeoutId = setTimeout(() => {
            if (!cancelled && !loaded) navigate({ to: "/" });
          }, 8000);
        } else if (hash.includes("error=")) {
          // Magic link expired or already used
          navigate({ to: "/" });
        } else {
          navigate({ to: "/" });
        }
      } else if (event === "SIGNED_OUT") {
        navigate({ to: "/" });
      }
    });

    // Belt-and-suspenders: session may already be established before subscription
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!cancelled && session?.access_token) {
        loadForUser(session.access_token);
      }
    });

    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
      subscription.unsubscribe();
    };
  }, [navigate]);

  const onSignOut = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/" });
  };

  const HEADING = "'Playfair Display', Georgia, serif";

  if (loading || hasPass) {
    return (
      <div className="flex min-h-screen flex-col" style={{ background: "#F1EFE8" }}>
        <SiteHeader />
        <main className="mx-auto max-w-3xl px-6 py-24 text-center flex-1" style={{ fontWeight: 300, color: "#5F5E5A" }}>
          Loading your reports…
        </main>
        <SiteFooter />
      </div>
    );
  }

  const isEmpty = saved.length === 0 && pending.length === 0;

  return (
    <div className="flex min-h-screen flex-col" style={{ background: "#F1EFE8" }}>
      <SiteHeader />
      <main className="mx-auto w-full max-w-4xl px-4 py-10 sm:px-6 sm:py-14 flex-1">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
          <div className="min-w-0">
            <h1 style={{ fontFamily: HEADING, fontWeight: 400, fontSize: 38, color: "#1A1108", letterSpacing: "-0.6px", lineHeight: 1.1 }}>
              My Reports
            </h1>
            {email && (
              <p className="mt-2 truncate" style={{ fontSize: 14, fontWeight: 300, color: "#5F5E5A" }}>
                {email}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onSignOut}
            className="inline-flex w-fit items-center gap-2"
            style={{ fontSize: 13, fontWeight: 300, color: "#5F5E5A" }}
          >
            <LogOut className="h-4 w-4" /> Sign out
          </button>
        </div>

        <section className="mt-10">
          {isEmpty ? (
            <div
              className="p-10 text-center"
              style={{ background: "#FFFDF9", border: "0.5px solid rgba(26,17,8,0.1)", borderRadius: 16 }}
            >
              <h3 style={{ fontFamily: HEADING, fontWeight: 400, fontSize: 22, color: "#1A1108", letterSpacing: "-0.3px" }}>
                Nothing here yet
              </h3>
              <p className="mt-2" style={{ fontSize: 14, fontWeight: 300, color: "#5F5E5A" }}>
                We couldn't find any reports linked to this email. If you've just paid, give it a minute and refresh.
              </p>
            </div>
          ) : (
            <ul className="space-y-3">
              {pending.map((p) => (
                <li
                  key={p.token}
                  className="flex w-full flex-col gap-2 p-5 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
                  style={{
                    background: "#FFFDF9",
                    borderRadius: 16,
                    border: "0.5px solid rgba(26,17,8,0.1)",
                  }}
                >
                  <div className="flex min-w-0 flex-1 items-start gap-3">
                    <div
                      className="inline-flex h-10 w-10 shrink-0 items-center justify-center"
                      style={{ background: "#F1EFE8", borderRadius: 10 }}
                    >
                      <FileText className="h-5 w-5" style={{ color: "#2D6A4F" }} />
                    </div>
                    <div className="min-w-0">
                      <div
                        className="truncate"
                        style={{ fontFamily: HEADING, fontSize: 18, fontWeight: 400, color: "#1A1108", letterSpacing: "-0.2px" }}
                      >
                        {p.address ?? "Your purchased report"}
                      </div>
                      {p.listing_url && (
                        <div
                          className="mt-1 truncate"
                          style={{ fontSize: 12, fontWeight: 300, color: "#888780" }}
                        >
                          {p.listing_url}
                        </div>
                      )}
                    </div>
                  </div>
                  <Link
                    to="/results"
                    search={
                      p.job_id
                        ? { url: p.listing_url ?? undefined, job_id: p.job_id }
                        : { url: p.listing_url ?? undefined }
                    }
                    className="inline-flex items-center justify-center gap-1"
                    style={{
                      background: "#2D6A4F",
                      color: "#FFFDF9",
                      fontSize: 14,
                      fontWeight: 500,
                      borderRadius: 100,
                      padding: "11px 20px",
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
                    className="flex w-full flex-col gap-2 p-5 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
                    style={{
                      background: "#FFFDF9",
                      borderRadius: 16,
                      border: "0.5px solid rgba(26,17,8,0.1)",
                    }}
                  >
                    <div className="min-w-0 flex-1">
                      <div
                        className="truncate"
                        style={{ fontFamily: HEADING, fontSize: 18, fontWeight: 400, color: "#1A1108", letterSpacing: "-0.2px" }}
                      >
                        {address}
                      </div>
                      <div
                        className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1"
                        style={{ fontSize: 12, fontWeight: 300, color: "#888780" }}
                      >
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
                      <Link
                        to="/results"
                        search={{ saved_id: r.id }}
                        style={{ fontSize: 13, fontWeight: 500, color: "#2D6A4F" }}
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

        <section className="mt-14">
          <h2 style={{ fontFamily: HEADING, fontWeight: 400, fontSize: 24, color: "#1A1108", letterSpacing: "-0.3px" }}>
            Want to analyse more properties?
          </h2>
          <p className="mt-3 max-w-2xl" style={{ fontSize: 15, fontWeight: 300, color: "#5F5E5A", lineHeight: 1.65 }}>
            Your purchase covers a single report. To unlock unlimited analyses for 90 days,
            including AI chat, flood risk and nearby schools, upgrade to the Buyer Pass.
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <Link
              to="/pricing"
              className="inline-flex items-center gap-1"
              style={{
                background: "#2D6A4F",
                color: "#FFFDF9",
                fontSize: 14,
                fontWeight: 500,
                borderRadius: 100,
                padding: "12px 22px",
              }}
            >
              Upgrade to Buyer Pass <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              to="/"
              className="inline-flex items-center gap-1"
              style={{
                border: "0.5px solid #1A1108",
                color: "#1A1108",
                fontSize: 14,
                fontWeight: 500,
                borderRadius: 100,
                padding: "12px 22px",
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
