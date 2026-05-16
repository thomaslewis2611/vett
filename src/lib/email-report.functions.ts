import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { AnalysisResult } from "@/lib/mock-analysis";

const FROM_ADDRESS = "Roovr <noreply@roovr.co>";

type Tier = "free" | "single" | "pass";

function escapeHtml(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function gbp(n: number | null | undefined): string {
  if (n == null || !isFinite(n as number) || Number(n) === 0) return "—";
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: 0,
  }).format(Number(n));
}

function num(n: number | null | undefined): string {
  if (n == null || !isFinite(n as number) || Number(n) === 0) return "—";
  return String(Math.round(Number(n)));
}

function txt(s: string | null | undefined): string {
  const v = String(s ?? "").trim();
  return v.length === 0 ? "—" : escapeHtml(v);
}

function severityColor(s: "high" | "medium" | "low"): string {
  if (s === "high") return "#B53A1A";
  if (s === "medium") return "#BA7517";
  return "#5F5E5A";
}

function priorityColor(p: string): string {
  const n = (p || "").toLowerCase();
  if (n === "high priority" || n === "essential" || n === "high") return "#B53A1A";
  if (n === "medium priority" || n === "recommended" || n === "medium") return "#BA7517";
  return "#5F5E5A";
}

function displayPriority(p: string): string {
  const n = (p || "").toLowerCase();
  if (n === "essential") return "High priority";
  if (n === "recommended") return "Medium priority";
  if (n === "optional") return "Low priority";
  return p;
}

// UK Stamp Duty — Main residence rates (England/NI, 2026)
function calcMainResidenceSDLT(price: number): number {
  if (!price || price <= 0) return 0;
  const bands: Array<[number, number]> = [
    [125_000, 0],
    [250_000, 0.02],
    [925_000, 0.05],
    [1_500_000, 0.10],
    [Infinity, 0.12],
  ];
  let prev = 0;
  let tax = 0;
  for (const [cap, rate] of bands) {
    if (price > cap) {
      tax += (cap - prev) * rate;
      prev = cap;
    } else {
      tax += (price - prev) * rate;
      break;
    }
  }
  return Math.round(tax);
}

function calcFirstTimeBuyerSDLT(price: number): number {
  if (!price || price <= 0) return 0;
  // FTB relief only applies up to £625,000. Above that, standard main residence rates apply.
  if (price > 625_000) return calcMainResidenceSDLT(price);
  if (price <= 425_000) return 0;
  return Math.round((price - 425_000) * 0.05);
}

function calcAdditionalPropertySDLT(price: number): number {
  if (!price || price <= 0) return 0;
  return calcMainResidenceSDLT(price) + Math.round(price * 0.03);
}

function pickStampDuty(a: AnalysisResult): number {
  return calcMainResidenceSDLT(Number(a.property?.price ?? 0));
}

function pickPricePerSqFt(a: any): number | null {
  const v =
    a?.metrics?.pricePerSqFt ??
    a?.keyMetrics?.pricePerSqFt ??
    a?.pricePerSqFt ??
    null;
  return v == null ? null : Number(v);
}

function pickDaysOnMarket(a: any): number | null {
  const v =
    a?.metrics?.daysOnMarket ??
    a?.keyMetrics?.daysOnMarket ??
    a?.daysOnMarket ??
    null;
  return v == null ? null : Number(v);
}

