// Long-running analysis worker. Invoked from the TanStack `startAnalysisJob`
// server function via supabase.functions.invoke (fire-and-forget). Has its
// own ~150s execution budget, independent of the Cloudflare Worker that
// kicked it off.
//
// Responsibilities:
//   1. Fetch the Rightmove/Zoopla listing HTML.
//   2. Call Claude with the full Roovr SYSTEM_PROMPT.
//   3. Parse JSON (with light truncation repair + simplified-schema fallback).
//   4. Update the analysis_jobs row to `complete` / `error`.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// ---------- Listing fetch ----------
const ALLOWED_HOSTS = new Set([
  "www.rightmove.co.uk",
  "rightmove.co.uk",
  "m.rightmove.co.uk",
  "www.zoopla.co.uk",
  "zoopla.co.uk",
  "m.zoopla.co.uk",
]);

function validateUrl(raw: string): URL {
  const u = new URL(raw);
  if (u.protocol !== "https:" || !ALLOWED_HOSTS.has(u.hostname.toLowerCase())) {
    throw new Error("INVALID_URL: Only Rightmove or Zoopla URLs are supported.");
  }
  return u;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&pound;/g, "£")
    .replace(/&#163;/g, "£")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
}

function htmlToCleanText(html: string): string {
  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ");
  return decodeEntities(stripped).replace(/\s+/g, " ").trim();
}

function extractMetaContent(html: string, names: string[]): string[] {
  const out: string[] = [];
  for (const name of names) {
    const patterns = [
      new RegExp(
        `<meta[^>]+(?:property|name)=["']${name}["'][^>]*content=["']([^"']+)["']`,
        "i",
      ),
      new RegExp(
        `<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']${name}["']`,
        "i",
      ),
    ];
    for (const p of patterns) {
      const m = html.match(p);
      if (m?.[1]) {
        out.push(m[1].trim());
        break;
      }
    }
  }
  return out;
}

function htmlToListingText(html: string): string {
  if (!html) return "";
  const lower = html.toLowerCase();
  const blocked =
    html.length < 500 ||
    lower.includes("enable javascript") ||
    lower.includes("access denied");
  let text = "";
  if (!blocked) text = htmlToCleanText(html).slice(0, 25_000);
  if (text.length < 200) {
    const metas = extractMetaContent(html, [
      "og:title",
      "og:description",
      "twitter:title",
      "twitter:description",
      "description",
    ]);
    const combined = metas.map(decodeEntities).filter(Boolean).join("\n").trim();
    if (combined.length >= 100) {
      text =
        `[Limited content — extracted from page metadata only]\n\n${combined}`.slice(
          0,
          25_000,
        );
    }
  }
  return text;
}

function detectFloorPlan(html: string): boolean {
  if (!html) return false;
  const patterns: RegExp[] = [
    /\bfloorplans?\b/i,
    /["']floorplans?["']\s*:/i,
    /\/floorplans?\//i,
    /_FLP_\d+/i,
    /floor[\s-]*plan/i,
  ];
  return patterns.some((p) => p.test(html));
}

async function fetchListingHtml(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-GB,en;q=0.9",
    },
    redirect: "follow",
  });
  if (!res.ok) return "";
  return await res.text();
}

