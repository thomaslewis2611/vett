import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { ArrowRight, LogOut, FileText } from "lucide-react";
import { SiteHeader, SiteFooter } from "@/components/site-chrome";
import { supabase } from "@/integrations/supabase/client";
import { getSingleReportByEmail } from "@/lib/access.functions";

export const Route = createFileRoute("/my-report")({
  head: () => ({ meta: [{ title: "My report — Roovr" }] }),
  component: MyReportPage,
});

function MyReportPage() {
  const navigate = useNavigate();
  const fetchReport = useServerFn(getSingleReportByEmail);
  const [email, setEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [report, setReport] = useState<{ token: string; listingUrl: string | null; expiresAt: string | null } | null>(null);

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
      try {
        const r = await fetchReport({ data: { email: userEmail } });
        if (cancelled) return;
        if (r.token) {
          setReport({ token: r.token, listingUrl: r.listingUrl, expiresAt: r.expiresAt });
        } else {
          setReport(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [navigate, fetchReport]);

  const onSignOut = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/" });
  };

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-6 py-12">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">Your report</h1>
            {email && <p className="mt-1 text-sm" style={{ color: "#5F5E5A" }}>{email}</p>}
          </div>
          <button
            type="button"
            onClick={onSignOut}
            className="inline-flex items-center gap-2"
            style={{ fontSize: 13, color: "#5F5E5A" }}
          >
            <LogOut className="h-4 w-4" /> Sign out
          </button>
        </div>

        {loading ? (
          <div className="mt-10 text-sm" style={{ color: "#5F5E5A" }}>Loading your report…</div>
        ) : report ? (
          <section
            className="mt-8 p-6"
            style={{ background: "#FFFDF9", borderRadius: 16, border: "0.5px solid rgba(26,17,8,0.12)" }}
          >
            <div className="flex items-start gap-3">
              <div
                className="inline-flex h-10 w-10 items-center justify-center"
                style={{ background: "#FAECE7", borderRadius: 10 }}
              >
                <FileText className="h-5 w-5" style={{ color: "#993C1D" }} />
              </div>
              <div className="min-w-0 flex-1">
                <div style={{ fontSize: 15, fontWeight: 500, color: "#1A1108" }}>
                  Your purchased property report
                </div>
                {report.listingUrl && (
                  <a
                    href={report.listingUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1 block truncate"
                    style={{ fontSize: 12, color: "#888780" }}
                  >
                    {report.listingUrl}
                  </a>
                )}
                {report.expiresAt && (
                  <div className="mt-2" style={{ fontSize: 12, color: "#888780" }}>
                    Access until {new Date(report.expiresAt).toLocaleDateString()}
                  </div>
                )}
              </div>
            </div>
            <div className="mt-5">
              <Link
                to="/results"
                search={{ url: report.listingUrl ?? undefined, token: report.token }}
                className="inline-flex items-center gap-1"
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
            </div>
          </section>
        ) : (
          <div
            className="mt-8 p-6 text-sm"
            style={{ background: "#F1EFE8", borderRadius: 12, color: "#5F5E5A" }}
          >
            We couldn't find a purchased report linked to this email. If you've just paid, give it a minute and refresh.
          </div>
        )}

        <section className="mt-10">
          <h2 className="text-lg font-semibold tracking-tight">Want to analyse another property?</h2>
          <p className="mt-2 text-sm" style={{ color: "#5F5E5A" }}>
            Your purchase covers a single report. To unlock unlimited analyses, upgrade to the Buyer Pass.
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
              View pricing <ArrowRight className="h-4 w-4" />
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