function buildReportHtml(opts: {
  analysis: AnalysisResult;
  resultsUrl: string;
  tier: Tier;
}): string {
  const { analysis: a, resultsUrl, tier } = opts;
  const isSingle = tier === "single" || tier === "pass";
  const isPass = tier === "pass";

  const flags = Array.isArray(a.redFlags) ? a.redFlags : [];
  const visibleFlags = isSingle ? flags : flags.slice(0, 2);

  const subScores = a.subScores || ({} as AnalysisResult["subScores"]);
  const subRows: [string, number | undefined][] = [
    ["Value for money", subScores?.valueForMoney],
    ["Location quality", subScores?.locationQuality],
    ["Listing transparency", subScores?.listingTransparency],
    ["Market timing", subScores?.marketTiming],
    ["Risk level", subScores?.riskLevel],
    ["Resale potential", subScores?.resalePotential],
  ];

  const epc = a.epc;
  const ac = a.areaContext;
  const costs = a.costs;
  const neg = a.negotiation;
  const sm = a.sellerMotivation;
  const checklist = a.viewingChecklist;
  const reno = a.renovationCosts;
  const flood = a.floodRisk;
  const schools = a.nearbySchools;

  const price = Number(a.property?.price ?? 0);
  const sdlt = calcMainResidenceSDLT(price);
  const sdltFtb = calcFirstTimeBuyerSDLT(price);
  const sdltAdditional = calcAdditionalPropertySDLT(price);
  const pricePerSqFt = pickPricePerSqFt(a);
  const daysOnMarket = pickDaysOnMarket(a);

  const rowStyle =
    'style="padding:6px 0;font-size:13px;color:#1A1108;border-bottom:1px solid rgba(26,17,8,0.06);"';
  const valStyle =
    'style="padding:6px 0;font-size:13px;font-weight:600;color:#1A1108;text-align:right;border-bottom:1px solid rgba(26,17,8,0.06);"';

  // Sub-scores
  const subScoresHtml = subRows
    .map(
      ([label, val]) => `
      <tr>
        <td ${rowStyle}>${escapeHtml(label)}</td>
        <td ${valStyle}>${val != null ? Number(val).toFixed(1) : "—"}</td>
      </tr>`,
    )
    .join("");

  // EPC
  const epcHtml = epc
    ? `
    <h2 style="font-size:16px;font-weight:600;color:#1A1108;margin:32px 0 12px;">Energy performance</h2>
    <table class="stack" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
      <tr><td ${rowStyle}>EPC rating</td><td ${valStyle}>${txt(epc.rating)}${epc.score != null ? ` (${epc.score})` : ""}</td></tr>
      ${epc.potentialRating ? `<tr><td ${rowStyle}>Potential rating</td><td ${valStyle}>${txt(epc.potentialRating)}</td></tr>` : ""}
      ${epc.estimatedAnnualEnergyCost ? `<tr><td ${rowStyle}>Est. annual energy cost</td><td ${valStyle}>${txt(epc.estimatedAnnualEnergyCost)}</td></tr>` : ""}
    </table>
    ${epc.commentary ? `<p style="font-size:13px;color:#1A1108;line-height:1.6;margin:8px 0 0;">${escapeHtml(epc.commentary)}</p>` : ""}`
    : "";

  // Seller motivation
  const sellerHtml = sm
    ? isSingle
      ? `
      <h2 style="font-size:16px;font-weight:600;color:#1A1108;margin:32px 0 12px;">Seller motivation</h2>
      <p style="font-size:14px;color:#1A1108;margin:0 0 8px;"><strong>${escapeHtml(sm.label)}</strong> · ${Number(sm.score ?? 0).toFixed(1)}/10</p>
      ${Array.isArray(sm.signals) && sm.signals.length ? `<ul style="margin:8px 0 8px;padding:0 0 0 18px;">${sm.signals.map((s) => `<li style="font-size:13px;color:#1A1108;line-height:1.6;">${escapeHtml(s)}</li>`).join("")}</ul>` : ""}
      ${sm.commentary ? `<p style="font-size:13px;color:#1A1108;line-height:1.6;margin:0;">${escapeHtml(sm.commentary)}</p>` : ""}`
      : `
      <h2 style="font-size:16px;font-weight:600;color:#1A1108;margin:32px 0 12px;">Seller motivation</h2>
      <p style="font-size:14px;color:#1A1108;margin:0;"><strong>${escapeHtml(sm.label)}</strong> · ${Number(sm.score ?? 0).toFixed(1)}/10</p>`
    : "";

  // Red flags
  const flagsRows = visibleFlags.length
    ? visibleFlags
        .map(
          (f) => `
        <tr><td style="padding:10px 0;border-top:1px solid rgba(26,17,8,0.08);">
          <div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:${severityColor(f.severity)};margin-bottom:4px;">${escapeHtml(f.severity)}</div>
          <div style="font-size:14px;font-weight:600;color:#1A1108;margin-bottom:4px;">${escapeHtml(f.title)}</div>
          <div style="font-size:13px;color:#1A1108;line-height:1.5;">${escapeHtml(f.detail)}</div>
        </td></tr>`,
        )
        .join("")
    : `<tr><td style="padding:10px 0;font-size:13px;color:#5F5E5A;">No red flags detected.</td></tr>`;
  const flagsHeading = isSingle
    ? `Red flags${flags.length ? ` <span style="font-size:12px;font-weight:400;color:#5F5E5A;">(${flags.length} total)</span>` : ""}`
    : `Red flags${flags.length > visibleFlags.length ? ` <span style="font-size:12px;font-weight:400;color:#5F5E5A;">(${visibleFlags.length} of ${flags.length} shown — free preview)</span>` : ""}`;

  // True cost (single+)
  const trueCostHtml = isSingle && costs
    ? `
    <h2 style="font-size:16px;font-weight:600;color:#1A1108;margin:32px 0 12px;">True cost breakdown</h2>
    <table class="stack" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
      <tr><td ${rowStyle}>Purchase price</td><td ${valStyle}>${gbp(costs.purchasePrice)}</td></tr>
      <tr><td ${rowStyle}>Stamp duty (main residence)</td><td ${valStyle}>${gbp(sdlt)}</td></tr>
      <tr><td ${rowStyle}>Legal fees</td><td ${valStyle}>${gbp(costs.legalFees)}</td></tr>
      <tr><td ${rowStyle}>Survey fees</td><td ${valStyle}>${gbp(costs.surveyFees)}</td></tr>
      <tr><td ${rowStyle}>Mortgage arrangement</td><td ${valStyle}>${gbp(costs.mortgageFees)}</td></tr>
      <tr>
        <td style="padding:10px 0;border-top:2px solid rgba(26,17,8,0.18);font-size:13px;font-weight:600;color:#1A1108;">Total upfront</td>
        <td style="padding:10px 0;border-top:2px solid rgba(26,17,8,0.18);font-size:13px;font-weight:700;color:#1A1108;text-align:right;">${gbp(costs.totalUpfront)}</td>
      </tr>
      <tr><td ${rowStyle}>Est. monthly mortgage</td><td ${valStyle}>${gbp(costs.monthlyMortgage)}</td></tr>
    </table>
    ${costs.mortgageAssumptions ? `<p style="font-size:12px;color:#888780;margin:8px 0 0;">${escapeHtml(costs.mortgageAssumptions)}</p>` : ""}`
    : "";

  // Negotiation (single+)
  const negotiationHtml = isSingle && neg
    ? `
    <h2 style="font-size:16px;font-weight:600;color:#1A1108;margin:32px 0 12px;">Negotiation strategy</h2>
    ${neg.isAuction
      ? `<p style="font-size:14px;color:#1A1108;margin:0 0 8px;"><strong>Auction max bid:</strong> ${gbp(neg.maxBid)}</p>`
      : `<p style="font-size:14px;color:#1A1108;margin:0 0 8px;"><strong>Recommended offer:</strong> ${gbp(neg.recommendedOffer?.low)} – ${gbp(neg.recommendedOffer?.high)}</p>`}
    ${neg.rationale ? `<p style="font-size:13px;color:#1A1108;line-height:1.6;margin:0 0 12px;">${escapeHtml(neg.rationale)}</p>` : ""}
    ${Array.isArray(neg.leverage) && neg.leverage.length
      ? `<p style="font-size:13px;font-weight:600;color:#1A1108;margin:0 0 6px;">Leverage points</p><ul style="margin:0;padding:0 0 0 18px;">${neg.leverage.map((l) => `<li style="font-size:13px;color:#1A1108;line-height:1.6;">${escapeHtml(l)}</li>`).join("")}</ul>`
      : ""}`
    : "";

  // Viewing checklist (single+)
  let checklistHtml = "";
  if (isSingle && checklist?.items?.length) {
    const groups = new Map<string, { item: string; why: string }[]>();
    const order = ["Structure", "Legal", "Running costs", "Negotiation", "Practical"];
    for (const it of checklist.items) {
      const k = it.category ?? "Other";
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k)!.push({ item: it.item, why: it.why });
    }
    const orderedKeys = [...order.filter((k) => groups.has(k)), ...[...groups.keys()].filter((k) => !order.includes(k))];
    const sections = orderedKeys
      .map((cat) => {
        const items = groups.get(cat)!;
        const itemRows = items
          .map(
            (it) => `
            <tr><td style="padding:8px 0;border-bottom:1px solid rgba(26,17,8,0.06);">
              <div style="font-size:13px;color:#1A1108;line-height:1.5;"><span style="color:#1B4332;font-weight:700;">→</span> ${escapeHtml(it.item)}</div>
              ${it.why ? `<div style="font-size:12px;color:#5F5E5A;line-height:1.5;margin:3px 0 0 14px;">${escapeHtml(it.why)}</div>` : ""}
            </td></tr>`,
          )
          .join("");
        return `
          <p style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#1A1108;margin:18px 0 4px;">${escapeHtml(cat.toUpperCase())}</p>
          <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">${itemRows}</table>`;
      })
      .join("");
    checklistHtml = `
      <h2 style="font-size:16px;font-weight:600;color:#1A1108;margin:32px 0 6px;">Viewing checklist</h2>
      <p style="font-size:12px;color:#5F5E5A;margin:0 0 4px;">Save this email — it's designed for use on your phone at the viewing.</p>
      ${sections}`;
  }

  // Renovation costs (single+)
  let renovationHtml = "";
  if (isSingle && reno?.items?.length) {
    const headerCell =
      'style="padding:8px 8px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#5F5E5A;text-align:left;border-bottom:1px solid rgba(26,17,8,0.18);background:#F1EFE8;"';
    const cell = 'style="padding:10px 8px;font-size:13px;color:#1A1108;border-bottom:1px solid rgba(26,17,8,0.06);vertical-align:top;"';
    const rows = reno.items
      .map(
        (it) => `
        <tr>
          <td ${cell}>
            <div style="font-weight:600;">${escapeHtml(it.issue)}</div>
            ${it.notes ? `<div style="font-size:12px;color:#5F5E5A;margin-top:3px;">${escapeHtml(it.notes)}</div>` : ""}
          </td>
          <td ${cell}><span style="display:inline-block;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:${priorityColor(it.priority)};">${escapeHtml(displayPriority(it.priority))}</span></td>
          <td ${cell} align="right" style="padding:10px 8px;font-size:13px;color:#1A1108;border-bottom:1px solid rgba(26,17,8,0.06);vertical-align:top;text-align:right;font-weight:600;white-space:nowrap;">${escapeHtml(it.estimatedCost)}</td>
        </tr>`,
      )
      .join("");
    const totalRange =
      reno.totalEstimatedMin != null && reno.totalEstimatedMax != null
        ? `${gbp(reno.totalEstimatedMin)} – ${gbp(reno.totalEstimatedMax)}`
        : "—";
    renovationHtml = `
      <h2 style="font-size:16px;font-weight:600;color:#1A1108;margin:32px 0 12px;">Renovation cost estimate</h2>
      <table class="stack3" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
        <tr>
          <th ${headerCell}>Issue</th>
          <th ${headerCell}>Priority</th>
          <th ${headerCell} align="right" style="padding:8px 8px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#5F5E5A;text-align:right;border-bottom:1px solid rgba(26,17,8,0.18);background:#F1EFE8;">Estimated cost</th>
        </tr>
        ${rows}
        <tr>
          <td colspan="2" style="padding:12px 8px;font-size:13px;font-weight:700;color:#1A1108;border-top:2px solid rgba(26,17,8,0.18);">Total estimated renovation</td>
          <td align="right" style="padding:12px 8px;font-size:13px;font-weight:700;color:#1A1108;border-top:2px solid rgba(26,17,8,0.18);text-align:right;white-space:nowrap;">${totalRange}</td>
        </tr>
      </table>
      <p style="font-size:12px;color:#888780;margin:8px 0 0;">Estimates based on typical UK contractor rates 2026. Always obtain quotes before proceeding.</p>`;
  }

  // Flood risk (single+)
  let floodHtml = "";
  if (isSingle && flood && !flood.unavailable) {
    floodHtml = `
      <h2 style="font-size:16px;font-weight:600;color:#1A1108;margin:32px 0 12px;">Flood risk</h2>
      <table class="stack" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
        <tr><td ${rowStyle}>Overall risk</td><td ${valStyle}>${txt(flood.overallRisk)}</td></tr>
        <tr><td ${rowStyle}>Rivers &amp; sea</td><td ${valStyle}>${txt(flood.riversAndSea)}</td></tr>
        <tr><td ${rowStyle}>Surface water</td><td ${valStyle}>${txt(flood.surfaceWater)}</td></tr>
        <tr><td ${rowStyle}>Groundwater</td><td ${valStyle}>${txt(flood.groundwater)}</td></tr>
        <tr><td ${rowStyle}>Reservoir</td><td ${valStyle}>${flood.reservoir == null ? "—" : flood.reservoir ? "Yes" : "No"}</td></tr>
      </table>
      ${flood.commentary ? `<p style="font-size:13px;color:#1A1108;line-height:1.6;margin:8px 0 0;">${escapeHtml(flood.commentary)}</p>` : ""}`;
  }

  // Schools (single+)
  let schoolsHtml = "";
  if (isSingle && schools && !schools.unavailable && schools.schools?.length) {
    const rows = schools.schools
      .map(
        (s) => `
        <tr>
          <td style="padding:8px 8px;font-size:13px;color:#1A1108;border-bottom:1px solid rgba(26,17,8,0.06);">
            <div style="font-weight:600;">${escapeHtml(s.name)}</div>
            ${s.schoolType ? `<div style="font-size:12px;color:#5F5E5A;">${escapeHtml(s.schoolType)}</div>` : ""}
          </td>
          <td style="padding:8px 8px;font-size:13px;color:#1A1108;border-bottom:1px solid rgba(26,17,8,0.06);text-align:right;white-space:nowrap;">${s.distanceMiles != null ? `${s.distanceMiles.toFixed(1)} mi` : "—"}</td>
          <td style="padding:8px 8px;font-size:13px;color:#1A1108;border-bottom:1px solid rgba(26,17,8,0.06);text-align:right;white-space:nowrap;">${s.ofstedRating != null ? `Ofsted ${s.ofstedRating}` : "—"}</td>
        </tr>`,
      )
      .join("");
    schoolsHtml = `
      <h2 style="font-size:16px;font-weight:600;color:#1A1108;margin:32px 0 12px;">Nearby schools</h2>
      <table class="stack3" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">${rows}</table>`;
  }

  // Crime (single+)
  const crime = a.crime;
  let crimeHtml = "";
  if (isSingle && crime && !crime.unavailable) {
    const cats = Array.isArray(crime.topCategories) ? crime.topCategories.slice(0, 5) : [];
    crimeHtml = `
      <h2 style="font-size:16px;font-weight:600;color:#1A1108;margin:32px 0 12px;">Crime</h2>
      <table class="stack" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
        <tr><td ${rowStyle}>Risk level</td><td ${valStyle}>${txt(crime.riskLevel)}</td></tr>
        <tr><td ${rowStyle}>Total incidents (${txt(crime.month)})</td><td ${valStyle}>${num(crime.totalCrimes)}</td></tr>
        ${cats.map((c) => `<tr><td ${rowStyle}>${escapeHtml(c.label || c.category)}</td><td ${valStyle}>${num(c.count)}</td></tr>`).join("")}
      </table>
      ${crime.commentary ? `<p style="font-size:13px;color:#1A1108;line-height:1.6;margin:8px 0 0;">${escapeHtml(crime.commentary)}</p>` : ""}`;
  }

  // Broadband (single+)
  const broadband = a.broadband;
  let broadbandHtml = "";
  if (isSingle && broadband && !broadband.unavailable) {
    broadbandHtml = `
      <h2 style="font-size:16px;font-weight:600;color:#1A1108;margin:32px 0 12px;">Broadband &amp; mobile</h2>
      <table class="stack" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
        <tr><td ${rowStyle}>Download speed</td><td ${valStyle}>${txt(broadband.downloadSpeed)}</td></tr>
        <tr><td ${rowStyle}>Upload speed</td><td ${valStyle}>${txt(broadband.uploadSpeed)}</td></tr>
        <tr><td ${rowStyle}>Connection type</td><td ${valStyle}>${txt(broadband.connectionType)}</td></tr>
        <tr><td ${rowStyle}>Mobile signal</td><td ${valStyle}>${txt(broadband.mobileSignal)}</td></tr>
        <tr><td ${rowStyle}>Suitable for remote work</td><td ${valStyle}>${broadband.suitableForRemoteWork ? "Yes" : "No"}</td></tr>
      </table>
      ${broadband.commentary ? `<p style="font-size:13px;color:#1A1108;line-height:1.6;margin:8px 0 0;">${escapeHtml(broadband.commentary)}</p>` : ""}`;
  }

  // Transport (single+)
  const transport = a.transport;
  let transportHtml = "";
  if (isSingle && transport && !transport.unavailable) {
    transportHtml = `
      <h2 style="font-size:16px;font-weight:600;color:#1A1108;margin:32px 0 12px;">Transport</h2>
      <table class="stack" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
        <tr><td ${rowStyle}>Nearest station</td><td ${valStyle}>${txt(transport.nearestStation)}${transport.distanceToStation ? ` · ${escapeHtml(transport.distanceToStation)}` : ""}</td></tr>
        <tr><td ${rowStyle}>Journey to ${txt(transport.nearestCity)}</td><td ${valStyle}>${txt(transport.journeyToNearestCity)}</td></tr>
        <tr><td ${rowStyle}>Bus links</td><td ${valStyle}>${txt(transport.busLinks)}</td></tr>
        <tr><td ${rowStyle}>Motorway access</td><td ${valStyle}>${txt(transport.motorwayAccess)}</td></tr>
        <tr><td ${rowStyle}>Airport access</td><td ${valStyle}>${txt(transport.airportAccess)}</td></tr>
        <tr><td ${rowStyle}>Overall rating</td><td ${valStyle}>${txt(transport.transportRating)}</td></tr>
      </table>
      ${transport.commentary ? `<p style="font-size:13px;color:#1A1108;line-height:1.6;margin:8px 0 0;">${escapeHtml(transport.commentary)}</p>` : ""}`;
  }

  // Sold price history (single+)
  let soldHistoryHtml = "";
  const soldRaw = (a.propertyData as any)?.soldPrices;
  const soldList: any[] = Array.isArray(soldRaw)
    ? soldRaw
    : Array.isArray(soldRaw?.data)
      ? soldRaw.data
      : Array.isArray(soldRaw?.prices)
        ? soldRaw.prices
        : Array.isArray(soldRaw?.results)
          ? soldRaw.results
          : [];
  if (isSingle && soldList.length) {
    const rows = soldList.slice(0, 10)
      .map((s: any) => {
        const date = s.date || s.sold_date || s.transaction_date || "";
        const price = Number(s.price ?? s.sold_price ?? s.amount ?? 0);
        const type = s.type || s.property_type || "";
        const addr = s.address || s.paon || "";
        return `<tr>
          <td style="padding:8px 8px;font-size:13px;color:#1A1108;border-bottom:1px solid rgba(26,17,8,0.06);">${escapeHtml(date)}</td>
          <td style="padding:8px 8px;font-size:13px;color:#1A1108;border-bottom:1px solid rgba(26,17,8,0.06);">${escapeHtml(addr)}${type ? ` <span style="color:#5F5E5A;">· ${escapeHtml(type)}</span>` : ""}</td>
          <td style="padding:8px 8px;font-size:13px;font-weight:600;color:#1A1108;border-bottom:1px solid rgba(26,17,8,0.06);text-align:right;white-space:nowrap;">${gbp(price)}</td>
        </tr>`;
      }).join("");
    soldHistoryHtml = `
      <h2 style="font-size:16px;font-weight:600;color:#1A1108;margin:32px 0 12px;">Sold price history</h2>
      <table class="stack3" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">${rows}</table>
      <p style="font-size:12px;color:#888780;margin:8px 0 0;">Source: Land Registry via PropertyData.</p>`;
  }

  // Capital growth (pass only)
  let growthHtml = "";
  const growth = (a.propertyData as any)?.growth;
  if (isPass && growth && typeof growth === "object") {
    const g1 = growth["1yr"] ?? growth.oneYear ?? growth.year_1 ?? null;
    const g3 = growth["3yr"] ?? growth.threeYear ?? growth.year_3 ?? null;
    const g5 = growth["5yr"] ?? growth.fiveYear ?? growth.year_5 ?? null;
    const fmt = (v: any) => v == null || v === "" ? "—" : (typeof v === "number" ? `${v > 0 ? "+" : ""}${v.toFixed(1)}%` : String(v));
    growthHtml = `
      <h2 style="font-size:16px;font-weight:600;color:#1A1108;margin:32px 0 12px;">Capital growth</h2>
      <table class="stack" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
        <tr><td ${rowStyle}>1 year</td><td ${valStyle}>${fmt(g1)}</td></tr>
        <tr><td ${rowStyle}>3 years</td><td ${valStyle}>${fmt(g3)}</td></tr>
        <tr><td ${rowStyle}>5 years</td><td ${valStyle}>${fmt(g5)}</td></tr>
      </table>`;
  }

  return `<!doctype html><html lang="en"><head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="x-apple-disable-message-reformatting">
  <meta name="color-scheme" content="light">
  <meta name="supported-color-schemes" content="light">
  <title>Roovr report</title>
  <style>
    /* Mobile-first overrides — desktop rendering is unchanged */
    @media only screen and (max-width: 600px) {
      .content { width: 100% !important; max-width: 100% !important; }
      .px { padding-left: 18px !important; padding-right: 18px !important; }
      /* Stack 2-col label/value tables vertically */
      table.stack, table.stack tbody, table.stack tr, table.stack td { display: block !important; width: 100% !important; }
      table.stack td { text-align: left !important; padding: 8px 0 0 !important; font-size: 14px !important; border-bottom: none !important; }
      table.stack td + td { padding: 2px 0 10px !important; font-weight: 600 !important; border-bottom: 1px solid rgba(26,17,8,0.08) !important; }
      /* Stack 3-col tables (renovation, schools) */
      table.stack3, table.stack3 tbody, table.stack3 tr, table.stack3 td, table.stack3 th { display: block !important; width: 100% !important; box-sizing: border-box !important; }
      table.stack3 th { display: none !important; }
      table.stack3 td { text-align: left !important; padding: 6px 0 !important; font-size: 14px !important; }
      table.stack3 tr { padding: 10px 0 !important; border-bottom: 1px solid rgba(26,17,8,0.08) !important; }
      /* Header row in score / two-col layouts (address + score badge) */
      table.hero, table.hero tbody, table.hero tr, table.hero td { display: block !important; width: 100% !important; text-align: left !important; }
      table.hero td[align="right"] { margin-top: 14px !important; text-align: left !important; }
      /* Minimum readable font size */
      body, p, li, div, td, th, a, span { font-size: 14px !important; line-height: 1.55 !important; }
      h1 { font-size: 20px !important; }
      h2 { font-size: 17px !important; }
      .small-note { font-size: 12px !important; }
      /* Full-width tappable CTA */
      .cta-btn { display: block !important; width: 100% !important; min-height: 44px !important; padding: 14px 16px !important; box-sizing: border-box !important; font-size: 16px !important; }
    }
  </style>
</head><body style="margin:0;padding:0;background:#F1EFE8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
  <div class="content" style="max-width:600px;margin:0 auto;padding:0;">
    <div class="px" style="background:#1A1108;padding:20px 24px;">
      <div style="font-size:20px;font-weight:700;color:#FFFDF9;letter-spacing:-0.01em;">
        <span style="color:#1B4332;">●</span> Roovr
      </div>
    </div>

    <div class="px" style="background:#FFFDF9;padding:32px 24px;">
      <table class="hero" width="100%" cellpadding="0" cellspacing="0"><tr>
        <td valign="top">
          <h1 style="font-size:18px;font-weight:600;color:#1A1108;margin:0 0 8px;line-height:1.3;">${escapeHtml(a.property.address)}</h1>
          <div style="font-size:24px;font-weight:600;color:#1A1108;">${gbp(a.property.price)}</div>
          <div style="font-size:13px;color:#5F5E5A;margin-top:6px;">${a.property.beds} bed · ${a.property.baths} bath${a.property.sqft > 0 ? ` · ${a.property.sqft.toLocaleString()} sq ft` : ""}${a.property.type ? ` · ${escapeHtml(a.property.type)}` : ""}</div>
        </td>
        <td valign="top" align="right" width="100">
          <div style="background:#1A1108;color:#FFFDF9;border-radius:12px;padding:12px 16px;text-align:center;min-width:80px;display:inline-block;">
            <div style="font-size:28px;font-weight:700;line-height:1;">${Number(a.score ?? 0).toFixed(1)}</div>
            <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.08em;margin-top:4px;opacity:0.8;">Roovr score</div>
          </div>
        </td>
      </tr></table>
      ${a.scoreLabel ? `<p style="font-size:14px;color:#1A1108;margin:14px 0 0;font-style:italic;">${escapeHtml(a.scoreLabel)}</p>` : ""}

      <h2 style="font-size:16px;font-weight:600;color:#1A1108;margin:32px 0 12px;">Score breakdown</h2>
      <table class="stack" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">${subScoresHtml}</table>

      <h2 style="font-size:16px;font-weight:600;color:#1A1108;margin:32px 0 12px;">Key metrics</h2>
      <table class="stack" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
        <tr><td ${rowStyle}>Price per sq ft</td><td ${valStyle}>${gbp(pricePerSqFt)}</td></tr>
        <tr><td ${rowStyle}>Days on market</td><td ${valStyle}>${num(daysOnMarket)}</td></tr>
        <tr><td ${rowStyle}>Council tax band</td><td ${valStyle}>${txt(a.metrics?.councilTaxBand)}</td></tr>
      </table>

      <h2 style="font-size:16px;font-weight:600;color:#1A1108;margin:32px 0 12px;">Stamp duty</h2>
      <table class="stack" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
        <tr><td ${rowStyle}>First-time buyer</td><td ${valStyle}>${gbp(sdltFtb)}</td></tr>
        <tr><td ${rowStyle}>Main residence</td><td ${valStyle}>${gbp(sdlt)}</td></tr>
        <tr><td ${rowStyle}>Additional property</td><td ${valStyle}>${gbp(sdltAdditional)}</td></tr>
      </table>

      ${ac ? `
        <h2 style="font-size:16px;font-weight:600;color:#1A1108;margin:32px 0 12px;">Area Pricing Analysis</h2>
        ${ac.areaDescription ? `<p style="font-size:13px;color:#1A1108;line-height:1.6;margin:0 0 8px;">${escapeHtml(ac.areaDescription)}</p>` : ""}
        ${ac.comparableNote ? `<p style="font-size:13px;color:#5F5E5A;line-height:1.6;margin:0;">${escapeHtml(ac.comparableNote)}</p>` : ""}
      ` : ""}

      ${epcHtml}
      ${sellerHtml}

      <h2 style="font-size:16px;font-weight:600;color:#1A1108;margin:32px 0 12px;">${flagsHeading}</h2>
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">${flagsRows}</table>

      ${trueCostHtml}
      ${negotiationHtml}
      ${checklistHtml}
      ${renovationHtml}
      ${floodHtml}
      ${schoolsHtml}
      ${crimeHtml}
      ${broadbandHtml}
      ${transportHtml}
      ${soldHistoryHtml}
      ${growthHtml}

      <div style="margin:36px 0 8px;text-align:center;">
        <a href="${escapeHtml(resultsUrl)}" class="cta-btn" style="background:#1B4332;color:#FFFDF9;font-size:15px;font-weight:600;border-radius:8px;padding:14px 24px;text-decoration:none;display:inline-block;min-height:44px;line-height:1.2;">View full report online →</a>
      </div>

      <p class="small-note" style="font-size:12px;color:#888780;line-height:1.5;margin:32px 0 0;text-align:center;">This report is AI-generated and advisory only. Always seek independent professional advice before making any offer.</p>
    </div>

    <div class="px" style="padding:20px 24px;text-align:center;">
      <p class="small-note" style="font-size:12px;color:#888780;margin:0;">© 2026 Roovr · roovr.co · Every listing. Analysed. Instantly.</p>
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
      // Backwards compatible: accept either tier or isPaid.
      tier: z.enum(["free", "single", "pass"]).optional(),
      isPaid: z.boolean().optional(),
    }),
  )
  .handler(async ({ data }): Promise<{ ok: boolean; error?: string }> => {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) return { ok: false, error: "RESEND_API_KEY missing" };

    const analysis = data.analysis as AnalysisResult;
    if (!analysis?.property?.address) return { ok: false, error: "Invalid analysis" };

    const tier: Tier = data.tier ?? (data.isPaid ? "single" : "free");

    const subject = `Your Roovr report — ${analysis.property.address}`;
    const html = buildReportHtml({
      analysis,
      resultsUrl: data.resultsUrl,
      tier,
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
