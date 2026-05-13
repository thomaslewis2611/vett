import Anthropic from "@anthropic-ai/sdk";
import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { AnalysisResult } from "./mock-analysis";

const analysisSchema = z.object({
  property: z.object({
    address: z.string().describe("Full UK address as listed"),
    price: z.number().describe("Asking price in GBP, integer"),
    beds: z.number().int(),
    baths: z.number().int(),
    type: z.string().describe("e.g. 'End of terrace house', 'Flat', 'Semi-detached'"),
    sqft: z.number().describe("Approx square feet, estimate from sqm if needed; 0 if unknown"),
    listingUrl: z.string(),
  }),
  score: z.number().min(0).max(10).describe("Overall value score out of 10, one decimal place"),
  scoreLabel: z.string().describe("Short verdict, max 8 words"),
  subScores: z.object({
    valueForMoney: z.number().min(0).max(10),
    locationQuality: z.number().min(0).max(10),
    listingTransparency: z.number().min(0).max(10),
    marketTiming: z.number().min(0).max(10),
    riskLevel: z.number().min(0).max(10).describe("Higher = LOWER risk (10 = very safe, 0 = very risky)"),
    resalePotential: z.number().min(0).max(10),
  }),
  scoreReasons: z.object({
    valueForMoney: z.string().describe("2-3 sentences citing actual price, sq ft, area comparables"),
    locationQuality: z.string().describe("2-3 sentences naming the actual area, transport, amenities"),
    listingTransparency: z.string().describe("2-3 sentences on what this agent disclosed or hid"),
    marketTiming: z.string().describe("2-3 sentences on days on market, price history, demand for THIS property"),
    riskLevel: z.string().describe("2-3 sentences summarising the biggest specific risks in this listing"),
    resalePotential: z.string().describe("2-3 sentences on this property type, tenure and area's resale outlook"),
  }),
  metrics: z.object({
    pricePerSqFt: z.number().describe("Price per sq ft in GBP, 0 if unknown"),
    daysOnMarket: z.number().describe("Days listed, estimate from 'added/reduced' date if visible, 0 if unknown"),
    councilTaxBand: z.string().describe("A-H letter, or 'Unknown'"),
    estimatedStampDuty: z.number().describe("Estimated UK stamp duty in GBP for a second-home / additional property buyer"),
  }),
  epc: z.object({
    rating: z.string().nullable().describe("EPC band letter A-G, or null if not in listing"),
    score: z.number().nullable().describe("EPC numeric score 1-100, or null"),
    potentialRating: z.string().nullable().describe("Potential EPC band letter after improvements, or null"),
    estimatedAnnualEnergyCost: z.string().nullable().describe("e.g. '£1,800 per year', or null"),
    commentary: z.string().describe("2-3 sentences: what this rating means for THIS property — typical annual energy bills for this size+rating, cost+saving of upgrading one band, mortgage lender implications if below D"),
  }).nullable(),
  areaContext: z.object({
    avgPricePerSqFtArea: z.number().nullable(),
    avgSoldPriceArea: z.number().nullable(),
    priceVsAreaPercent: z.number().nullable().describe("Positive = above area avg, negative = below"),
    areaDescription: z.string().describe("2 sentences on the area: desirability, trends, transport"),
    comparableNote: z.string().describe("1 sentence on how this property compares to typical area listings"),
  }),
  redFlags: z
    .array(
      z.object({
        severity: z.enum(["high", "medium", "low"]),
        title: z.string().describe("Concise headline, max 12 words"),
        detail: z.string().describe("1-2 sentence explanation"),
      })
    )
    .min(3)
    .max(8),
  costs: z.object({
    purchasePrice: z.number(),
    stampDuty: z.number(),
    legalFees: z.number().describe("Typical UK conveyancing fees ~ £1,500-£2,500"),
    surveyFees: z.number().describe("Homebuyer survey ~ £600-£1,200"),
    mortgageFees: z.number().describe("Arrangement fee ~ £999-£1,500"),
    totalUpfront: z.number().describe("Sum of all upfront costs"),
    monthlyMortgage: z.number().describe("Monthly mortgage on 15% deposit, 25-year term, 4.8% fixed"),
    mortgageAssumptions: z.string(),
  }),
  viewingQuestions: z
    .array(z.string())
    .length(8)
    .describe("Exactly 8 specific questions tailored to this listing"),
  negotiation: z.object({
    isAuction: z.boolean().optional().describe("True if this is an auction property"),
    maxBid: z.number().optional().describe("Single max bid figure for auction properties"),
    recommendedOffer: z.object({
      low: z.number(),
      high: z.number(),
    }),
    rationale: z.string().describe("2-3 sentence justification (or auction bidding strategy if isAuction)"),
    leverage: z.array(z.string()).min(3).max(6).describe("Concrete negotiating points"),
  }),
  comparables: z
    .array(
      z.object({
        address: z.string(),
        soldPrice: z.number(),
        soldDate: z.string(),
        distance: z.string(),
      })
    )
    .max(4)
    .describe("Plausible comparable sales nearby; empty array if you cannot reasonably estimate"),
});

