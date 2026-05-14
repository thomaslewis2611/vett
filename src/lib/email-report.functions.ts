import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { AnalysisResult } from "@/lib/mock-analysis";

const FROM_ADDRESS = "Roovr <noreply@roovr.co>";

function escapeHtml(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function gbp(n: number | null | undefined): string {
  if (n == null || !isFinite(n as number)) return "—";
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 }).format(Number(n));
}

function severityColor(s: "high" | "medium" | "low"): string {
  if (s === "high") return "#B53A1A";
  if (s === "medium") return "#BA7517";
  return "#5F5E5A";
}

function buildReportHtml(opts: {
  analysis: AnalysisResult;
  resultsUrl: string;
  isPaid: boolean;
}): string {
  const { analysis: a, resultsUrl, isPaid } = opts;

  const flags = Array.isArray(a.redFlags) ? a.redFlags : [];
  const visibleFlags = isPaid ? flags : flags.slice(0, 2);

  const subScores = a.subScores || ({} as AnalysisResult["subScores"]);
  const subRows = [
    ["Value for money", subScores.valueForMoney],
    ["Location quality", subScores.locationQuality],
    ["Listing transparency", subScores.listingTransparency],
    ["Market timing", subScores.marketTiming],
    ["Risk level", subScores.riskLevel],
    ["Resale potential", subScores.resalePotential],
  ] as [string, number | undefined][];

  const epc = a.epc;
  const ac = a.areaContext;
  const costs = a.costs;
  const neg = a.negotiation;

  const flagsHtml = visibleFlags.length
    ? visibleFlags
        .map(
          (f) => `
        <tr><td style="padding:10px 0;border-top:1px solid rgba(26,17,8,0.08);">
          <div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:${severityColor(f.severity)};margin-bottom:4px;">${escapeHtml(f.severity)}</div>
          <div style="font-size:14px;font-weight:600;color:#1A1108;margin-bottom:4px;">${escapeHtml(f.title)}</div>
          <div style="font-size:13px;color:#1A1108;line-height:1.5;">${escapeHtml(f.detail)}</div>
        </td></tr>`
        )
        .join("")
    : `<tr><td style="padding:10px 0;font-size:13px;color:#5F5E5A;">No red flags detected.</td></tr>`;

  const subScoresHtml = subRows
    .map(
      ([label, val]) => `
      <tr>
        <td style="padding:6px 0;font-size:13px;color:#1A1108;">${escapeHtml(label)}</td>
        <td style="padding:6px 0;font-size:13px;font-weight:600;color:#1A1108;text-align:right;">${val != null ? Number(val).toFixed(1) : "—"}</td>
      </tr>`
    )
    .join("");

  const epcHtml = epc
    ? `<tr><td style="padding:6px 0;font-size:13px;color:#1A1108;">EPC rating</td><td style="padding:6px 0;font-size:13px;font-weight:600;color:#1A1108;text-align:right;">${escapeHtml(epc.rating ?? "—")}${epc.score != null ? ` (${epc.score})` : ""}</td></tr>
       ${epc.estimatedAnnualEnergyCost ? `<tr><td style="padding:6px 0;font-size:13px;color:#1A1108;">Est. annual energy cost</td><td style="padding:6px 0;font-size:13px;font-weight:600;color:#1A1108;text-align:right;">${escapeHtml(epc.estimatedAnnualEnergyCost)}</td></tr>` : ""}`
    : "";

  const trueCostHtml = isPaid && costs
    ? `
    <h2 style="font-size:16px;font-weight:600;color:#1A1108;margin:32px 0 12px;">True cost</h2>
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
      <tr><td style="padding:6px 0;font-size:13px;color:#1A1108;">Purchase price</td><td style="padding:6px 0;font-size:13px;font-weight:600;color:#1A1108;text-align:right;">${gbp(costs.purchasePrice)}</td></tr>
      <tr><td style="padding:6px 0;font-size:13px;color:#1A1108;">Stamp duty</td><td style="padding:6px 0;font-size:13px;font-weight:600;color:#1A1108;text-align:right;">${gbp(costs.stampDuty)}</td></tr>
      <tr><td style="padding:6px 0;font-size:13px;color:#1A1108;">Legal fees</td><td style="padding:6px 0;font-size:13px;font-weight:600;color:#1A1108;text-align:right;">${gbp(costs.legalFees)}</td></tr>
      <tr><td style="padding:6px 0;font-size:13px;color:#1A1108;">Survey fees</td><td style="padding:6px 0;font-size:13px;font-weight:600;color:#1A1108;text-align:right;">${gbp(costs.surveyFees)}</td></tr>
      <tr><td style="padding:6px 0;font-size:13px;color:#1A1108;">Mortgage fees</td><td style="padding:6px 0;font-size:13px;font-weight:600;color:#1A1108;text-align:right;">${gbp(costs.mortgageFees)}</td></tr>
      <tr><td style="padding:8px 0;border-top:1px solid rgba(26,17,8,0.12);font-size:13px;font-weight:600;color:#1A1108;">Total upfront</td><td style="padding:8px 0;border-top:1px solid rgba(26,17,8,0.12);font-size:13px;font-weight:700;color:#1A1108;text-align:right;">${gbp(costs.totalUpfront)}</td></tr>
      <tr><td style="padding:6px 0;font-size:13px;color:#1A1108;">Est. monthly mortgage</td><td style="padding:6px 0;font-size:13px;font-weight:600;color:#1A1108;text-align:right;">${gbp(costs.monthlyMortgage)}</td></tr>
    </table>
    ${costs.mortgageAssumptions ? `<p style="font-size:12px;color:#888780;margin:8px 0 0;">${escapeHtml(costs.mortgageAssumptions)}</p>` : ""}`
    : "";

  const negotiationHtml = isPaid && neg
    ? `
    <h2 style="font-size:16px;font-weight:600;color:#1A1108;margin:32px 0 12px;">Negotiation</h2>
    ${neg.isAuction
      ? `<p style="font-size:14px;color:#1A1108;margin:0 0 8px;"><strong>Auction max bid:</strong> ${gbp(neg.maxBid)}</p>`
      : `<p style="font-size:14px;color:#1A1108;margin:0 0 8px;"><strong>Recommended offer:</strong> ${gbp(neg.recommendedOffer?.low)} – ${gbp(neg.recommendedOffer?.high)}</p>`}
    <p style="font-size:13px;color:#1A1108;line-height:1.5;margin:0 0 12px;">${escapeHtml(neg.rationale ?? "")}</p>
    ${Array.isArray(neg.leverage) && neg.leverage.length
      ? `<ul style="margin:0;padding:0 0 0 18px;">${neg.leverage.map((l) => `<li style="font-size:13px;color:#1A1108;line-height:1.6;">${escapeHtml(l)}</li>`).join("")}</ul>`
      : ""}`
    : "";

  return `<!doctype html><html><body style="margin:0;padding:0;background:#F1EFE8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
  <div style="max-width:640px;margin:0 auto;padding:0;">
    <!-- Header -->
    <div style="background:#1A1108;padding:20px 24px;">
      <div style="font-size:20px;font-weight:700;color:#FFFDF9;letter-spacing:-0.01em;">
        <span style="color:#D85A30;">●</span> Roovr
      </div>
    </div>

    <div style="background:#FFFDF9;padding:32px 24px;">
      <!-- Property -->
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:16px;">
        <div style="flex:1;">
          <h1 style="font-size:18px;font-weight:600;color:#1A1108;margin:0 0 8px;line-height:1.3;">${escapeHtml(a.property.address)}</h1>
          <div style="font-size:24px;font-weight:600;color:#1A1108;">${gbp(a.property.price)}</div>
          <div style="font-size:13px;color:#5F5E5A;margin-top:6px;">${a.property.beds} bed · ${a.property.baths} bath${a.property.sqft > 0 ? ` · ${a.property.sqft.toLocaleString()} sq ft` : ""}${a.property.type ? ` · ${escapeHtml(a.property.type)}` : ""}</div>
        </div>
        <div style="background:#1A1108;color:#FFFDF9;border-radius:12px;padding:12px 16px;text-align:center;min-width:80px;">
          <div style="font-size:28px;font-weight:700;line-height:1;">${Number(a.score ?? 0).toFixed(1)}</div>
          <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.08em;margin-top:4px;opacity:0.8;">Roovr score</div>
        </div>
      </div>
      ${a.scoreLabel ? `<p style="font-size:14px;color:#1A1108;margin:14px 0 0;font-style:italic;">${escapeHtml(a.scoreLabel)}</p>` : ""}

      <!-- Score breakdown -->
      <h2 style="font-size:16px;font-weight:600;color:#1A1108;margin:32px 0 12px;">Score breakdown</h2>
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">${subScoresHtml}</table>

      <!-- Key metrics -->
      <h2 style="font-size:16px;font-weight:600;color:#1A1108;margin:32px 0 12px;">Key metrics</h2>
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
        <tr><td style="padding:6px 0;font-size:13px;color:#1A1108;">Price per sq ft</td><td style="padding:6px 0;font-size:13px;font-weight:600;color:#1A1108;text-align:right;">${gbp(a.metrics?.pricePerSqFt)}</td></tr>
        <tr><td style="padding:6px 0;font-size:13px;color:#1A1108;">Days on market</td><td style="padding:6px 0;font-size:13px;font-weight:600;color:#1A1108;text-align:right;">${a.metrics?.daysOnMarket ?? "—"}</td></tr>
        <tr><td style="padding:6px 0;font-size:13px;color:#1A1108;">Council tax band</td><td style="padding:6px 0;font-size:13px;font-weight:600;color:#1A1108;text-align:right;">${escapeHtml(a.metrics?.councilTaxBand ?? "—")}</td></tr>
        <tr><td style="padding:6px 0;font-size:13px;color:#1A1108;">Estimated stamp duty</td><td style="padding:6px 0;font-size:13px;font-weight:600;color:#1A1108;text-align:right;">${gbp(a.metrics?.estimatedStampDuty)}</td></tr>
        ${epcHtml}
      </table>

      <!-- Area -->
      ${ac ? `
        <h2 style="font-size:16px;font-weight:600;color:#1A1108;margin:32px 0 12px;">Area context</h2>
        <p style="font-size:13px;color:#1A1108;line-height:1.6;margin:0 0 8px;">${escapeHtml(ac.areaDescription ?? "")}</p>
        ${ac.comparableNote ? `<p style="font-size:13px;color:#5F5E5A;line-height:1.6;margin:0;">${escapeHtml(ac.comparableNote)}</p>` : ""}
      ` : ""}

      <!-- Red flags -->
      <h2 style="font-size:16px;font-weight:600;color:#1A1108;margin:32px 0 12px;">Red flags${!isPaid && flags.length > visibleFlags.length ? ` <span style="font-size:12px;font-weight:400;color:#5F5E5A;">(${visibleFlags.length} of ${flags.length} shown — free preview)</span>` : ""}</h2>
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">${flagsHtml}</table>

      ${trueCostHtml}
      ${negotiationHtml}

      <!-- CTA -->
      <div style="margin:36px 0 8px;text-align:center;">
        <a href="${escapeHtml(resultsUrl)}" style="background:#D85A30;color:#FFFDF9;font-size:15px;font-weight:600;border-radius:8px;padding:14px 24px;text-decoration:none;display:inline-block;">View full report online →</a>
      </div>

      <!-- Disclaimer -->
      <p style="font-size:12px;color:#888780;line-height:1.5;margin:32px 0 0;text-align:center;">This report is AI-generated and advisory only. Always seek independent professional advice before making any offer.</p>
    </div>

    <div style="padding:20px 24px;text-align:center;">
      <p style="font-size:12px;color:#888780;margin:0;">© 2026 Roovr · roovr.co · Every listing. Analysed. Instantly.</p>
    </div>
  </div>
</body></html>`;
}

export const sendReportEmail = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      email: z.string().email().max(320),
      analysis: z.unknown(),
      resultsUrl: z.string().max(2000),
      isPaid: z.boolean(),
    })
  )
  .handler(async ({ data }): Promise<{ ok: boolean; error?: string }> => {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) return { ok: false, error: "RESEND_API_KEY missing" };

    const analysis = data.analysis as AnalysisResult;
    if (!analysis?.property?.address) return { ok: false, error: "Invalid analysis" };

    const subject = `Your Roovr report — ${analysis.property.address}`;
    const html = buildReportHtml({
      analysis,
      resultsUrl: data.resultsUrl,
      isPaid: data.isPaid,
    });

    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM_ADDRESS,
        to: data.email,
        subject,
        html,
      }),
    });

    if (!resp.ok) {
      const err = await resp.text();
      console.error("Resend send report error:", err);
      return { ok: false, error: err };
    }
    return { ok: true };
  });
