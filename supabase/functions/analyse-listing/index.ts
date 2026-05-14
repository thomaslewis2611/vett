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
- avgPricePerSqFtArea must reflect typical price PER SQUARE FOOT for similar properties in this postcode. Return null if unsure.
- For AUCTION listings, set negotiation.isAuction true, negotiation.maxBid as a single GBP number, recommendedOffer.low and high BOTH equal to maxBid. Otherwise normal recommended offer range (usually 2-8% under asking).
- IMPORTANT: Only identify a property as an auction listing if the listing text explicitly contains one or more of these exact terms: auction, auctioneer, lot number, reserve price, unconditional exchange, sold prior to auction, online auction. Do NOT infer auction status from: guide price, offers over, offers in excess of, or any other pricing language. These are standard estate agent terms used on normal listings and must never be interpreted as auction indicators. If you incorrectly flag a non-auction property as an auction listing, this causes serious harm to users who may make incorrect financial decisions. When in doubt, do not flag as auction.
- Tailor 8 viewing questions to specific things in this listing.
- EPC: extract a rating from the listing if present ("EPC rating D" / "EPC Rating: D"). Otherwise return epc: null. If found, populate rating, score, potentialRating, estimatedAnnualEnergyCost where visible (else null) and ALWAYS write a 2-3 sentence commentary tailored to size and rating.
- Be direct and useful — this buyer is about to spend hundreds of thousands of pounds.
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
  "comparables": []
}

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

// ---------- Main job runner ----------
async function runJob(jobId: string, url: string, pastedText: string) {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    let listingContent = pastedText?.trim() ?? "";
    if (!listingContent && url) {
      validateUrl(url);
      console.log(`[analyse-listing] fetching ${url}`);
      const html = await fetchListingHtml(url);
      listingContent = htmlToListingText(html);
      console.log(`[analyse-listing] listing length: ${listingContent.length}`);
    }
    if (!listingContent || listingContent.length < 100) {
      throw new Error(
        "FETCH_BLOCKED: We couldn't automatically read this listing. You can paste the listing description below to get your full analysis.",
      );
    }

    const userContent = `Listing URL: ${url || "(pasted text only)"}\n\nListing content:\n${listingContent}`;

    let parsed: Record<string, unknown>;
    try {
      console.log("[analyse-listing] calling Claude (primary)");
      const text = await callClaude(SYSTEM_PROMPT, userContent, 6000);
      console.log(`[analyse-listing] Claude response length: ${text.length}`);
      parsed = parseWithRepair(text) as Record<string, unknown>;
    } catch (primaryErr) {
      console.error("[analyse-listing] primary parse failed, retrying simplified", primaryErr);
      const simplified =
        SYSTEM_PROMPT +
        "\n\nIMPORTANT OVERRIDE: Omit the renovationCosts field entirely from your JSON response. Set it to null.";
      const text = await callClaude(simplified, userContent, 6000);
      parsed = parseWithRepair(text) as Record<string, unknown>;
      parsed.renovationCosts = null;
    }

    // Make sure listingUrl is set on the property block.
    const property = (parsed.property ?? {}) as Record<string, unknown>;
    if (!property.listingUrl) property.listingUrl = url || "";
    parsed.property = property;

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