export { analysisSchema };

const SYSTEM_PROMPT = `You are Roovr, an expert UK property buyer's analyst whose job is to surface the red flags estate agents won't show buyers. You analyse Rightmove and Zoopla listings for serious UK home buyers.

You must:
- Read the listing carefully (description, photos captions, key features, agent copy).
- Translate UK estate agent euphemisms into honest red flags ("scope to modernise" = dated; "deceptively spacious" = small; "convenient for transport" = noisy; "no chain" can be good or distressed; etc.).
- Estimate UK stamp duty using current rates for the buyer profile (assume an additional / second property buyer for a conservative figure unless stated otherwise).
- For daysOnMarket: if the listing content begins with or contains a line like "LISTING DATE: DD/MM/YYYY — X days on market" (or "Date listed: ..."), use that X value directly. Otherwise look for any date references in the listing text and infer days on market if possible. Return 0 only if there is genuinely no signal.
- Estimate monthly mortgage on 15% deposit, 25-year term at 4.8% fixed.
- Give an overall value score AND 6 sub-scores (each out of 10, one decimal):
  - valueForMoney — price vs area comparables and sq ft
  - locationQuality — transport, schools, amenities, postcode desirability
  - listingTransparency — how honest and complete is the listing description
  - marketTiming — days on market, price reductions, demand signals
  - riskLevel — HIGHER number = LOWER risk (10 = very safe; 0 = many legal/structural/tenure red flags)
  - resalePotential — property type, tenure, size, area trajectory
- For EACH sub-score, also write a scoreReasons.<key> string of 2-3 sentences of SPECIFIC reasoning that references actual details from this listing — prices, dates, features, location names. Never write generic descriptions like "this scores well on transport". Always explain the score in terms of what you found in this specific property.
- Provide an areaContext object with your best estimates for the local area: avgPricePerSqFtArea, avgSoldPriceArea, priceVsAreaPercent (positive = above avg), a 2-sentence areaDescription and 1-sentence comparableNote. Use null for any number you genuinely cannot estimate.
- IMPORTANT: avgPricePerSqFtArea should reflect the typical price PER SQUARE FOOT for similar properties (same property type, similar size and tenure) in this specific area / postcode — NOT the average total sale price divided by anything. Base this on your knowledge of the postcode and property type. If you cannot estimate it reliably, return null rather than guessing.
- If this is an AUCTION property, set negotiation.isAuction to true and provide negotiation.maxBid as a single GBP number (not a range). Set recommendedOffer.low and high BOTH equal to maxBid. The rationale must explain auction bidding strategy including the need for bridging finance or cash. Otherwise leave isAuction false/omitted and provide a normal recommended offer range — usually 2-8% under asking.
- Tailor the 8 viewing questions to specific things in this listing, not generic boilerplate.
- EPC: extract the EPC rating ONLY from the listing content (look for "EPC", "Energy Performance", "Energy rating", an A-G letter near "energy", or a 1-100 score). If the listing content begins with a line like "EXTRACTED FROM PAGE HTML — EPC rating: X", trust that value and use it as epc.rating. If the listing content contains council tax band information, look in the same section for an EPC rating — on Rightmove they appear together (common format: "Council Tax band X" alongside "EPC rating Y", often in an "Additional Property Information" bullet list). If you see a letter rating near energy, efficiency, or EPC, extract it as epc.rating. Do NOT guess or invent an EPC rating. If the listing genuinely does not show one, return epc: null. If you find one, populate rating, score, potentialRating and estimatedAnnualEnergyCost where visible (otherwise null), and ALWAYS write a 2-3 sentence commentary tailored to THIS property's size and rating: typical annual energy bills for a property this size at this rating, the cost and saving of upgrading to the next band, and mortgage lender implications if rated below D.
- Be direct and useful — this buyer is about to spend hundreds of thousands of pounds.

Always respond with ONLY a single valid JSON object matching this exact shape (no markdown, no commentary, no code fences):
{
  "property": { "address": string, "price": number, "beds": number, "baths": number, "type": string, "sqft": number, "listingUrl": string },
  "score": number (0-10, one decimal),
  "scoreLabel": string,
  "subScores": { "valueForMoney": number, "locationQuality": number, "listingTransparency": number, "marketTiming": number, "riskLevel": number, "resalePotential": number },
  "scoreReasons": { "valueForMoney": string, "locationQuality": string, "listingTransparency": string, "marketTiming": string, "riskLevel": string, "resalePotential": string },
  "metrics": { "pricePerSqFt": number, "daysOnMarket": number, "councilTaxBand": string, "estimatedStampDuty": number },
  "epc": { "rating": string|null, "score": number|null, "potentialRating": string|null, "estimatedAnnualEnergyCost": string|null, "commentary": string } | null,
  "areaContext": { "avgPricePerSqFtArea": number|null, "avgSoldPriceArea": number|null, "priceVsAreaPercent": number|null, "areaDescription": string, "comparableNote": string },
  "redFlags": [ { "severity": "high"|"medium"|"low", "title": string, "detail": string } ] (3-8 items),
  "costs": { "purchasePrice": number, "stampDuty": number, "legalFees": number, "surveyFees": number, "mortgageFees": number, "totalUpfront": number, "monthlyMortgage": number, "mortgageAssumptions": string },
  "viewingQuestions": string[] (exactly 8),
  "negotiation": { "isAuction": boolean (optional), "maxBid": number (optional, auction only), "recommendedOffer": { "low": number, "high": number }, "rationale": string, "leverage": string[] (3-6) },
  "comparables": [ { "address": string, "soldPrice": number, "soldDate": string, "distance": string } ] (0-4)
}

If a field is unknown, use 0 for numbers, "Unknown" for strings, and never invent precise comparables you have no basis for (return empty array instead).`;