// ---------- Claude prompt ----------
const SYSTEM_PROMPT = `You are Roovr, an expert UK property buyer's analyst whose job is to surface the red flags estate agents won't show buyers. You analyse Rightmove and Zoopla listings for serious UK home buyers.

You must:
- Read the listing carefully (description, photos captions, key features, agent copy).
- Translate UK estate agent euphemisms into honest red flags ("scope to modernise" = dated; "deceptively spacious" = small; "convenient for transport" = noisy; "no chain" can be good or distressed; etc.).
- Estimate UK stamp duty using current rates for the buyer profile (assume an additional / second property buyer for a conservative figure unless stated otherwise).
- For daysOnMarket: look for any date references in the listing text and infer days on market if possible. Return 0 only if there is genuinely no signal.
- Estimate monthly mortgage on 15% deposit, 25-year term at 4.8% fixed.
- Give an overall value score AND 6 sub-scores (each out of 10, one decimal):
  - valueForMoney, locationQuality, listingTransparency, marketTiming, riskLevel (HIGHER = LOWER risk), resalePotential.
- For EACH sub-score, also write a scoreReasons.<key> string of 2-3 sentences of SPECIFIC reasoning that references actual details from this listing.
- Provide an areaContext object with avgPricePerSqFtArea, avgSoldPriceArea, priceVsAreaPercent, areaDescription and comparableNote. Use null for any number you cannot estimate.
- avgPricePerSqFtArea must reflect typical price PER SQUARE FOOT for similar properties in this postcode. PREFER the LOCAL SOLD £/SQFT figure from the PropertyData context when present (use its 'average' value); only fall back to your own estimate if it is null. Compute priceVsAreaPercent as ((property pricePerSqFt - avgPricePerSqFtArea) / avgPricePerSqFtArea) * 100, rounded to 1dp. When the live asking £/sqft is also present, contrast the two in areaDescription / comparableNote (e.g. "current asking £X/sqft vs sold £Y/sqft").
- For AUCTION listings, set negotiation.isAuction true, negotiation.maxBid as a single GBP number, recommendedOffer.low and high BOTH equal to maxBid. Otherwise normal recommended offer range (usually 2-8% under asking).
- IMPORTANT: Only identify a property as an auction listing if the listing text explicitly contains one or more of these exact terms: auction, auctioneer, lot number, reserve price, unconditional exchange, sold prior to auction, online auction. Do NOT infer auction status from: guide price, offers over, offers in excess of, or any other pricing language. These are standard estate agent terms used on normal listings and must never be interpreted as auction indicators. If you incorrectly flag a non-auction property as an auction listing, this causes serious harm to users who may make incorrect financial decisions. When in doubt, do not flag as auction.
- IMPORTANT: "Guide Price" is standard, widely-used UK estate agent terminology — particularly common in Bath, Bristol, the South West and across many private treaty sales. It is NOT inherently an indicator of auction, distress or unusual sale conditions. Rules: (a) If the listing uses "Guide Price" with NO other supporting signals of distress or auction, do NOT generate a red flag for it at all. (b) If you do mention it, the maximum severity is LOW, and the tone must be neutral/informational — note that it is common terminology and the buyer should simply confirm the sale method (private treaty vs auction vs informal tender) with the agent. (c) Only escalate Guide Price to MEDIUM or HIGH severity if it is combined with other genuine warning signs such as explicit auction terms (see auction list above), very long days on market, multiple price reductions, or unusual completion timeframes (e.g. 28-day completion required). Never flag Guide Price as HIGH on its own.
- IMPORTANT: SQUARE FOOTAGE. Only use a square footage figure if it is EXPLICITLY stated in the listing text (e.g. "1,180 sq ft", "110 sqm", or a PropertyData FLOOR AREAS figure for this exact property). NEVER estimate, infer, calculate, or assume square footage from bedroom count, property type, room dimensions, or general knowledge. If sq ft is not explicitly stated: set property.sqft to 0, set metrics.pricePerSqFt to 0, set areaContext.priceVsAreaPercent to null, and anywhere price per sq ft would otherwise be referenced (areaContext.comparableNote, scoreReasons.valueForMoney, redFlags details, etc.) include this exact sentence verbatim instead of any £/sqft figure: "Square footage is typically shown on the listing's floor plan. Please enter it in the sq ft input field below for accurate price per sq ft analysis. If no floor plan is available, ensure you request accurate square footage data from the agent — this is a key part of any property analysis and essential for assessing whether you are buying at the right price per square foot." Do not produce any estimated or assumed £/sqft number under any circumstances when sq ft is unknown.
- IMPORTANT: MISSING SQ FT IS NOT A RED FLAG. Square footage is almost never included in Rightmove listing text — it is standard UK practice for sq ft to appear on the floorplan only, which is not passed to you as text. Therefore: (a) NEVER generate a red flag, transparency issue, or risk note about sq ft being missing from the listing description. (b) NEVER lower the listingTransparency sub-score because sq ft is absent from the text. (c) Assume sq ft exists on the floorplan and rely on the standard prompt to the user to enter it (see the SQUARE FOOTAGE rule above). (d) Only treat missing sq ft as genuinely suspicious or as a transparency red flag if there is EXPLICIT evidence the agent is withholding it — for example the agent literally answers "Ask agent" to a size field, OR the listing has no floorplan at all (i.e. "FLOOR PLAN PRESENT: no" is explicitly present). In those narrow cases a LOW or MEDIUM transparency note is acceptable. Never use missing sq ft as a contributing factor to a low listingTransparency score unless a floorplan is confirmed absent.
- IMPORTANT: Floor plans. If the listing content begins with or contains a line like "FLOOR PLAN PRESENT: yes" (injected by our scraper after detecting a floor plan image, a "Floorplan" tab, or a floorplan asset on the listing page), the listing HAS a floor plan — do NOT generate any "no floor plan provided", "missing floor plan", or similar red flag under any circumstances. Only flag a missing floor plan if the line "FLOOR PLAN PRESENT: no" is explicitly present, or if there is no FLOOR PLAN PRESENT line at all AND the listing description itself gives no indication of a floor plan. Floor plan images are not passed to you as text, so absence of mention in the listing description is not evidence of absence.
- Tailor 8 viewing questions to specific things in this listing.
- EPC: extract a rating from the listing if present ("EPC rating D" / "EPC Rating: D"). Otherwise return epc: null. If found, populate rating, score, potentialRating, estimatedAnnualEnergyCost where visible (else null) and ALWAYS write a 2-3 sentence commentary tailored to size and rating.
- Be direct and useful — this buyer is about to spend hundreds of thousands of pounds.
- DATES: Never assume a date is a typo or error simply because it falls in the current or future year. If the listing states a date in 2026 or later, accept it as written — do not suggest it may be a typo for a prior year. Only flag a date as suspicious if it is logically impossible (e.g. a future date for a past event that cannot have occurred yet, such as a "sold" date that has not happened).
- Populate sellerMotivation based on days on market, reductions, chain status, language urgency. Score 1-10, label Low/Moderate/High/Very High, signals as short concrete strings, 2-3 sentence commentary.
- Populate viewingChecklist with 8-15 specific actionable items (each in category Structure/Legal/Running costs/Negotiation/Practical, plus a one-sentence "why").
- Populate renovationCosts only for issues identified. estimatedCost as "£15,000 – £25,000" style range. priority is one of "High priority", "Medium priority", "Low priority". For renovation priority: use "High priority" for items that affect safety, mortgageability, or immediate habitability; "Medium priority" for items that affect comfort, energy efficiency, or resale value within 5 years; "Low priority" for cosmetic or lifestyle improvements the buyer may choose to defer or skip entirely. Never use "Essential" as this implies no choice — buyers may choose to accept any condition. Sum totalEstimatedMin/Max. 2-3 sentence commentary. If none, items: [], totals: 0.

Always respond with ONLY a single valid JSON object matching this exact shape (no markdown, no commentary, no code fences):
{
  "property": { "address": string, "price": number, "beds": number, "baths": number, "type": string, "sqft": number, "listingUrl": string },
  "score": number,
  "scoreLabel": string,
  "subScores": { "valueForMoney": number, "locationQuality": number, "listingTransparency": number, "marketTiming": number, "riskLevel": number, "resalePotential": number },
  "scoreReasons": { "valueForMoney": string, "locationQuality": string, "listingTransparency": string, "marketTiming": string, "riskLevel": string, "resalePotential": string },
  "metrics": { "pricePerSqFt": number, "daysOnMarket": number, "councilTaxBand": string, "estimatedStampDuty": number },
  "epc": { "rating": string|null, "score": number|null, "potentialRating": string|null, "estimatedAnnualEnergyCost": string|null, "commentary": string } | null,
  "priceHistory": null,

  "floodRisk": null,
  "areaContext": { "avgPricePerSqFtArea": number|null, "avgSoldPriceArea": number|null, "priceVsAreaPercent": number|null, "areaDescription": string, "comparableNote": string },
  "redFlags": [ { "severity": "high"|"medium"|"low", "title": string, "detail": string } ],
  "costs": { "purchasePrice": number, "stampDuty": number, "legalFees": number, "surveyFees": number, "mortgageFees": number, "totalUpfront": number, "monthlyMortgage": number, "mortgageAssumptions": string },
  "viewingQuestions": string[],
  "negotiation": { "isAuction": boolean, "maxBid": number, "recommendedOffer": { "low": number, "high": number }, "rationale": string, "leverage": string[] },
  "sellerMotivation": { "score": number, "label": "Low"|"Moderate"|"High"|"Very High", "signals": string[], "commentary": string },
  "viewingChecklist": { "items": [{ "category": "Structure"|"Legal"|"Running costs"|"Negotiation"|"Practical", "item": string, "why": string }] },
  "renovationCosts": { "items": [{ "issue": string, "estimatedCost": string, "priority": "High priority"|"Medium priority"|"Low priority", "notes": string }], "totalEstimatedMin": number, "totalEstimatedMax": number, "commentary": string },
  "planningReference": { "found": boolean, "reference": string|null, "relatesTo": string|null, "applicationType": string|null, "isNeighbouring": boolean, "commentary": string|null } | null,
  "comparables": []
}

PLANNING REFERENCE: Detect any UK planning reference numbers in the listing text (format: XX/XXXXX/XXX e.g. 24/01893/FUL, also older XXXX/XXXX). Look near the words: planning, permission, reference, application, consent, approval. If found, populate planningReference with the reference, what it relates to (e.g. "rear kitchen extension"), the applicationType (Householder | Full Planning | Change of Use | Listed Building Consent | Unknown), whether it is for this property or a neighbouring property (isNeighbouring: true if the listing context indicates the application is on a next-door / adjacent property rather than the subject property), and 2-3 sentences of commentary on what this means for the buyer including what documents to request from the seller's solicitors (planning decision notice, approved drawings, building regs completion certificate). If no planning reference is present, return planningReference: null. Do NOT invent a reference number.

PROPERTYDATA CONTEXT: At the top of the listing content you will find official PropertyData API results. Use these as ground truth facts — they override any estimates you would otherwise make:
- SOLD PRICES: Use these for price history section and comparable analysis. These are real Land Registry transactions.
- FLOOR AREAS: If the listing says "Ask agent" for sq ft but floor areas data is available, use the most recent floor area for this property type in the postcode.
- CAPITAL GROWTH: Use for area pricing analysis commentary — quote the actual growth percentage.
- FLOOD RISK: Use PropertyData flood risk data instead of estimating. Quote the actual risk level.
- LISTED BUILDINGS: If this property appears in listed buildings data, flag it and set listingTransparency lower if the listing does not mention it.
- CONSERVATION AREA: If in a conservation area, mention implications for extensions and alterations.
- PLANNING APPLICATIONS: Use recent planning applications for context. If there are nearby large developments, flag as a consideration.
- CRIME: Use actual crime data for area pricing analysis. If crime is notably high, flag it.
- INTERNET SPEED: Quote actual speeds in area pricing analysis.
- SCHOOLS: Use actual school data with Ofsted ratings.
- ENERGY EFFICIENCY: If EPC data is available from PropertyData, use it instead of extracting from listing text.

If a field is unknown, use 0 for numbers, "Unknown" for strings, and never invent precise comparables you have no basis for.`;

