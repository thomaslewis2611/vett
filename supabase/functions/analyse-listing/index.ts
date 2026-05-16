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
import { computeWeightedScore } from "../../../src/lib/score.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function scheduleEdgeBackground(promise: Promise<unknown>): void {
  const runtime = (globalThis as unknown as {
    EdgeRuntime?: { waitUntil?: (promise: Promise<unknown>) => void };
  }).EdgeRuntime;

  const guarded = promise.catch((err) => {
    console.error("[analyse-listing] background job crashed", err);
  });

  if (typeof runtime?.waitUntil === "function") {
    runtime.waitUntil(guarded);
    return;
  }

  // Local/dev fallback: keep the promise alive and log any failure.
  void guarded;
}

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
const SYSTEM_PROMPT = `You are Roovr, an expert UK property buyer's analyst surfacing red flags estate agents hide. Analyse Rightmove/Zoopla listings for serious UK buyers.

Rules:
- Read description, captions, key features, agent copy.
- Translate UK euphemisms into honest red flags ("scope to modernise"=dated; "deceptively spacious"=small; "convenient for transport"=noisy; "no chain" can be good or distressed).
- Estimate UK stamp duty at current rates (assume additional/second-property buyer for conservative figure unless stated).
- daysOnMarket: infer from any date in the listing. Compute (today − listing date) → POSITIVE days. A past listing date = days on market, NEVER "in the future". If genuinely no signal, return 0. Never return negative numbers.
- Monthly mortgage: 15% deposit, 25-year term, 4.8% fixed.
- Overall score plus 6 sub-scores out of 10 (one decimal): valueForMoney, locationQuality, listingTransparency, marketTiming, riskLevel (HIGHER=LOWER risk), resalePotential. For each, write scoreReasons.<key> as 2-3 sentences referencing SPECIFIC details from this listing.
- areaContext: avgPricePerSqFtArea, avgSoldPriceArea, priceVsAreaPercent, areaDescription, comparableNote. Use null when unknown. PREFER LOCAL SOLD £/SQFT from PropertyData context (its 'average') as avgPricePerSqFtArea; else estimate. priceVsAreaPercent = ((propertyPpsf - avgPricePerSqFtArea)/avgPricePerSqFtArea)*100, 1dp. If live asking £/sqft is also present, contrast both in areaDescription/comparableNote.
- AUCTION: set negotiation.isAuction true ONLY if listing explicitly contains: auction, auctioneer, lot number, reserve price, unconditional exchange, sold prior to auction, online auction. NEVER infer from "guide price", "offers over", "offers in excess of". When auction: maxBid = single GBP number, recommendedOffer.low=high=maxBid. Otherwise normal offer range (2-8% under asking).
- "Guide Price" is standard UK terminology (esp. Bath/Bristol/South West). With no other distress signals: do NOT generate a red flag for it. If mentioned, max severity LOW, neutral tone, suggest buyer confirm sale method with agent. Only escalate to MEDIUM/HIGH if combined with explicit auction terms, very long days on market, multiple reductions, or unusual completion (e.g. 28-day).
- SQUARE FOOTAGE: only use a figure if EXPLICITLY stated in listing text (e.g. "1,180 sq ft", "110 sqm") or in PropertyData FLOOR AREAS for this exact property. NEVER estimate from beds/type/room dims. If unknown: property.sqft=0, metrics.pricePerSqFt=0, areaContext.priceVsAreaPercent=null, and wherever £/sqft would appear (comparableNote, scoreReasons.valueForMoney, redFlags detail) insert this EXACT sentence verbatim instead: "Square footage is typically shown on the listing's floor plan. Please enter it in the sq ft input field below for accurate price per sq ft analysis. If no floor plan is available, ensure you request accurate square footage data from the agent — this is a key part of any property analysis and essential for assessing whether you are buying at the right price per square foot."
- MISSING SQ FT IS NOT A RED FLAG and must not lower listingTransparency. Sq ft is normally on the floorplan only. Only treat as a transparency issue if the agent literally answers "Ask agent" for size OR "FLOOR PLAN PRESENT: no" is explicit.
- FLOOR PLAN: if "FLOOR PLAN PRESENT: yes" appears, the listing HAS one — never flag missing floor plan. Only flag missing if "FLOOR PLAN PRESENT: no" is explicit, or no FLOOR PLAN PRESENT line AND the description gives no indication.
- 8 viewing questions tailored to specifics in this listing.
- EPC: extract rating if listed ("EPC rating D"); else epc:null. If found, populate rating/score/potentialRating/estimatedAnnualEnergyCost (null where missing) and 2-3 sentence commentary tailored to size+rating.
- DATES: accept dates in current/future year as written; only flag if logically impossible.
- sellerMotivation: score 1-10, label Low/Moderate/High/Very High, signals (short strings), 2-3 sentence commentary.
- viewingChecklist: 8-15 items, category Structure|Legal|Running costs|Negotiation|Practical, plus one-sentence "why".
- renovationCosts: only for identified issues. estimatedCost like "£15,000 – £25,000". priority: "High priority" (safety/mortgageability/habitability), "Medium priority" (comfort/efficiency/5-yr resale), "Low priority" (cosmetic/deferrable). Never "Essential". Sum totalEstimatedMin/Max. 2-3 sentence commentary. If none: items:[], totals:0.
- COSTS — produce a comprehensive cost breakdown. Populate every field in costs:
  • valuationFee: lender's valuation £150–£1,500 by price (~£250 to £250k, ~£400 to £500k, ~£700 to £1m, ~£1,200 above). 0 if cash/remortgage.
  • landRegistryFee: HMLR scale 1 — <£80k=£20; £80k–£100k=£40; £100k–£200k=£95; £200k–£500k=£135; £500k–£1m=£270; >£1m=£455.
  • electronicTransferFee: default 40.
  • removalCosts: £500 flat/small, £800 3-bed, £1,200 larger (+£300 if long distance).
  • indemnityInsurance: 150 if listing mentions planning/extension/conversion/loft/dormer/garage conv/side return; else 0.
  • buildingsInsurance: annual estimate — £200 flat (note in mortgageAssumptions that this is often included in service charge), £350–£600 house.
  • serviceCharge (LEASEHOLD ONLY): 0 freehold; £1,500–£4,000/yr leasehold flat; extract if stated, otherwise estimate and say so.
  • groundRent (LEASEHOLD ONLY): extract if stated; 0 for post-2022 leases. If a new lease shows >£0 ground rent, raise a red flag.
  • leaseholdYears: years remaining on lease if stated. <80 yrs → red flag (mortgageability, extension cost).
  • councilTaxMonthly: from metrics.councilTaxBand using England averages (A≈£1,500, B≈£1,750, C≈£2,000, D≈£2,250, E≈£2,750, F≈£3,250, G≈£3,750, H≈£4,500) ÷ 12.
  • buildingsInsuranceMonthly: buildingsInsurance/12.
  • serviceChargeMonthly: serviceCharge/12 (0 freehold).
  • totalUpfront = purchasePrice + stampDuty + legalFees + surveyFees + mortgageFees + valuationFee + landRegistryFee + electronicTransferFee + removalCosts + indemnityInsurance + buildingsInsurance.
- Be direct — this buyer is about to spend hundreds of thousands.

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
  "costs": { "purchasePrice": number, "stampDuty": number, "legalFees": number, "surveyFees": number, "mortgageFees": number, "valuationFee": number, "landRegistryFee": number, "electronicTransferFee": number, "removalCosts": number, "indemnityInsurance": number, "buildingsInsurance": number, "serviceCharge": number, "groundRent": number, "leaseholdYears": number, "councilTaxMonthly": number, "buildingsInsuranceMonthly": number, "serviceChargeMonthly": number, "totalUpfront": number, "monthlyMortgage": number, "mortgageAssumptions": string },
  "viewingQuestions": string[],
  "negotiation": { "isAuction": boolean, "maxBid": number, "recommendedOffer": { "low": number, "high": number }, "rationale": string, "leverage": string[] },
  "sellerMotivation": { "score": number, "label": "Low"|"Moderate"|"High"|"Very High", "signals": string[], "commentary": string },
  "viewingChecklist": { "items": [{ "category": "Structure"|"Legal"|"Running costs"|"Negotiation"|"Practical", "item": string, "why": string }] },
  "renovationCosts": { "items": [{ "issue": string, "estimatedCost": string, "priority": "High priority"|"Medium priority"|"Low priority", "notes": string }], "totalEstimatedMin": number, "totalEstimatedMax": number, "commentary": string },
  "planningReference": { "found": boolean, "reference": string|null, "relatesTo": string|null, "applicationType": string|null, "isNeighbouring": boolean, "commentary": string|null } | null,
  "comparables": []
}

PLANNING REFERENCE: detect UK planning refs (XX/XXXXX/XXX e.g. 24/01893/FUL, or older XXXX/XXXX) near words planning/permission/reference/application/consent/approval. If found populate planningReference with reference, relatesTo (e.g. "rear kitchen extension"), applicationType (Householder|Full Planning|Change of Use|Listed Building Consent|Unknown), isNeighbouring (true if on an adjacent property), and 2-3 sentences of commentary including docs to request (decision notice, approved drawings, building regs completion). If none: planningReference:null. Never invent a reference.

PROPERTYDATA CONTEXT (treat as ground truth, override your estimates):
- SOLD PRICES → price history + comparables (real Land Registry).
- FLOOR AREAS → use only for this exact property's sq ft.
- CAPITAL GROWTH → quote actual % in area pricing/resale.
- FLOOD RISK → quote actual risk level.
- LISTED BUILDINGS → flag if present and not mentioned in listing (lower listingTransparency).
- CONSERVATION AREA → note extension/alteration implications.
- PLANNING APPLICATIONS → flag any nearby large/relevant ones.
- CRIME → use real data; flag if notably high.
- INTERNET SPEED → quote actual speeds.
- SCHOOLS → use actual data with Ofsted ratings.

Unknown fields: 0 for numbers, "Unknown" for strings. Never invent comparables.`;

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
  signal?: AbortSignal,
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
    signal,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Claude API ${res.status}: ${body.slice(0, 500)}`);
  }
  const data = await res.json();
  const block = Array.isArray(data?.content) ? data.content[0] : null;
  return block?.type === "text" ? block.text : "";
}

async function runStageWithRetry<T>(
  stageName: string,
  fn: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    const started = Date.now();
    try {
      console.log(`[analyse-listing] stage ${stageName} start (attempt ${attempt}/2, timeout ${timeoutMs}ms)`);
      const result = await fn(ac.signal);
      console.log(`[analyse-listing] stage ${stageName} complete in ${Date.now() - started}ms (attempt ${attempt}/2)`);
      return result;
    } catch (err) {
      lastError = err;
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[analyse-listing] stage ${stageName} failed in ${Date.now() - started}ms (attempt ${attempt}/2): ${message}`, err);
      if (attempt < 2) {
        console.log(`[analyse-listing] stage ${stageName} retrying once`);
        await new Promise((resolve) => setTimeout(resolve, 750));
      }
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError ?? `${stageName} failed`));
}