// SSRF protection: only allow Rightmove and Zoopla over HTTPS.
const ALLOWED_HOSTS = new Set([
  "www.rightmove.co.uk",
  "rightmove.co.uk",
  "m.rightmove.co.uk",
  "www.zoopla.co.uk",
  "zoopla.co.uk",
  "m.zoopla.co.uk",
]);

function validateListingUrl(rawUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("INVALID_URL: Please provide a valid Rightmove or Zoopla URL.");
  }
  if (parsed.protocol !== "https:") {
    throw new Error("INVALID_URL: Only https Rightmove or Zoopla URLs are supported.");
  }
  if (!ALLOWED_HOSTS.has(parsed.hostname.toLowerCase())) {
    throw new Error(
      "INVALID_URL: We only support Rightmove and Zoopla listing URLs."
    );
  }
  return parsed;
}

function extractMetaContent(html: string, names: string[]): string[] {
  const out: string[] = [];
  for (const name of names) {
    const patterns = [
      new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]*content=["']([^"']+)["']`, "i"),
      new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']${name}["']`, "i"),
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

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&pound;/g, "£")
    .replace(/&#163;/g, "£")
    .replace(/\s+/g, " ")
    .trim();
}

// Decode the most common HTML entities we encounter in listing text/meta.
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



const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