// ---------- JSON repair ----------
function cleanResponse(raw: string): string {
  return raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
}

function tryRepairJson(text: string): string {
  let s = text;
  const lastComma = s.lastIndexOf(",");
  const lastBrace = s.lastIndexOf("}");
  if (lastBrace < lastComma) s = s.slice(0, lastComma);
  let curly = 0,
    square = 0,
    inStr = false,
    esc = false;
  for (const ch of s) {
    if (esc) {
      esc = false;
      continue;
    }
    if (ch === "\\") {
      esc = true;
      continue;
    }
    if (ch === '"') {
      inStr = !inStr;
      continue;
    }
    if (inStr) continue;
    if (ch === "{") curly++;
    else if (ch === "}") curly--;
    else if (ch === "[") square++;
    else if (ch === "]") square--;
  }
  if (inStr) s += '"';
  while (square-- > 0) s += "]";
  while (curly-- > 0) s += "}";
  return s;
}

function parseWithRepair(raw: string): unknown {
  const cleaned = cleanResponse(raw);
  if (!cleaned.endsWith("}")) {
    console.warn("[analyse-listing] response truncated; repairing");
    return JSON.parse(tryRepairJson(cleaned));
  }
  try {
    return JSON.parse(cleaned);
  } catch (e) {
    console.warn("[analyse-listing] parse failed; repairing", e);
    return JSON.parse(tryRepairJson(cleaned));
  }
}

