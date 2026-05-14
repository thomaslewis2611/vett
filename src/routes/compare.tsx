import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Fragment, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { ArrowLeft, Mail, Check } from "lucide-react";
import { SiteHeader, SiteFooter } from "@/components/site-chrome";
import { supabase } from "@/integrations/supabase/client";
import { formatGBP } from "@/lib/mock-analysis";
import { getComparisonVerdict, emailComparison } from "@/lib/compare.functions";

const searchSchema = z.object({
  a: z.string().optional(),
  b: z.string().optional(),
});

export const Route = createFileRoute("/compare")({
  head: () => ({ meta: [{ title: "Compare properties — Roovr" }] }),
  validateSearch: searchSchema,
  component: ComparePage,
});

type SavedRow = {
  id: string;
  listing_url: string | null;
  analysis_json: any;
  created_at: string;
};

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

function fmtNum(n: number | null | undefined): string {
  if (n == null || !isFinite(Number(n)) || Number(n) === 0) return "—";
  return String(Math.round(Number(n)));
}

function fmtTxt(s: string | null | undefined): string {
  const v = String(s ?? "").trim();
  return v.length === 0 ? "—" : v;
}

function ComparePage() {
  const navigate = useNavigate();
  const search = Route.useSearch();
  const verdictFn = useServerFn(getComparisonVerdict);
  const emailFn = useServerFn(emailComparison);

  const [email, setEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [allRows, setAllRows] = useState<SavedRow[]>([]);
  const [a, setA] = useState<SavedRow | null>(null);
  const [b, setB] = useState<SavedRow | null>(null);
  const [verdict, setVerdict] = useState<string>("");
  const [verdictLoading, setVerdictLoading] = useState(false);
  const [emailing, setEmailing] = useState(false);
  const [emailSent, setEmailSent] = useState(false);

  // Selector mode
  const [selected, setSelected] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase.auth.getUser();
      if (cancelled) return;
      const userEmail = data.user?.email ?? null;
      if (!userEmail) {
        navigate({ to: "/pricing" });
        return;
      }
      const { data: bp } = await supabase
        .from("buyer_pass_users")
        .select("email, expires_at")
        .ilike("email", userEmail)
        .maybeSingle();
      if (!bp) {
        navigate({ to: "/pricing" });
        return;
      }
      const exp = (bp as { expires_at: string | null }).expires_at;
      if (exp && new Date(exp).getTime() <= Date.now()) {
        navigate({ to: "/pricing" });
        return;
      }
      setEmail(userEmail);

      const ids = [search.a, search.b].filter(Boolean) as string[];
      if (ids.length === 2) {
        const { data: rows } = await supabase
          .from("saved_analyses")
          .select("id, listing_url, analysis_json, created_at")
          .in("id", ids);
        const list = (rows as SavedRow[]) ?? [];
        const ra = list.find((r) => r.id === search.a) ?? null;
        const rb = list.find((r) => r.id === search.b) ?? null;
        setA(ra);
        setB(rb);
      } else {
        // Selector
        const { data: rows } = await supabase
          .from("saved_analyses")
          .select("id, listing_url, analysis_json, created_at")
          .order("created_at", { ascending: false })
          .limit(50);
        const seen = new Set<string>();
        const deduped: SavedRow[] = [];
        for (const r of (rows as SavedRow[]) ?? []) {
          const key = r.listing_url ?? `__${r.id}`;
          if (seen.has(key)) continue;
          seen.add(key);
          deduped.push(r);
        }
        setAllRows(deduped);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [navigate, search.a, search.b]);

  // Fetch verdict once both analyses are loaded
  useEffect(() => {
    if (!a || !b || verdict || verdictLoading) return;
    setVerdictLoading(true);
    verdictFn({ data: { a: a.analysis_json, b: b.analysis_json } })
      .then((r) => setVerdict(r.verdict))
      .catch(() => setVerdict("Comparison verdict is temporarily unavailable."))
      .finally(() => setVerdictLoading(false));
  }, [a, b, verdict, verdictLoading, verdictFn]);

  const onToggle = (id: string) => {
    setSelected((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 2) return prev;
      return [...prev, id];
    });
  };

  const onCompare = () => {
    if (selected.length !== 2) return;
    navigate({ to: "/compare", search: { a: selected[0], b: selected[1] } });
  };

  const onEmail = async () => {
    if (!a || !b || !email) return;
    setEmailing(true);
    try {
      await emailFn({
        data: {
          email,
          a: a.analysis_json,
          b: b.analysis_json,
          verdict: verdict || "Verdict unavailable.",
        },
      });
      setEmailSent(true);
    } finally {
      setEmailing(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen flex-col bg-background">
        <SiteHeader />
        <main className="mx-auto max-w-3xl px-6 py-24 text-center" style={{ color: "#5F5E5A" }}>
          Loading…
        </main>
        <SiteFooter />
      </div>
    );
  }

  // SELECTOR MODE
  if (!a || !b) {
    return (
      <div className="flex min-h-screen flex-col bg-background">
        <SiteHeader />
        <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8 sm:px-6 sm:py-12">
          <Link to="/dashboard" className="inline-flex items-center gap-1.5 mb-6" style={{ fontSize: 13, color: "#5F5E5A" }}>
            <ArrowLeft className="h-4 w-4" /> Back to dashboard
          </Link>
          <h1 className="text-3xl font-semibold tracking-tight">Select two properties to compare</h1>
          <p className="mt-2" style={{ fontSize: 13, color: "#888780" }}>
            Tap two reports below, then click Compare.
          </p>

          {allRows.length < 2 ? (
            <div className="mt-8 p-8 text-center" style={{ background: "#F1EFE8", borderRadius: 12, color: "#5F5E5A", fontSize: 14 }}>
              You need at least two saved reports to compare. Analyse another property first.
            </div>
          ) : (
            <>
              <ul className="mt-6 space-y-3">
                {allRows.map((r) => {
                  const an = r.analysis_json ?? {};
                  const address = an?.property?.address ?? r.listing_url ?? "Untitled";
                  const price = an?.property?.price ?? 0;
                  const score = typeof an?.score === "number" ? an.score : null;
                  const idx = selected.indexOf(r.id);
                  const isSel = idx >= 0;
                  const num = idx + 1;
                  return (
                    <li key={r.id}>
                      <button
                        type="button"
                        onClick={() => onToggle(r.id)}
                        className="flex w-full items-center justify-between gap-4 p-4 text-left"
                        style={{
                          background: "#FFFDF9",
                          borderRadius: 12,
                          border: isSel ? "2px solid #D85A30" : "0.5px solid rgba(26,17,8,0.12)",
                          boxSizing: "border-box",
                        }}
                      >
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                          {isSel && (
                            <span
                              style={{
                                background: "#D85A30",
                                color: "#FFFDF9",
                                width: 24,
                                height: 24,
                                borderRadius: 999,
                                display: "inline-flex",
                                alignItems: "center",
                                justifyContent: "center",
                                fontSize: 12,
                                fontWeight: 700,
                                flexShrink: 0,
                              }}
                            >
                              {num}
                            </span>
                          )}
                          <div className="min-w-0 flex-1">
                            <div className="truncate" style={{ fontSize: 15, fontWeight: 500, color: "#1A1108" }}>{address}</div>
                            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs" style={{ color: "#888780" }}>
                              {price > 0 && <span>{formatGBP(price)}</span>}
                              <span>{new Date(r.created_at).toLocaleDateString()}</span>
                            </div>
                          </div>
                        </div>
                        {score !== null && (
                          <span
                            style={{
                              background: "#FAECE7",
                              color: "#993C1D",
                              fontSize: 12,
                              fontWeight: 500,
                              borderRadius: 8,
                              padding: "4px 10px",
                              flexShrink: 0,
                            }}
                          >
                            {score.toFixed(1)} / 10
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
              <div className="mt-8 flex justify-center">
                <button
                  type="button"
                  onClick={onCompare}
                  disabled={selected.length !== 2}
                  style={{
                    background: selected.length === 2 ? "#D85A30" : "#D1CFC8",
                    color: "#FFFDF9",
                    fontSize: 13,
                    fontWeight: 500,
                    borderRadius: 100,
                    padding: "12px 28px",
                    cursor: selected.length === 2 ? "pointer" : "not-allowed",
                  }}
                >
                  Compare →
                </button>
              </div>
            </>
          )}
        </main>
        <SiteFooter />
      </div>
    );
  }

  // COMPARISON MODE
  return <ComparisonView a={a} b={b} verdict={verdict} verdictLoading={verdictLoading} onEmail={onEmail} emailing={emailing} emailSent={emailSent} />;
}

function ComparisonView({
  a,
  b,
  verdict,
  verdictLoading,
  onEmail,
  emailing,
  emailSent,
}: {
  a: SavedRow;
  b: SavedRow;
  verdict: string;
  verdictLoading: boolean;
  onEmail: () => void;
  emailing: boolean;
  emailSent: boolean;
}) {
  const A = a.analysis_json ?? {};
  const B = b.analysis_json ?? {};
  const addrA = truncate(A?.property?.address ?? "Property A", 30);
  const addrB = truncate(B?.property?.address ?? "Property B", 30);

  const aFlags = Array.isArray(A.redFlags) ? A.redFlags : [];
  const bFlags = Array.isArray(B.redFlags) ? B.redFlags : [];
  const aHigh = aFlags.filter((f: any) => f.severity === "high").length;
  const bHigh = bFlags.filter((f: any) => f.severity === "high").length;

  type RowDef = {
    label: string;
    aVal: string;
    bVal: string;
    // -1 = a wins, 1 = b wins, 0 = neither
    winner?: -1 | 0 | 1;
  };

  const cmpHigher = (x: number, y: number): -1 | 0 | 1 =>
    x > y ? -1 : y > x ? 1 : 0;
  const cmpLower = (x: number, y: number): -1 | 0 | 1 =>
    x > 0 && y > 0 ? (x < y ? -1 : y < x ? 1 : 0) : 0;

  const overview: RowDef[] = [
    {
      label: "Roovr score",
      aVal: `${Number(A.score ?? 0).toFixed(1)} / 10`,
      bVal: `${Number(B.score ?? 0).toFixed(1)} / 10`,
      winner: cmpHigher(Number(A.score ?? 0), Number(B.score ?? 0)),
    },
    {
      label: "Price",
      aVal: formatGBP(A?.property?.price ?? 0),
      bVal: formatGBP(B?.property?.price ?? 0),
      winner: cmpLower(Number(A?.property?.price ?? 0), Number(B?.property?.price ?? 0)),
    },
    { label: "Property type", aVal: fmtTxt(A?.property?.type), bVal: fmtTxt(B?.property?.type) },
    { label: "Bedrooms", aVal: fmtNum(A?.property?.beds), bVal: fmtNum(B?.property?.beds) },
    { label: "Bathrooms", aVal: fmtNum(A?.property?.baths), bVal: fmtNum(B?.property?.baths) },
    {
      label: "Price per sq ft",
      aVal: A?.metrics?.pricePerSqFt ? formatGBP(A.metrics.pricePerSqFt) : "—",
      bVal: B?.metrics?.pricePerSqFt ? formatGBP(B.metrics.pricePerSqFt) : "—",
      winner: cmpLower(Number(A?.metrics?.pricePerSqFt ?? 0), Number(B?.metrics?.pricePerSqFt ?? 0)),
    },
    { label: "Days on market", aVal: fmtNum(A?.metrics?.daysOnMarket), bVal: fmtNum(B?.metrics?.daysOnMarket) },
    { label: "Council tax band", aVal: fmtTxt(A?.metrics?.councilTaxBand), bVal: fmtTxt(B?.metrics?.councilTaxBand) },
  ];

  const costs: RowDef[] = [
    {
      label: "Stamp duty (main residence)",
      aVal: formatGBP(A?.costs?.stampDuty ?? 0),
      bVal: formatGBP(B?.costs?.stampDuty ?? 0),
      winner: cmpLower(Number(A?.costs?.stampDuty ?? 0), Number(B?.costs?.stampDuty ?? 0)),
    },
    {
      label: "Legal fees (est.)",
      aVal: formatGBP(A?.costs?.legalFees ?? 0),
      bVal: formatGBP(B?.costs?.legalFees ?? 0),
    },
    {
      label: "Total upfront",
      aVal: formatGBP(A?.costs?.totalUpfront ?? 0),
      bVal: formatGBP(B?.costs?.totalUpfront ?? 0),
      winner: cmpLower(Number(A?.costs?.totalUpfront ?? 0), Number(B?.costs?.totalUpfront ?? 0)),
    },
    {
      label: "Monthly mortgage (est.)",
      aVal: formatGBP(A?.costs?.monthlyMortgage ?? 0),
      bVal: formatGBP(B?.costs?.monthlyMortgage ?? 0),
      winner: cmpLower(Number(A?.costs?.monthlyMortgage ?? 0), Number(B?.costs?.monthlyMortgage ?? 0)),
    },
  ];

  const analysis: RowDef[] = [
    {
      label: "Red flags count",
      aVal: `${aFlags.length} flag${aFlags.length === 1 ? "" : "s"}`,
      bVal: `${bFlags.length} flag${bFlags.length === 1 ? "" : "s"}`,
      winner: cmpLower(aFlags.length, bFlags.length),
    },
    {
      label: "High severity flags",
      aVal: String(aHigh),
      bVal: String(bHigh),
      winner: aHigh < bHigh ? -1 : bHigh < aHigh ? 1 : 0,
    },
    {
      label: "Seller motivation",
      aVal: A?.sellerMotivation ? `${Number(A.sellerMotivation.score ?? 0).toFixed(1)} / 10` : "—",
      bVal: B?.sellerMotivation ? `${Number(B.sellerMotivation.score ?? 0).toFixed(1)} / 10` : "—",
      winner: cmpHigher(
        Number(A?.sellerMotivation?.score ?? 0),
        Number(B?.sellerMotivation?.score ?? 0),
      ),
    },
    { label: "EPC rating", aVal: fmtTxt(A?.epc?.rating), bVal: fmtTxt(B?.epc?.rating) },
    {
      label: "Recommended offer",
      aVal:
        A?.negotiation?.recommendedOffer
          ? `${formatGBP(A.negotiation.recommendedOffer.low)} – ${formatGBP(A.negotiation.recommendedOffer.high)}`
          : "—",
      bVal:
        B?.negotiation?.recommendedOffer
          ? `${formatGBP(B.negotiation.recommendedOffer.low)} – ${formatGBP(B.negotiation.recommendedOffer.high)}`
          : "—",
    },
  ];

  const sections: { title: string; rows: RowDef[] }[] = [
    { title: "Overview", rows: overview },
    { title: "Costs", rows: costs },
    { title: "Analysis", rows: analysis },
  ];

  const winStyle = { background: "#E7F4EA" };

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <SiteHeader />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6 sm:py-12">
        <div className="flex items-center justify-between gap-4 mb-6 flex-wrap">
          <Link to="/dashboard" className="inline-flex items-center gap-1.5" style={{ fontSize: 13, color: "#5F5E5A" }}>
            <ArrowLeft className="h-4 w-4" /> Back to dashboard
          </Link>
          <button
            type="button"
            onClick={onEmail}
            disabled={emailing || emailSent}
            className="inline-flex items-center gap-1.5"
            style={{
              background: emailSent ? "#5F8A6A" : "#D85A30",
              color: "#FFFDF9",
              fontSize: 13,
              fontWeight: 500,
              borderRadius: 100,
              padding: "10px 18px",
              opacity: emailing ? 0.7 : 1,
            }}
          >
            {emailSent ? (
              <>
                <Check className="h-4 w-4" /> Sent
              </>
            ) : (
              <>
                <Mail className="h-4 w-4" /> {emailing ? "Sending…" : "Email comparison →"}
              </>
            )}
          </button>
        </div>

        <h1 className="text-3xl font-semibold tracking-tight">Property comparison</h1>

        {/* Desktop / tablet table */}
        <div className="mt-8 overflow-x-auto hidden sm:block" style={{ background: "#FFFDF9", borderRadius: 12, border: "0.5px solid rgba(26,17,8,0.12)" }}>
          <table className="w-full" style={{ borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "#1A1108", color: "#FFFDF9" }}>
                <th style={{ padding: "14px 12px", textAlign: "left", fontSize: 12, fontWeight: 500, width: "30%" }}></th>
                <th style={{ padding: "14px 12px", textAlign: "left", fontSize: 13, fontWeight: 700, width: "35%" }}>{addrA}</th>
                <th style={{ padding: "14px 12px", textAlign: "left", fontSize: 13, fontWeight: 700, width: "35%" }}>{addrB}</th>
              </tr>
            </thead>
            <tbody>
              {sections.map((section) => (
                <Fragment key={section.title}>
                  <tr>
                    <td colSpan={3} style={{ padding: "14px 12px", background: "#F1EFE8", fontSize: 11, fontWeight: 700, color: "#888780", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                      {section.title}
                    </td>
                  </tr>
                  {section.rows.map((r, i) => {
                    const bg = i % 2 === 0 ? "#FFFDF9" : "#FAF8F1";
                    return (
                      <tr key={`${section.title}-${r.label}`} style={{ background: bg }}>
                        <td style={{ padding: "12px", fontSize: 13, color: "#5F5E5A" }}>{r.label}</td>
                        <td style={{ padding: "12px", fontSize: 13, color: "#1A1108", fontWeight: 600, ...(r.winner === -1 ? winStyle : {}) }}>{r.aVal}</td>
                        <td style={{ padding: "12px", fontSize: 13, color: "#1A1108", fontWeight: 600, ...(r.winner === 1 ? winStyle : {}) }}>{r.bVal}</td>
                      </tr>
                    );
                  })}
                </Fragment>
              ))}
              {/* Red flags summary */}
              <tr>
                <td colSpan={3} style={{ padding: "14px 12px", background: "#F1EFE8", fontSize: 11, fontWeight: 700, color: "#888780", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                  Top red flags
                </td>
              </tr>
              <tr style={{ background: "#FFFDF9" }}>
                <td style={{ padding: "12px", fontSize: 13, color: "#5F5E5A", verticalAlign: "top" }}>Top 3 issues</td>
                <td style={{ padding: "12px", fontSize: 13, color: "#1A1108", verticalAlign: "top" }}>
                  <FlagsList flags={aFlags.slice(0, 3)} />
                </td>
                <td style={{ padding: "12px", fontSize: 13, color: "#1A1108", verticalAlign: "top" }}>
                  <FlagsList flags={bFlags.slice(0, 3)} />
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Mobile stacked */}
        <div className="mt-8 sm:hidden space-y-6">
          {[
            { label: addrA, data: A, flags: aFlags },
            { label: addrB, data: B, flags: bFlags },
          ].map((col, ci) => (
            <div key={ci} style={{ background: "#FFFDF9", borderRadius: 12, border: "0.5px solid rgba(26,17,8,0.12)", overflow: "hidden" }}>
              <div style={{ padding: "12px 14px", background: "#1A1108", color: "#FFFDF9", fontSize: 14, fontWeight: 700 }}>
                {col.label}
              </div>
              {sections.map((section) => (
                <div key={section.title}>
                  <div style={{ padding: "10px 14px", background: "#F1EFE8", fontSize: 11, fontWeight: 700, color: "#888780", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                    {section.title}
                  </div>
                  {section.rows.map((r) => (
                    <div key={r.label} style={{ padding: "10px 14px", display: "flex", justifyContent: "space-between", gap: 12, borderBottom: "1px solid rgba(26,17,8,0.06)" }}>
                      <span style={{ fontSize: 13, color: "#5F5E5A" }}>{r.label}</span>
                      <span style={{ fontSize: 13, fontWeight: 600, color: "#1A1108", textAlign: "right" }}>{ci === 0 ? r.aVal : r.bVal}</span>
                    </div>
                  ))}
                </div>
              ))}
              <div style={{ padding: "10px 14px", background: "#F1EFE8", fontSize: 11, fontWeight: 700, color: "#888780", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                Top red flags
              </div>
              <div style={{ padding: "12px 14px" }}>
                <FlagsList flags={col.flags.slice(0, 3)} />
              </div>
            </div>
          ))}
        </div>

        {/* Verdict */}
        <div className="mt-10 p-6" style={{ background: "#FAECE7", borderRadius: 16, border: "1px solid #F4D5CB" }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: "#1A1108", margin: 0 }}>Roovr verdict</h2>
          <p style={{ fontSize: 14, color: "#1A1108", lineHeight: 1.6, margin: "12px 0 0", whiteSpace: "pre-wrap" }}>
            {verdictLoading ? "Generating verdict…" : verdict || "No verdict available."}
          </p>
          <p style={{ fontSize: 11, color: "#888780", margin: "16px 0 0" }}>
            AI-generated comparison based on listing data. Always verify independently.
          </p>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}

function FlagsList({ flags }: { flags: { severity: string; title: string }[] }) {
  if (!flags.length) {
    return <span style={{ fontSize: 13, color: "#5F5E5A" }}>No major flags</span>;
  }
  return (
    <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
      {flags.map((f, i) => (
        <li key={i} style={{ fontSize: 13, color: "#1A1108", lineHeight: 1.5, marginBottom: 6 }}>
          <span style={{ color: "#D85A30", fontWeight: 700 }}>•</span> {f.title}
        </li>
      ))}
    </ul>
  );
}