async function basicFetchListingHtml(url: string): Promise<string> {
  try {
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
  } catch {
    return "";
  }
}

function htmlToListingText(html: string): string {
  if (!html) return "";
  const lower = html.toLowerCase();
  const blocked =
    html.length < 500 ||
    lower.includes("enable javascript") ||
    lower.includes("access denied");

  let text = "";
  if (!blocked) {
    text = htmlToCleanText(html).slice(0, 25_000);
  }
  if (text.length < 200) {
    // Fall back to head metadata when the body is unreadable.
    const metas = extractMetaContent(html, [
      "og:title",
      "og:description",
      "twitter:title",
      "twitter:description",
      "description",
    ]);
    const combined = metas.map(decodeEntities).filter(Boolean).join("\n").trim();
    if (combined.length >= 100) {
      text = `[Limited content — extracted from page metadata only]\n\n${combined}`.slice(0, 25_000);
    }
  }
  return text;
}

function extractEpcAndCouncilTax(html: string): { epc: string | null; councilTax: string | null } {
  if (!html) return { epc: null, councilTax: null };
  let epc: string | null = null;
  let councilTax: string | null = null;
  const epcPatterns: RegExp[] = [
    /EPC[\s_-]*rating[^A-Za-z0-9]{0,10}([A-G])\b/i,
    /Energy[\s_-]*rating[^A-Za-z0-9]{0,10}([A-G])\b/i,
    /Energy[\s_-]*Performance[^<>]{0,60}?\b([A-G])\b/i,
    /"epcRating"\s*:\s*"([A-G])"/i,
    /"energyRating"\s*:\s*"([A-G])"/i,
    /"currentEnergyRating"\s*:\s*"?([A-G])"?/i,
    /data-epc-rating\s*=\s*["']([A-G])["']/i,
    /data-energy-rating\s*=\s*["']([A-G])["']/i,
    /aria-label\s*=\s*["'][^"']*?(?:EPC|Energy)[^"']*?\b([A-G])\b[^"']*["']/i,
  ];
  for (const p of epcPatterns) {
    const m = html.match(p);
    if (m?.[1]) { epc = m[1].toUpperCase(); break; }
  }
  const ctPatterns: RegExp[] = [
    /Council[\s_-]*Tax[\s_-]*band[^A-Za-z0-9]{0,10}([A-H])\b/i,
    /Council[\s_-]*Tax[^<>]{0,60}?\bBand\s*([A-H])\b/i,
    /"councilTaxBand"\s*:\s*"([A-H])"/i,
  ];
  for (const p of ctPatterns) {
    const m = html.match(p);
    if (m?.[1]) { councilTax = m[1].toUpperCase(); break; }
  }
  return { epc, councilTax };
}

function extractListedDate(html: string): { dateStr: string; daysOnMarket: number } | null {
  if (!html) return null;
  const patterns: RegExp[] = [
    /Added on (\d{1,2}\/\d{1,2}\/\d{4})/i,
    /Listed on (\d{1,2}\/\d{1,2}\/\d{4})/i,
    /First listed[: ]+(\d{1,2}\/\d{1,2}\/\d{4})/i,
    /available from[: ]+(\d{1,2}\/\d{1,2}\/\d{4})/i,
    /Reduced on (\d{1,2}\/\d{1,2}\/\d{4})/i,
    // Fallback: any date within ~40 chars of "added" or "listed"
    /(?:added|listed)[^<>]{0,40}?(\d{1,2}\/\d{1,2}\/\d{4})/i,
  ];
  for (const p of patterns) {
    const m = html.match(p);
    if (m?.[1]) {
      const [dd, mm, yyyy] = m[1].split("/").map(Number);
      const listed = new Date(Date.UTC(yyyy, mm - 1, dd));
      if (!isNaN(listed.getTime())) {
        const days = Math.max(
          0,
          Math.floor((Date.now() - listed.getTime()) / (1000 * 60 * 60 * 24))
        );
        return { dateStr: m[1], daysOnMarket: days };
      }
    }
  }
  return null;
}

async function fetchListingText(url: string): Promise<string> {
  // SSRF guard — only allow Rightmove/Zoopla URLs through.
  validateListingUrl(url);

  // 1. Cache lookup (24h TTL)
  try {
    const { data: cached } = await supabaseAdmin
      .from("listing_cache")
      .select("text_content, fetched_at")
      .eq("url", url)
      .maybeSingle();
    if (
      cached &&
      cached.text_content &&
      Date.now() - new Date(cached.fetched_at).getTime() < CACHE_TTL_MS
    ) {
      console.log(`[analyseListing] cache hit for ${url}`);
      return cached.text_content;
    }
  } catch (err) {
    console.error("[analyseListing] cache lookup failed:", err);
  }

  // 2. Basic fetch with browser-like headers
  const html = await basicFetchListingHtml(url);
  const listed = html ? extractListedDate(html) : null;
  const { epc, councilTax } = html ? extractEpcAndCouncilTax(html) : { epc: null, councilTax: null };
  let text = html ? htmlToListingText(html) : "";
  const notes: string[] = [];
  if (listed) {
    notes.push(`LISTING DATE: ${listed.dateStr} — ${listed.daysOnMarket} days on market as of today`);
    notes.push(`Date listed: ${listed.dateStr} (${listed.daysOnMarket} days on market)`);
  }
  if (epc) {
    notes.push(`EXTRACTED FROM PAGE HTML — EPC rating: ${epc} (use this as epc.rating)`);
  } else if (councilTax) {
    notes.push(`NOTE: Council Tax Band ${councilTax} was found in the listing. EPC rating is often shown in the same section on Rightmove — check carefully and extract it if present.`);
  }
  if (councilTax) {
    notes.push(`EXTRACTED FROM PAGE HTML — Council Tax Band: ${councilTax}`);
  }
  if (text && notes.length) {
    text = `${notes.join("\n")}\n\n${text}`.slice(0, 25_700);
  }

  // 3. Cache successful results.
  if (text && text.length >= 200) {
    try {
      await supabaseAdmin
        .from("listing_cache")
        .upsert(
          {
            url,
            text_content: text,
            fetched_at: new Date().toISOString(),
          },
          { onConflict: "url" }
        );
    } catch (err) {
      console.error("[analyseListing] cache upsert failed:", err);
    }
  }

  return text;
}

// ---- Server-side access check (single report token OR authenticated Buyer Pass) ----
async function hasFullAccess(opts: {
  accessToken?: string | null;
  sessionJwt?: string | null;
  listingUrl?: string | null;
}): Promise<boolean> {
  // 1. Single report token
  if (opts.accessToken) {
    try {
      const { data } = await supabaseAdmin
        .from("single_report_tokens")
        .select("listing_url, expires_at")
        .eq("token", opts.accessToken)
        .maybeSingle();
      if (data && new Date(data.expires_at).getTime() > Date.now()) {
        // If the token was issued for a specific listing, only honour that listing.
        if (!data.listing_url || !opts.listingUrl || data.listing_url === opts.listingUrl) {
          return true;
        }
      }
    } catch {
      /* fall through to JWT check */
    }
  }

  // 2. Buyer Pass via authenticated session
  if (opts.sessionJwt) {
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
    if (SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY) {
      try {
        const c = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
          auth: { persistSession: false, autoRefreshToken: false },
        });
        const { data } = await c.auth.getUser(opts.sessionJwt);
        const email = data.user?.email;
        if (email) {
          const { data: row } = await supabaseAdmin
            .from("buyer_pass_users")
            .select("email")
            .ilike("email", email)
            .maybeSingle();
          if (row) return true;
        }
      } catch {
        /* ignore */
      }
    }
  }

  return false;
}

// Strip all premium content so it never leaves the server unless the user has paid.
function toPreview(a: AnalysisResult): AnalysisResult {
  return {
    ...a,
    redFlags: a.redFlags.slice(0, 2),
    costs: {
      purchasePrice: a.costs.purchasePrice,
      stampDuty: 0,
      legalFees: 0,
      surveyFees: 0,
      mortgageFees: 0,
      totalUpfront: 0,
      monthlyMortgage: 0,
      mortgageAssumptions: "",
    },
    viewingQuestions: [],
    negotiation: {
      recommendedOffer: { low: 0, high: 0 },
      rationale: "",
      leverage: [],
    },
    comparables: [],
  };
}

export const analyseListing = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      url: z.string().max(2000).optional(),
      text: z.string().max(50000).optional(),
      accessToken: z.string().max(200).optional().nullable(),
      sessionJwt: z.string().max(4000).optional().nullable(),
    })
  )
  .handler(async ({ data }): Promise<AnalysisResult> => {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      console.error("[analyseListing] Missing ANTHROPIC_API_KEY");
      throw new Error("Analysis service is temporarily unavailable. Please try again shortly.");
    }

    const url = data.url?.trim() ?? "";
    const pastedText = data.text?.trim() ?? "";
    if (!url && !pastedText) throw new Error("Provide a listing URL or pasted text");

    // Validate URL upfront so we never make an unrelated outbound request.
    if (url) {
      try {
        validateListingUrl(url);
      } catch (e) {
        throw e instanceof Error ? e : new Error("INVALID_URL: Unsupported URL.");
      }
    }

    let listingContent = pastedText;
    if (!listingContent && url) {
      listingContent = await fetchListingText(url);
    }
    if (!listingContent || listingContent.length < 100) {
      throw new Error(
        "FETCH_BLOCKED: We couldn't automatically read this listing. You can paste the listing description below to get your full analysis."
      );
    }

    let output: z.infer<typeof analysisSchema>;
    try {
      const client = new Anthropic({ apiKey });
      const message = await client.messages.create({
        model: "claude-sonnet-4-5",
        max_tokens: 3500,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: `Listing URL: ${url || "(pasted text only)"}\n\nListing content:\n${listingContent}`,
          },
        ],
      });

      const responseText =
        message.content[0].type === "text" ? message.content[0].text : "";
      const cleaned = responseText
        .trim()
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/i, "");

      const parsed = JSON.parse(cleaned);
      output = analysisSchema.parse(parsed);
    } catch (err: unknown) {
      // Log details server-side; never leak provider/internal error info to the browser.
      console.error("[analyseListing] Anthropic/parse error:", err);
      throw new Error(
        "Sorry, the analysis service is temporarily unavailable. Please try again shortly."
      );
    }

    const full: AnalysisResult = {
      ...output,
      property: {
        ...output.property,
        listingUrl: url || output.property.listingUrl || "",
      },
    } as AnalysisResult;

    // Server-side gating — only return premium content if the caller has paid.
    const unlocked = await hasFullAccess({
      accessToken: data.accessToken ?? null,
      sessionJwt: data.sessionJwt ?? null,
      listingUrl: url || null,
    });

    return unlocked ? full : toPreview(full);
  });