function parseStageJson(raw: string, stageName: string): Record<string, unknown> {
  const parsed = parseWithRepair(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${stageName} returned invalid JSON`);
  }
  return parsed as Record<string, unknown>;
}

const STAGED_ANALYSIS_BASE_PROMPT = `You are Roovr, an expert UK property buyer's analyst surfacing red flags estate agents hide. Return ONLY valid JSON. Be specific to this UK listing. Never use markdown.

Critical rules:
- SQUARE FOOTAGE: only use explicit listing text or PropertyData floor areas. If unknown: sqft=0 and pricePerSqFt=0. Never estimate from beds/type.
- EPC: only populate if found in listing or user-confirmed notes.
- AUCTION: only if explicit terms appear: auction, auctioneer, lot number, reserve price, unconditional exchange, sold prior to auction, online auction. Never infer from guide price/offers over.
- Guide Price is normal UK terminology and is not a red flag unless combined with explicit auction/distress evidence.
- Stamp duty must use current MAIN RESIDENCE rates for England/NI, not second-home surcharge unless explicitly stated.
- Monthly mortgage: 15% deposit, 25-year term, 4.8% fixed.
- Missing sq ft is not a red flag and must not lower listingTransparency unless there is explicit evidence it is being withheld.`;

const DEFAULT_STAGE_TIMEOUT_MS = 35_000;

type StageInputs = {
  systemPrompt: string;
  baseContent: string;
  listingContent: string;
  url: string;
};

async function runStagedClaudeAnalysis(inputs: StageInputs): Promise<Record<string, unknown>> {
  const { systemPrompt, baseContent, listingContent, url } = inputs;
  const excerpt = listingContent.slice(0, 18_000);

  const facts = await runStageWithRetry("fetch-parse-listing", async (signal) => {
    const prompt = `${baseContent}

Stage A — fetch and parse listing content. Extract the core facts only.
Return ONLY JSON matching:
{
  "property": { "address": string, "price": number, "beds": number, "baths": number, "type": string, "sqft": number, "listingUrl": string },
  "metrics": { "pricePerSqFt": number, "daysOnMarket": number, "councilTaxBand": string, "estimatedStampDuty": number },
  "epc": { "rating": string|null, "score": number|null, "potentialRating": string|null, "estimatedAnnualEnergyCost": string|null, "commentary": string } | null,
  "areaContext": { "avgPricePerSqFtArea": number|null, "avgSoldPriceArea": number|null, "priceVsAreaPercent": number|null, "areaDescription": string, "comparableNote": string },
  "planningReference": { "found": boolean, "reference": string|null, "relatesTo": string|null, "applicationType": "Householder"|"Full Planning"|"Change of Use"|"Listed Building Consent"|"Unknown"|null, "isNeighbouring": boolean, "commentary": string|null } | null
}

Listing excerpt:
${excerpt}`;
    const text = await callClaude(systemPrompt + "\n\n" + STAGED_ANALYSIS_BASE_PROMPT, prompt, 2500, signal);
    return parseStageJson(text, "fetch-parse-listing");
  }, DEFAULT_STAGE_TIMEOUT_MS);

  const redFlagsStage = await runStageWithRetry("identify-red-flags", async (signal) => {
    const prompt = `${baseContent}

Stage B — identify red flags, listing transparency, seller motivation and viewing checklist.
Known facts from Stage A:
${JSON.stringify(facts)}

Return ONLY JSON matching:
{
  "scoreLabel": string,
  "subScores": { "valueForMoney": number, "locationQuality": number, "listingTransparency": number, "marketTiming": number, "riskLevel": number, "resalePotential": number },
  "scoreReasons": { "valueForMoney": string, "locationQuality": string, "listingTransparency": string, "marketTiming": string, "riskLevel": string, "resalePotential": string },
  "redFlags": [ { "severity": "high"|"medium"|"low", "title": string, "detail": string } ],
  "sellerMotivation": { "score": number, "label": "Low"|"Moderate"|"High"|"Very High", "signals": string[], "commentary": string },
  "viewingChecklist": { "items": [{ "category": "Structure"|"Legal"|"Running costs"|"Negotiation"|"Practical", "item": string, "why": string }] },
  "renovationCosts": { "items": [{ "issue": string, "estimatedCost": string, "priority": "High priority"|"Medium priority"|"Low priority", "notes": string }], "totalEstimatedMin": number, "totalEstimatedMax": number, "commentary": string }
}

Listing excerpt:
${excerpt}`;
    const text = await callClaude(systemPrompt + "\n\n" + STAGED_ANALYSIS_BASE_PROMPT, prompt, 3500, signal);
    return parseStageJson(text, "identify-red-flags");
  }, DEFAULT_STAGE_TIMEOUT_MS);

  const costsStage = await runStageWithRetry("calculate-true-costs", async (signal) => {
    const prompt = `${baseContent}

Stage C — calculate true buying costs and viewing questions.
Known facts from earlier stages:
${JSON.stringify({ facts, redFlags: redFlagsStage.redFlags, renovationCosts: redFlagsStage.renovationCosts })}

Return ONLY JSON matching:
{
  "costs": { "purchasePrice": number, "stampDuty": number, "legalFees": number, "surveyFees": number, "mortgageFees": number, "valuationFee": number, "landRegistryFee": number, "electronicTransferFee": number, "removalCosts": number, "indemnityInsurance": number, "buildingsInsurance": number, "serviceCharge": number, "groundRent": number, "leaseholdYears": number, "councilTaxMonthly": number, "buildingsInsuranceMonthly": number, "serviceChargeMonthly": number, "totalUpfront": number, "monthlyMortgage": number, "mortgageAssumptions": string },
  "viewingQuestions": string[]
}
The viewingQuestions array must contain exactly 8 listing-specific questions.`;
    const text = await callClaude(systemPrompt + "\n\n" + STAGED_ANALYSIS_BASE_PROMPT, prompt, 1600, signal);
    return parseStageJson(text, "calculate-true-costs");
  }, DEFAULT_STAGE_TIMEOUT_MS);

  const negotiationStage = await runStageWithRetry("build-negotiation-strategy", async (signal) => {
    const prompt = `${baseContent}

Stage D — build negotiation strategy and any Land Registry comparables.
Known facts from earlier stages:
${JSON.stringify({ facts, redFlags: redFlagsStage.redFlags, costs: costsStage.costs, sellerMotivation: redFlagsStage.sellerMotivation })}

Return ONLY JSON matching:
{
  "negotiation": { "isAuction": boolean, "maxBid": number, "recommendedOffer": { "low": number, "high": number }, "rationale": string, "leverage": string[] },
  "comparables": [ { "address": string, "soldPrice": number, "soldDate": string, "distance": string } ]
}
Never invent comparables; use real PropertyData sold prices from context if available, otherwise return [].`;
    const text = await callClaude(systemPrompt + "\n\n" + STAGED_ANALYSIS_BASE_PROMPT, prompt, 1800, signal);
    return parseStageJson(text, "build-negotiation-strategy");
  }, DEFAULT_STAGE_TIMEOUT_MS);

  const merged: Record<string, unknown> = {
    ...facts,
    ...redFlagsStage,
    ...costsStage,
    ...negotiationStage,
  };
  const property = { ...((merged.property as Record<string, unknown> | undefined) ?? {}) };
  property.listingUrl = String(property.listingUrl || url || "");
  merged.property = property;
  if (!Array.isArray(merged.viewingQuestions)) merged.viewingQuestions = [];
  if (!Array.isArray(merged.redFlags)) merged.redFlags = [];
  if (!Array.isArray(merged.comparables)) merged.comparables = [];
  return merged;
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
async function runJob(
  jobId: string,
  url: string,
  pastedText: string,
  overrides?: { userEpc: string | null; userSqft: number | null },
) {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const jobStartedAt = Date.now();

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
      const overrideNotes: string[] = [`FLOOR PLAN PRESENT: ${floorPlanFlag}`];
      if (overrides?.userEpc) {
        overrideNotes.push(
          `EPC RATING EXTRACTED: ${overrides.userEpc}`,
          `USER-CONFIRMED EPC RATING: ${overrides.userEpc} (treat as explicitly stated in the listing; use as epc.rating)`,
        );
      }
      if (overrides?.userSqft && overrides.userSqft > 0) {
        overrideNotes.push(
          `USER-CONFIRMED SQUARE FOOTAGE: ${overrides.userSqft} sq ft (treat as EXPLICITLY stated in the listing; use as property.sqft and compute metrics.pricePerSqFt from it; do NOT output the "Square footage is typically shown..." placeholder sentence — calculate £/sqft normally)`,
        );
      }
      listingContent = `${overrideNotes.join("\n")}\n\n${listingContent}`;
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

    let parsed: Record<string, unknown> = {};
    try {
      console.log(`[analyse-listing] calling Claude (primary)`);
      const text = await callClaude(systemPrompt, userContent, 4000);
      console.log(`[analyse-listing] Claude response length: ${text.length}`);
      parsed = parseWithRepair(text) as Record<string, unknown>;
    } catch (primaryErr) {
      console.error("[analyse-listing] primary parse failed, retrying simplified", primaryErr);
      const simplified =
        systemPrompt +
        "\n\nIMPORTANT OVERRIDE: Omit the renovationCosts field entirely from your JSON response. Set it to null.";
      const text = await callClaude(simplified, userContent, 4000);
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
    // Skip GIAS Ofsted enrichment during the main analysis — it can add up
    // to ~40s (5 schools × up to 8s each) and pushes us past the 90s
    // deadline. PropertyData already returns basic school info; Ofsted
    // ratings can be lazy-loaded later from the schools section.
    const mappedSchools = mapPdSchools(pd["schools"]);
    if (mappedSchools) parsed.nearbySchools = mappedSchools;
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
    const sub = (parsed.subScores ?? {}) as Record<string, number>;
    const derivedScore = computeWeightedScore(sub);
    if (isFinite(derivedScore)) {
      parsed.score = derivedScore;
    }

    const { error: updErr } = await supabase
      .from("analysis_jobs")
      .update({
        status: "complete",
        result_json: parsed,
        error: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", jobId);
    if (updErr) throw updErr;
    console.log(`[analyse-listing] job ${jobId} complete in ${Date.now() - jobStartedAt}ms`);
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
    try {
      await supabase.from("error_logs").insert({
        job_id: jobId,
        listing_url: url,
        error_message: message,
        error_stage: "runJob",
      });
    } catch (logErr) {
      console.error("[analyse-listing] failed to write error_logs:", logErr);
    }
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
    const rawEpc = body?.userEpc;
    const userEpc = typeof rawEpc === "string" && /^[A-Ga-g]$/.test(rawEpc) ? rawEpc.toUpperCase() : null;
    const rawSqft = body?.userSqft;
    const userSqft = typeof rawSqft === "number" && rawSqft >= 50 && rawSqft <= 50000 ? rawSqft : null;
    if (!jobId) {
      return new Response(JSON.stringify({ error: "jobId required" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }
    scheduleEdgeBackground(runJob(jobId, url, pastedText, { userEpc, userSqft }));
    return new Response(JSON.stringify({ ok: true, accepted: true }), {
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