// ---------- Claude call ----------
async function callClaude(
  system: string,
  userContent: string,
  maxTokens: number,
): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-5",
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: userContent }],
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Claude API ${res.status}: ${body.slice(0, 500)}`);
  }
  const data = await res.json();
  const block = Array.isArray(data?.content) ? data.content[0] : null;
  return block?.type === "text" ? block.text : "";
}

// ---------- External APIs (postcode-driven) ----------
const POSTCODE_RE = /[A-Z]{1,2}[0-9][0-9A-Z]?\s?[0-9][A-Z]{2}/i;
// Outward-only (e.g. "BA1", "SW1A", "EC1"): a postcode area + district with NO inward part.
const PARTIAL_POSTCODE_RE = /\b([A-Z]{1,2}[0-9][0-9A-Z]?)\b(?!\s?[0-9][A-Z]{2})/i;

function extractPostcode(text: string): string | null {
  const m = text.match(POSTCODE_RE);
  return m ? m[0].toUpperCase().trim() : null;
}

function extractPartialPostcode(text: string): string | null {
  if (!text) return null;
  const m = text.match(PARTIAL_POSTCODE_RE);
  return m ? m[1].toUpperCase().trim() : null;
}

// Ask Claude to infer the most likely full postcode from the listing's address.
// Used when the listing only exposes a partial postcode (e.g. "BA1") so we can
// still run the postcode-driven PropertyData calls. Returns a normalised
// "OUTWARD INWARD" postcode or null if Claude cannot make a confident guess.
async function inferPostcodeFromAddress(
  listingContent: string,
  partialHint: string | null,
): Promise<string | null> {
  if (!ANTHROPIC_API_KEY) return null;
  // Keep the prompt small — first 1500 chars typically contains the title /
  // address block. Claude only needs the location signal, not the full advert.
  const snippet = listingContent.slice(0, 1500);
  const hint = partialHint ? `\n\nPartial postcode found in the listing: ${partialHint}` : "";
  const prompt = `Based on this UK property listing, what is the most likely FULL postcode for the property?${hint}\n\nListing excerpt:\n${snippet}\n\nReturn ONLY the postcode in standard UK format (e.g. "BA1 5NW"), nothing else. If you cannot make a confident guess, return "UNKNOWN".`;
  try {
    const text = await callClaude(
      "You are a UK postcode lookup. Return only a postcode in standard UK format, or UNKNOWN.",
      prompt,
      40,
    );
    const trimmed = (text ?? "").trim().toUpperCase();
    if (!trimmed || trimmed.startsWith("UNKNOWN")) return null;
    const m = trimmed.match(POSTCODE_RE);
    if (!m) return null;
    const raw = m[0].replace(/\s+/g, "");
    return `${raw.slice(0, -3)} ${raw.slice(-3)}`;
  } catch (err) {
    console.warn("[analyse-listing] inferPostcodeFromAddress failed", err);
    return null;
  }
}

// ---------- PropertyData API ----------
const PROPERTYDATA_API_KEY = Deno.env.get("PROPERTYDATA_API_KEY") ?? "";
const PD_BASE = "https://api.propertydata.co.uk";
const PD_ENDPOINTS = [
  "sold-prices",
  "flood-risk",
  "schools",
  "crime",
  "internet-speed",
  "growth",
  "planning-applications",
  "listed-buildings",
  "conservation-area",
  "ptal",
  "prices-per-sqf",
  "sold-prices-per-sqf",
] as const;

const LONDON_POSTCODE_AREAS = new Set([
  "E", "EC", "W", "WC", "N", "NW", "SE", "SW",
  "WD", "BR", "CR", "DA", "EN", "HA", "IG", "KT", "RM", "SM", "TW", "UB",
]);
function isLondonPostcode(pc: string): boolean {
  const m = pc.toUpperCase().trim().match(/^[A-Z]{1,2}/);
  return m ? LONDON_POSTCODE_AREAS.has(m[0]) : false;
}

type PdKey = typeof PD_ENDPOINTS[number];
type PdResults = Partial<Record<PdKey, unknown>>;

async function fetchPropertyDataAll(postcode: string): Promise<PdResults> {
  if (!PROPERTYDATA_API_KEY) {
    console.warn("[analyse-listing] PROPERTYDATA_API_KEY missing");
    return {};
  }
  const pc = encodeURIComponent(postcode);
  const london = isLondonPostcode(postcode);
  const settled = await Promise.allSettled(
    PD_ENDPOINTS.map((ep) => {
      // Skip /ptal entirely outside London — it only returns data for London postcodes.
      if (ep === "ptal" && !london) {
        return Promise.resolve(null);
      }
      return fetch(`${PD_BASE}/${ep}?key=${PROPERTYDATA_API_KEY}&postcode=${pc}`).then((r) => r.json());
    }),
  );
  const out: PdResults = {};
  PD_ENDPOINTS.forEach((ep, i) => {
    const s = settled[i];
    if (s.status === "fulfilled") {
      out[ep] = s.value;
    } else {
      console.warn(`[analyse-listing] propertydata ${ep} failed`, s.reason);
      out[ep] = null;
    }
  });
  return out;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function pdData(raw: any): any {
  return raw && typeof raw === "object" ? raw.data ?? null : null;
}

// ---------- PropertyData → frontend shape mappers ----------
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapPdSchools(raw: any) {
  if (!raw || raw.status !== "success" || !raw.data) return null;
  // PropertyData /schools returns ofsted rating under a few possible keys
  // depending on the school type. Try them all and normalise to a label.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const readOfsted = (s: any): number | null => {
    const candidates = [
      s.ofsted_rating,
      s.ofstedRating,
      s.ofsted,
      s.ofsted_overall_effectiveness,
      s.overall_effectiveness,
      s.rating,
      s?.ofsted_report?.overall_effectiveness,
      s?.ofsted_report?.rating,
      s?.ofsted_report?.outcome,
      s.ofsted_outcome,
      s.last_inspection?.overall_effectiveness,
    ];
    const labelMap: Record<string, number> = {
      "outstanding": 1,
      "good": 2,
      "requires improvement": 3,
      "requires_improvement": 3,
      "requiresimprovement": 3,
      "satisfactory": 3,
      "inadequate": 4,
      "serious weaknesses": 4,
      "special measures": 4,
    };
    for (const c of candidates) {
      if (c == null) continue;
      const str = String(c).trim();
      if (!str || /^(null|n\/?a|none|unknown)$/i.test(str)) continue;
      // Numeric 1–4
      if (/^[1-4]$/.test(str)) return Number(str);
      const key = str.toLowerCase();
      if (labelMap[key] != null) return labelMap[key];
      // Try partial match
      for (const [k, v] of Object.entries(labelMap)) {
        if (key.includes(k)) return v;
      }
    }
    return null;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const collect = (arr: any[], indep: boolean) =>
    (Array.isArray(arr) ? arr : []).map((s) => {
      const phaseRaw = String(s.phase ?? "").toLowerCase();
      const phase: "primary" | "secondary" | "other" =
        phaseRaw.includes("primary") || /^\d+\s*-\s*1[01]$/.test(phaseRaw)
          ? "primary"
          : phaseRaw.includes("secondary") || /1[12]\s*-\s*1[6-9]/.test(phaseRaw)
            ? "secondary"
            : "other";
      return {
        name: String(s.name ?? "Unknown"),
        ofstedRating: readOfsted(s),
        schoolType: indep ? "Independent" : (s.type ?? null),
        phase,
        distanceMiles: Number(s.distance ?? 0) || 0,
        urn: s.urn ?? s.URN ?? s.school_urn ?? s.id ?? null,
      };
    });
  const all = [
    ...collect(raw.data?.state?.nearest, false),
    ...collect(raw.data?.independent?.nearest, true),
  ].sort((a, b) => a.distanceMiles - b.distanceMiles);
  // Cap at 5 results: closest 3 primary + closest 2 secondary.
  const primary = all.filter((s) => s.phase === "primary").slice(0, 3);
  const secondary = all.filter((s) => s.phase === "secondary").slice(0, 2);
  let schools = [...primary, ...secondary].sort((a, b) => a.distanceMiles - b.distanceMiles);
  if (!schools.length) {
    // Fallback: if phases didn't classify, just take the 5 closest overall.
    schools = all.slice(0, 5);
  }
  if (!schools.length) return null;
  return { schools, unavailable: false, aiSourced: false };
}

// ---------- Ofsted rating lookup ----------
// Maps an Ofsted "overall effectiveness" string/number to our 1-4 scale.
function giasRatingToNumber(val: unknown): number | null {
  if (val == null) return null;
  const s = String(val).trim().toLowerCase();
  if (!s || /^(null|n\/?a|none|unknown|not yet|no judgement)/i.test(s)) return null;
  if (/^[1-4]$/.test(s)) return Number(s);
  if (s.includes("outstanding")) return 1;
  if (s.includes("good")) return 2;
  if (s.includes("requires improvement") || s === "satisfactory") return 3;
  if (s.includes("inadequate") || s.includes("serious weakness") || s.includes("special measures")) return 4;
  return null;
}

const giasCache = new Map<string, number | null>();

// Normalise a school name for fuzzy matching: lowercase, expand common
// abbreviations, strip punctuation, and drop generic stopwords.
const GIAS_STOPWORDS = new Set([
  "school", "schools", "academy", "the", "of", "and", "a", "for",
  "community", "foundation", "voluntary", "aided", "controlled",
]);
function normaliseSchoolName(raw: string): string {
  let s = " " + raw.toLowerCase() + " ";
  s = s.replace(/[\u2018\u2019']/g, "");
  // Expand common abbreviations (word-boundaries on both sides).
  const subs: [RegExp, string][] = [
    [/\bst\.?\b/g, "saint"],
    [/\bsts\.?\b/g, "saints"],
    [/\bc\.?\s*of\s*e\.?\b/g, "church of england"],
    [/\bcofe\b/g, "church of england"],
    [/\bce\b/g, "church of england"],
    [/\brc\b/g, "roman catholic"],
    [/\bjnr\b|\bjr\b/g, "junior"],
    [/\bpri\b/g, "primary"],
    [/\bsec\b/g, "secondary"],
    [/\binf\b/g, "infant"],
    [/\bnurs\b/g, "nursery"],
  ];
  for (const [re, to] of subs) s = s.replace(re, to);
  s = s.replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
  return s;
}
function significantWords(name: string): string[] {
  return normaliseSchoolName(name).split(" ").filter((w) => w && !GIAS_STOPWORDS.has(w));
}
// True if all significant words from `query` appear in `candidate`.
function fuzzyNameMatch(query: string, candidate: string): boolean {
  const q = significantWords(query);
  if (!q.length) return false;
  const cSet = new Set(significantWords(candidate));
  return q.every((w) => cSet.has(w));
}

// Scrapes the Ofsted reports site (reports.ofsted.gov.uk) — the official
// public source of Ofsted ratings. The DfE GIAS JSON APIs do not expose
// inspection outcomes publicly, but the reports site does and is stable.
async function lookupGiasOfsted(name: string, urn: string | null, postcode: string | null): Promise<number | null> {
  const cacheKey = urn ? `urn:${urn}` : `name:${normaliseSchoolName(name)}|${(postcode ?? "").toLowerCase()}`;
  if (giasCache.has(cacheKey)) return giasCache.get(cacheKey) ?? null;

  const ua = "Mozilla/5.0 (compatible; RoovrBot/1.0)";
  const fetchText = async (url: string): Promise<string | null> => {
    try {
      const r = await fetch(url, {
        headers: { "User-Agent": ua, "Accept": "text/html,application/xhtml+xml" },
        redirect: "follow",
        signal: AbortSignal.timeout(7000),
      });
      if (!r.ok) return null;
      return await r.text();
    } catch {
      return null;
    }
  };

  // Parse search-result HTML into { providerPath, name } entries so we can
  // fuzzy-match candidate names rather than blindly taking the first hit.
  const parseSearchResults = (html: string): { providerPath: string; name: string; urn: string }[] => {
    const out: { providerPath: string; name: string; urn: string }[] = [];
    const re = /<a[^>]+href="(\/provider\/(\d+)\/(\d+))"[^>]*>([\s\S]*?)<\/a>/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null) {
      const text = m[4].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      if (!text) continue;
      out.push({ providerPath: m[1], urn: m[3], name: text });
    }
    return out;
  };

  let rating: number | null = null;
  let providerPath: string | null = null;
  try {
    // 1. URN-first lookup — most reliable, no name matching needed.
    if (urn) {
      const html = await fetchText(`https://reports.ofsted.gov.uk/search?q=${encodeURIComponent(urn)}&start=0&rows=10`);
      if (html) {
        const results = parseSearchResults(html);
        const hit = results.find((r) => r.urn === String(urn));
        if (hit) providerPath = hit.providerPath;
      }
    }

    // 2. Fall back to name search with fuzzy matching against result titles.
    if (!providerPath && name) {
      const term = postcode ? `${name} ${postcode}` : name;
      const html = await fetchText(`https://reports.ofsted.gov.uk/search?q=${encodeURIComponent(term)}&start=0&rows=10`);
      if (html) {
        const results = parseSearchResults(html);
        // Prefer a result whose name contains all significant words from the query.
        const hit = results.find((r) => fuzzyNameMatch(name, r.name))
          // Or vice versa (PropertyData name is a longer variant of GIAS name).
          ?? results.find((r) => fuzzyNameMatch(r.name, name));
        if (hit) providerPath = hit.providerPath;
        else if (results.length) {
          console.log(`[gias] no fuzzy match for "${name}" (${postcode ?? "no pc"}); top results:`,
            results.slice(0, 3).map((r) => r.name));
        } else {
          console.log(`[gias] no search results for "${name}" (${postcode ?? "no pc"})`);
        }
      }
    }

    if (providerPath) {
      const html = await fetchText(`https://reports.ofsted.gov.uk${providerPath}`);
      if (html) {
        const sel = html.match(/rating--selected[^>]*>\s*<span>([^<]+)<\/span>/i);
        if (sel) rating = giasRatingToNumber(sel[1]);
        if (rating == null) {
          const alt = html.match(/aria-current="true"[^>]*>\s*<span>([^<]+)<\/span>/i);
          if (alt) rating = giasRatingToNumber(alt[1]);
        }
        if (rating == null) {
          console.log(`[gias] provider page found but no rating parsed: ${providerPath} (school "${name}")`);
        }
      }
    }
  } catch (e) {
    console.log(`[gias] lookup error for "${name}":`, (e as Error).message);
    rating = null;
  }

  if (rating == null) {
    console.log(`[gias] unmatched: name="${name}" urn=${urn ?? "n/a"} postcode=${postcode ?? "n/a"}`);
  }

  giasCache.set(cacheKey, rating);
  return rating;
}

// Enrich the mapped schools with Ofsted ratings from GIAS in parallel.
// Only looks up schools that PropertyData didn't already supply a rating for.
async function enrichSchoolsWithGias(
  mapped: { schools: { name: string; ofstedRating: number | null; schoolType: string | null; phase: string; distanceMiles: number; urn?: string | null }[] } | null,
  postcode: string | null,
) {
  if (!mapped?.schools?.length) return mapped;
  const updated = await Promise.all(mapped.schools.map(async (s) => {
    if (s.ofstedRating != null) return s;
    const rating = await lookupGiasOfsted(s.name, s.urn ?? null, postcode);
    return { ...s, ofstedRating: rating };
  }));
  return { ...mapped, schools: updated };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapPdCrime(raw: any) {
  if (!raw || raw.status !== "success") return null;
  const total = Number(raw.crimes_last_12m ?? 0) || 0;
  const types = (raw.types && typeof raw.types === "object") ? raw.types : {};
  const topCategories = Object.entries(types)
    .map(([category, count]) => ({
      category,
      count: Number(count) || 0,
      label: category,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);
  const ratingRaw = String(raw.crime_rating ?? "").toLowerCase();
  const riskLevel: "Low" | "Moderate" | "High" | "Very High" =
    ratingRaw.includes("very high") ? "Very High"
    : ratingRaw.includes("high") ? "High"
    : ratingRaw.includes("average") || ratingRaw.includes("moderate") ? "Moderate"
    : "Low";
  const perThousand = Number(raw.crimes_per_thousand ?? 0) || 0;
  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  return {
    totalCrimes: total,
    month,
    topCategories,
    riskLevel,
    commentary: `${total.toLocaleString("en-GB")} crimes recorded in the last 12 months around this postcode (${perThousand} per 1,000 residents). PropertyData rates this area as "${raw.crime_rating ?? "Unknown"}".`,
    autoRedFlag: riskLevel === "High" || riskLevel === "Very High",
    coordinates: null,
    unavailable: false,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapPdBroadband(raw: any) {
  if (!raw || raw.status !== "success" || !raw.internet) return null;
  const i = raw.internet;
  const gigabit = Number(i.gigabit_availability ?? 0) || 0;
  const ufbb = Number(i.UFBB_availability ?? 0) || 0;
  const sfbb = Number(i.SFBB_availability ?? 0) || 0;
  const belowUso = Number(i.premises_below_uso ?? 0) || 0;
  const connectionType: "Full fibre" | "Fibre to cabinet" | "ADSL" | "Limited" =
    gigabit >= 50 ? "Full fibre"
    : ufbb >= 50 ? "Full fibre"
    : sfbb >= 50 ? "Fibre to cabinet"
    : belowUso > 50 ? "Limited"
    : "ADSL";
  const speedRating: "Excellent" | "Good" | "Average" | "Poor" =
    gigabit >= 50 ? "Excellent"
    : ufbb >= 80 ? "Excellent"
    : sfbb >= 80 ? "Good"
    : sfbb >= 30 ? "Average"
    : "Poor";
  const downloadSpeed =
    gigabit >= 50 ? "1 Gbps+ available"
    : ufbb >= 50 ? "300+ Mbps (ultrafast)"
    : sfbb >= 50 ? "30–80 Mbps (superfast)"
    : "Under 30 Mbps typical";
  return {
    downloadSpeed,
    uploadSpeed: connectionType === "Full fibre" ? "100+ Mbps" : connectionType === "Fibre to cabinet" ? "10–20 Mbps" : "Under 10 Mbps",
    connectionType,
    suitableForRemoteWork: speedRating === "Excellent" || speedRating === "Good",
    mobileSignal: "Good" as const,
    commentary: `Ultrafast (>300 Mbps) available to ${ufbb.toFixed(0)}% of premises in this postcode, superfast to ${sfbb.toFixed(0)}%, gigabit to ${gigabit.toFixed(0)}%. Source: PropertyData / Ofcom.`,
    speedRating,
    source: "PropertyData / Ofcom",
    unavailable: false,
    autoRedFlag: connectionType === "Limited" || speedRating === "Poor",
  };
}

// PropertyData /ptal → PTAL (Public Transport Accessibility Level) for London postcodes.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapPdPtal(raw: any) {
  if (!raw || raw.status !== "success") return null;
  const data = raw.data ?? raw;
  if (!data) return null;
  const grade = String(
    data.ptal ?? data.PTAL ?? data.ptal_grade ?? data.grade ?? data.rating ?? "",
  ).trim();
  if (!grade) return null;
  const bandMatch = grade.match(/^(\d)/);
  const band = bandMatch ? Number(bandMatch[1]) : null;
  const descriptions: Record<number, { label: string; explanation: string }> = {
    0: { label: "Very poor", explanation: "Very limited access to public transport — expect to rely on a car." },
    1: { label: "Poor", explanation: "Limited bus or tube access within walking distance." },
    2: { label: "Poor", explanation: "Some bus routes nearby but infrequent service and few rail options." },
    3: { label: "Moderate", explanation: "Reasonable bus access and a tube or rail station within walking distance." },
    4: { label: "Good", explanation: "Good mix of frequent buses and rail/tube connections within walking distance." },
    5: { label: "Very good", explanation: "Excellent bus and tube/rail access — most journeys easy without a car." },
    6: { label: "Excellent", explanation: "Multiple frequent bus and tube/rail connections within walking distance — among the best in London." },
  };
  const meta = band != null ? descriptions[band] : null;
  return {
    grade,
    band,
    label: meta?.label ?? (data.description ? String(data.description) : "Unknown"),
    explanation: meta?.explanation ?? "Public transport accessibility score from Transport for London.",
    source: "PropertyData / TfL PTAL",
  };
}

// PropertyData /prices-per-sqf or /sold-prices-per-sqf → { average, low, high } in £/sqft.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapPdPpsf(raw: any): { average: number; low: number | null; high: number | null; points: number | null } | null {
  if (!raw || raw.status !== "success") return null;
  const d = raw.data ?? raw;
  if (!d) return null;
  const num = (v: unknown) => {
    const n = typeof v === "string" ? Number(v) : (v as number);
    return typeof n === "number" && isFinite(n) && n > 0 ? n : null;
  };
  const average = num(d.average ?? d.avg ?? d.mean ?? d.average_price_per_sqf ?? d.ppsf_average);
  if (average == null) return null;
  return {
    average,
    low: num(d.low ?? d.min ?? d.ppsf_low),
    high: num(d.high ?? d.max ?? d.ppsf_high),
    points: num(d.points_analysed ?? d.points ?? d.transactions),
  };
}

function buildPropertyDataContext(pd: PdResults): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const slice = (v: any, n: number) => (Array.isArray(v) ? v.slice(0, n) : v ?? null);
  return `PROPERTYDATA API RESULTS (official data — use these facts in your analysis):

SOLD PRICES (last 10 sales in this postcode):
${JSON.stringify(slice(pdData(pd["sold-prices"]), 10) || [])}

CAPITAL GROWTH (area — use for area pricing analysis commentary and resale potential scoring):
${JSON.stringify(pdData(pd["growth"]) || null)}

FLOOD RISK:
${JSON.stringify(pdData(pd["flood-risk"]) || null)}

LISTED BUILDINGS:
${JSON.stringify(pdData(pd["listed-buildings"]) || null)}

CONSERVATION AREA (if true, add a red flag noting renovation/extension restrictions):
${JSON.stringify(pdData(pd["conservation-area"]) || null)}

PLANNING APPLICATIONS (recent nearby — flag any large/relevant ones as a consideration):
${JSON.stringify(slice(pdData(pd["planning-applications"]), 5) || [])}

CRIME DATA:
${JSON.stringify(pdData(pd["crime"]) || null)}

INTERNET SPEED:
${JSON.stringify(pdData(pd["internet-speed"]) || null)}

SCHOOLS (closest 5: 3 primary + 2 secondary):
${JSON.stringify(pdData(pd["schools"]) || [])}

LIVE LOCAL ASKING £/SQFT (current market — use as secondary reference):
${JSON.stringify(mapPdPpsf(pd["prices-per-sqf"]) || null)}

LOCAL SOLD £/SQFT (most recent sold transactions — USE AS THE PRIMARY avgPricePerSqFtArea figure when available, and base priceVsAreaPercent on this):
${JSON.stringify(mapPdPpsf(pd["sold-prices-per-sqf"]) || null)}
`;
}

const PD_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getCachedPropertyData(supabase: any, postcode: string): Promise<PdResults | null> {
  try {
    const { data, error } = await supabase
      .from("property_data_cache")
      .select("data, fetched_at")
      .eq("postcode", postcode)
      .maybeSingle();
    if (error || !data) return null;
    const age = Date.now() - new Date(data.fetched_at).getTime();
    if (age > PD_CACHE_TTL_MS) return null;
    return data.data as PdResults;
  } catch (e) {
    console.warn("[analyse-listing] pd cache read failed", e);
    return null;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function setCachedPropertyData(supabase: any, postcode: string, pd: PdResults) {
  try {
    await supabase
      .from("property_data_cache")
      .upsert({ postcode, data: pd, fetched_at: new Date().toISOString() }, { onConflict: "postcode" });
  } catch (e) {
    console.warn("[analyse-listing] pd cache write failed", e);
  }
}

// ---------- Main job runner ----------
async function runJob(jobId: string, url: string, pastedText: string) {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    let listingContent = pastedText?.trim() ?? "";
    let floorPlanFlag: "yes" | "unknown" = "unknown";
    if (!listingContent && url) {
      validateUrl(url);
      console.log(`[analyse-listing] fetching ${url}`);
      const html = await fetchListingHtml(url);
      if (detectFloorPlan(html)) floorPlanFlag = "yes";
      listingContent = htmlToListingText(html);
      console.log(`[analyse-listing] listing length: ${listingContent.length}, floor plan: ${floorPlanFlag}`);
    }
    if (listingContent) {
      listingContent = `FLOOR PLAN PRESENT: ${floorPlanFlag}\n\n${listingContent}`;
    }
    if (!listingContent || listingContent.length < 100) {
      throw new Error(
        "FETCH_BLOCKED: We couldn't automatically read this listing. You can paste the listing description below to get your full analysis.",
      );
    }

    // PropertyData fetches in parallel (Promise.allSettled inside fetchPropertyDataAll)
    // typically resolve in a few seconds, so we await them before calling Claude in
    // order to feed conservation-area / planning-applications / growth context into
    // the prompt. Claude is by far the slowest step (~30–60s) so total wall time is
    // dominated by it and stays well under the 90s target.
    let postcode = extractPostcode(listingContent);
    let inferredPostcode = false;
    let partialPostcode: string | null = null;
    if (!postcode) {
      partialPostcode = extractPartialPostcode(listingContent);
      // Ask Claude to guess the full postcode from the address before falling
      // back to the manual input prompt in the UI.
      const guess = await inferPostcodeFromAddress(listingContent, partialPostcode);
      if (guess) {
        console.log(`[analyse-listing] inferred postcode ${guess} (partial hint: ${partialPostcode ?? "none"})`);
        postcode = guess;
        inferredPostcode = true;
      }
    }
    let pd: PdResults = {};
    if (postcode) {
      const cached = await getCachedPropertyData(supabase, postcode);
      if (cached) {
        console.log(`[analyse-listing] propertydata cache hit ${postcode}`);
        pd = cached;
      } else {
        try {
          pd = await fetchPropertyDataAll(postcode);
          await setCachedPropertyData(supabase, postcode, pd);
        } catch (e) {
          console.warn("[analyse-listing] propertydata fetch failed", e);
          pd = {};
        }
      }
    }

    const propertyDataContext = postcode ? buildPropertyDataContext(pd) : "";
    const userContent = `${propertyDataContext}\nListing URL: ${url || "(pasted text only)"}\n\nListing content:\n${listingContent}`;

    const todayStr = new Date().toLocaleDateString("en-GB", {
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: "Europe/London",
    });
    const dateLine = `Today's date is ${todayStr}. Use this as your reference for all date-related reasoning. Do not flag dates in the current year as errors or typos unless they are logically impossible.\n\n`;
    const systemPrompt = dateLine + SYSTEM_PROMPT;

    let parsed: Record<string, unknown>;
    try {
      console.log("[analyse-listing] calling Claude (primary)");
      const text = await callClaude(systemPrompt, userContent, 6000);
      console.log(`[analyse-listing] Claude response length: ${text.length}`);
      parsed = parseWithRepair(text) as Record<string, unknown>;
    } catch (primaryErr) {
      console.error("[analyse-listing] primary parse failed, retrying simplified", primaryErr);
      const simplified =
        systemPrompt +
        "\n\nIMPORTANT OVERRIDE: Omit the renovationCosts field entirely from your JSON response. Set it to null.";
      const text = await callClaude(simplified, userContent, 6000);
      parsed = parseWithRepair(text) as Record<string, unknown>;
      parsed.renovationCosts = null;
    }

    // Make sure listingUrl is set on the property block.
    const property = (parsed.property ?? {}) as Record<string, unknown>;
    if (!property.listingUrl) property.listingUrl = url || "";
    parsed.property = property;

    // Merge PropertyData results into the saved analysis JSON.
    const mappedPricesPerSqf = mapPdPpsf(pd["prices-per-sqf"]);
    const mappedSoldPricesPerSqf = mapPdPpsf(pd["sold-prices-per-sqf"]);
    parsed.propertyData = {
      soldPrices: pdData(pd["sold-prices"]),
      floodRisk: pdData(pd["flood-risk"]),
      schools: pdData(pd["schools"]),
      crime: pdData(pd["crime"]),
      internetSpeed: pdData(pd["internet-speed"]),
      growth: pdData(pd["growth"]),
      planningApplications: pdData(pd["planning-applications"]),
      listedBuildings: pdData(pd["listed-buildings"]),
      conservationArea: pdData(pd["conservation-area"]),
      ptal: pdData(pd["ptal"]),
      pricesPerSqf: mappedPricesPerSqf,
      soldPricesPerSqf: mappedSoldPricesPerSqf,
    };

    // Map PropertyData payloads into the shapes the frontend renders for
    // nearbySchools / crime / broadband / ptal. Only set when we have real data so
    // the UI can fall back to its "data unavailable" state otherwise.
    const mappedSchools = mapPdSchools(pd["schools"]);
    const enrichedSchools = await enrichSchoolsWithGias(mappedSchools, postcode);
    if (enrichedSchools) parsed.nearbySchools = enrichedSchools;
    const mappedCrime = mapPdCrime(pd["crime"]);
    if (mappedCrime) parsed.crime = mappedCrime;
    const mappedBroadband = mapPdBroadband(pd["internet-speed"]);
    if (mappedBroadband) parsed.broadband = mappedBroadband;
    const mappedPtal = mapPdPtal(pd["ptal"]);
    if (mappedPtal) parsed.ptal = mappedPtal;

    // Override areaContext.avgPricePerSqFtArea with the PropertyData sold £/sqft
    // figure when available — it's the most accurate area benchmark for buyers.
    // Recompute priceVsAreaPercent against the property's own pricePerSqFt.
    if (mappedSoldPricesPerSqf) {
      const ac = (parsed.areaContext ?? {}) as Record<string, unknown>;
      ac.avgPricePerSqFtArea = mappedSoldPricesPerSqf.average;
      const metrics = (parsed.metrics ?? {}) as Record<string, unknown>;
      const propPpsf = Number(metrics.pricePerSqFt);
      if (isFinite(propPpsf) && propPpsf > 0) {
        ac.priceVsAreaPercent = Math.round(
          ((propPpsf - mappedSoldPricesPerSqf.average) / mappedSoldPricesPerSqf.average) * 1000,
        ) / 10;
      }
      parsed.areaContext = ac;
    }

    // Track partial / inferred postcode state so the UI can prompt the user
    // (partial → no usable postcode at all; inferred → we used Claude's guess).
    parsed.partialPostcode = postcode ? null : partialPostcode;
    parsed.inferredPostcode = inferredPostcode || null;
    if (inferredPostcode) {
      parsed.inferredPostcodeValue = postcode;
    } else {
    }

    // Recompute the overall Roovr score as a weighted average of the six
    // sub-scores. Claude tends to anchor the overall figure (commonly 6.8)
    // even when sub-scores vary, so we always derive it deterministically.
    const sub = (parsed.subScores ?? {}) as Record<string, unknown>;
    const weights: Record<string, number> = {
      valueForMoney: 0.25,
      locationQuality: 0.20,
      riskLevel: 0.20,
      resalePotential: 0.15,
      listingTransparency: 0.10,
      marketTiming: 0.10,
    };
    let weightedSum = 0;
    let totalWeight = 0;
    for (const [k, w] of Object.entries(weights)) {
      const v = Number(sub[k]);
      if (isFinite(v) && v > 0) {
        weightedSum += v * w;
        totalWeight += w;
      }
    }
    if (totalWeight > 0) {
      parsed.score = Math.round((weightedSum / totalWeight) * 10) / 10;
    }

    const { error: updErr } = await supabase
      .from("analysis_jobs")
      .update({
        status: "complete",
        result_json: parsed,
        updated_at: new Date().toISOString(),
      })
      .eq("id", jobId);
    if (updErr) throw updErr;
    console.log(`[analyse-listing] job ${jobId} complete`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[analyse-listing] job ${jobId} failed:`, message, err);
    await supabase
      .from("analysis_jobs")
      .update({
        status: "error",
        error: message,
        updated_at: new Date().toISOString(),
      })
      .eq("id", jobId);
  }
}

// ---------- HTTP entrypoint ----------
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  try {
    const body = await req.json();
    const jobId = String(body?.jobId ?? "");
    const url = String(body?.url ?? "");
    const pastedText = String(body?.pastedText ?? body?.text ?? "");
    if (!jobId) {
      return new Response(JSON.stringify({ error: "jobId required" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }
    await runJob(jobId, url, pastedText);
    return new Response(JSON.stringify({ ok: true }), {
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[analyse-listing] handler error", err);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }
});
