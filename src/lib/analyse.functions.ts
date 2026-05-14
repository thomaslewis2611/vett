import Anthropic from "@anthropic-ai/sdk";
import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { scheduleBackground } from "@/lib/execution-context";
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
  priceHistory: z.object({
    entries: z.array(z.object({
      date: z.string(),
      price: z.number(),
      event: z.enum(["sold", "listed", "reduced", "relisted"]),
    })).nullable(),
    firstSalePrice: z.number().nullable(),
    firstSaleDate: z.string().nullable(),
    totalAppreciation: z.number().nullable().describe("% change from first sold price to current asking"),
    annualGrowthRate: z.number().nullable().describe("% per year compounded from first sale to now"),
    yearsHeld: z.number().nullable(),
    commentary: z.string().describe("2-3 sentences: vs UK ~5%/yr, aggressive pricing concerns, relist gaps, etc."),
    source: z.enum(["land_registry"]).nullable().optional(),
    nearbyMode: z.boolean().nullable().optional(),
    scotland: z.boolean().nullable().optional(),
  }).nullable(),
  floodRisk: z.object({
    riversAndSea: z.string().nullable(),
    surfaceWater: z.string().nullable(),
    reservoir: z.boolean().nullable(),
    groundwater: z.string().nullable(),
    overallRisk: z.string().nullable(),
    commentary: z.string(),
    autoRedFlag: z.boolean(),
    scotland: z.boolean().nullable().optional(),
    unavailable: z.boolean().nullable().optional(),
  }).nullable().optional(),
  nearbySchools: z.object({
    schools: z.array(z.object({
      name: z.string(),
      ofstedRating: z.number().nullable(),
      schoolType: z.string().nullable(),
      phase: z.enum(["primary", "secondary", "other"]),
      distanceMiles: z.number(),
    })),
    unavailable: z.boolean().nullable().optional(),
  }).nullable().optional(),
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
  sellerMotivation: z.object({
    score: z.number().min(1).max(10),
    label: z.enum(["Low", "Moderate", "High", "Very High"]),
    signals: z.array(z.string()),
    commentary: z.string(),
  }).nullable().optional(),
  viewingChecklist: z.object({
    items: z.array(z.object({
      category: z.enum(["Structure", "Legal", "Running costs", "Negotiation", "Practical"]),
      item: z.string(),
      why: z.string(),
    })).min(8).max(15),
  }).nullable().optional(),
  renovationCosts: z.object({
    items: z.array(z.object({
      issue: z.string(),
      estimatedCost: z.string(),
      priority: z.enum(["Essential", "Recommended", "Optional"]),
      notes: z.string(),
    })),
    totalEstimatedMin: z.number(),
    totalEstimatedMax: z.number(),
    commentary: z.string(),
  }).nullable().optional(),
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
- EPC: Look for the pattern "EPC RATING EXTRACTED: [letter]" at the top of the listing content — this is the confirmed EPC rating, always use it as epc.rating. Also look for variations like "EPC rating D", "EPC Rating: D", or "* EPC rating D" in the description text. If the listing content begins with a line like "EXTRACTED FROM PAGE HTML — EPC rating: X", trust that value. If the listing content contains council tax band information, look in the same section for an EPC rating — on Rightmove they appear together (common format: "Council Tax band X" alongside "EPC rating Y", often in an "Additional Property Information" bullet list). Do NOT guess or invent an EPC rating. If the listing genuinely does not show one, return epc: null. If you find one, populate rating, score, potentialRating and estimatedAnnualEnergyCost where visible (otherwise null), and ALWAYS write a 2-3 sentence commentary tailored to THIS property's size and rating: typical annual energy bills for a property this size at this rating, the cost and saving of upgrading to the next band, and mortgage lender implications if rated below D.
- PRICE HISTORY: If "PRICE HISTORY DATA:" is provided at the top of the listing content, use it to populate the priceHistory field. Each line lists "[event] [date]: £[price]". Set entries (sorted oldest-first), firstSalePrice / firstSaleDate from the earliest sold (or earliest listed if no sold) entry, yearsHeld = years between firstSaleDate and today, totalAppreciation = ((currentAskingPrice - firstSalePrice) / firstSalePrice * 100) rounded to 1 decimal, annualGrowthRate = (((currentAskingPrice / firstSalePrice) ^ (1 / yearsHeld)) - 1) * 100 rounded to 1 decimal. Write a 2-3 sentence commentary comparing growth to the UK average (~5%/yr), flagging aggressive pricing if annualGrowthRate exceeds 8%/yr, flagging negative appreciation if price has fallen, and flagging if there is a gap of more than 6 months between listing/relisting events. If no PRICE HISTORY DATA is provided, set priceHistory to null. NEVER fabricate historical prices.
- FLOOD RISK: If "ENVIRONMENT AGENCY FLOOD RISK" data is provided in the listing content, populate floodRisk with EXACTLY those values for riversAndSea, surfaceWater, reservoir, groundwater and overallRisk. Set autoRedFlag=true ONLY if Rivers/Sea risk is "High". Write a 2-3 sentence commentary explaining the practical implications: buildings insurance cost, mortgage lender concerns, what the buyer should do. For High risk specifically mention that some insurers refuse cover or charge 3-5x standard premiums and that some mortgage lenders require flood resilience measures as a condition of lending. If no flood data is provided, set floodRisk to null.
- Be direct and useful — this buyer is about to spend hundreds of thousands of pounds.

- Populate sellerMotivation based on: days on market, number of price reductions, chain status, reason for sale if mentioned, listing language urgency, and time of year. Score 1-3 = low motivation (recently listed, no reductions, strong market), 4-6 = moderate, 7-8 = high (30+ days, reduced, or chain free with emphasis), 9-10 = very high (multiple reductions, long time on market, vacant, urgent language). Signals must be short concrete strings drawn from the listing (e.g. "35 days on market", "Price reduced twice", "No onward chain", "Vacant possession"). Commentary is 2-3 sentences explaining what the motivation level means for the buyer's negotiating position.
- Populate viewingChecklist with 8-15 specific actionable items derived from the red flags and property characteristics identified. Every item must be specific to THIS property — not generic advice. Reference specific details from the listing. Each item belongs to one of: "Structure", "Legal", "Running costs", "Negotiation", "Practical". The "why" is one sentence explaining why this matters for THIS specific property.
- Populate renovationCosts only for issues identified in the red flags or listing. Do not invent issues not mentioned. Use realistic UK contractor pricing for 2026. estimatedCost should be a string range like "£15,000 – £25,000". priority is one of "Essential", "Recommended", "Optional". Set totalEstimatedMin and totalEstimatedMax as the sum of min/max integers across items. Commentary is 2-3 sentences on overall renovation picture and whether costs are factored into asking price. If no renovation is needed, return { items: [], totalEstimatedMin: 0, totalEstimatedMax: 0, commentary: "..." }.

Always respond with ONLY a single valid JSON object matching this exact shape (no markdown, no commentary, no code fences):
{
  "property": { "address": string, "price": number, "beds": number, "baths": number, "type": string, "sqft": number, "listingUrl": string },
  "score": number (0-10, one decimal),
  "scoreLabel": string,
  "subScores": { "valueForMoney": number, "locationQuality": number, "listingTransparency": number, "marketTiming": number, "riskLevel": number, "resalePotential": number },
  "scoreReasons": { "valueForMoney": string, "locationQuality": string, "listingTransparency": string, "marketTiming": string, "riskLevel": string, "resalePotential": string },
  "metrics": { "pricePerSqFt": number, "daysOnMarket": number, "councilTaxBand": string, "estimatedStampDuty": number },
  "epc": { "rating": string|null, "score": number|null, "potentialRating": string|null, "estimatedAnnualEnergyCost": string|null, "commentary": string } | null,
  "priceHistory": { "entries": [{ "date": string, "price": number, "event": "sold"|"listed"|"reduced"|"relisted" }]|null, "firstSalePrice": number|null, "firstSaleDate": string|null, "totalAppreciation": number|null, "annualGrowthRate": number|null, "yearsHeld": number|null, "commentary": string } | null,
  "floodRisk": { "riversAndSea": "Very Low"|"Low"|"Medium"|"High"|null, "surfaceWater": "Very Low"|"Low"|"Medium"|"High"|null, "reservoir": boolean|null, "groundwater": "Very Low"|"Low"|"Medium"|"High"|null, "overallRisk": "Very Low"|"Low"|"Medium"|"High"|null, "commentary": string, "autoRedFlag": boolean } | null,
  "areaContext": { "avgPricePerSqFtArea": number|null, "avgSoldPriceArea": number|null, "priceVsAreaPercent": number|null, "areaDescription": string, "comparableNote": string },
  "redFlags": [ { "severity": "high"|"medium"|"low", "title": string, "detail": string } ] (3-8 items),
  "costs": { "purchasePrice": number, "stampDuty": number, "legalFees": number, "surveyFees": number, "mortgageFees": number, "totalUpfront": number, "monthlyMortgage": number, "mortgageAssumptions": string },
  "viewingQuestions": string[] (exactly 8),
  "negotiation": { "isAuction": boolean (optional), "maxBid": number (optional, auction only), "recommendedOffer": { "low": number, "high": number }, "rationale": string, "leverage": string[] (3-6) },
  "sellerMotivation": { "score": number (1-10), "label": "Low"|"Moderate"|"High"|"Very High", "signals": string[], "commentary": string },
  "viewingChecklist": { "items": [{ "category": "Structure"|"Legal"|"Running costs"|"Negotiation"|"Practical", "item": string, "why": string }] (8-15) },
  "renovationCosts": { "items": [{ "issue": string, "estimatedCost": string, "priority": "Essential"|"Recommended"|"Optional", "notes": string }], "totalEstimatedMin": number, "totalEstimatedMax": number, "commentary": string },
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
    // Plain-text bullet pattern commonly found in Rightmove descriptions
    // e.g. "* EPC rating D", "* EPC Rating: C", "EPC rating: D"
    /\*?\s*EPC\s+rating[:\s]+([A-G])\b/i,
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

type LandRegistryEntry = { date: string; price: number; event: "sold" };
type LandRegistryResult = { entries: LandRegistryEntry[]; nearbyMode: boolean } | null;

const POSTCODE_RE = /\b([A-Z]{1,2}[0-9][0-9A-Z]?)\s?([0-9][A-Z]{2})\b/i;
const LAND_REGISTRY_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function extractPostcode(text: string): string | null {
  if (!text) return null;
  const m = text.match(POSTCODE_RE);
  if (!m) return null;
  return `${m[1].toUpperCase()} ${m[2].toUpperCase()}`;
}

function extractAddressBits(text: string): {
  postcode: string | null;
  paon: string | null;
  saon: string | null;
  street: string | null;
} {
  const postcode = extractPostcode(text);
  let paon: string | null = null;
  let saon: string | null = null;
  let street: string | null = null;
  if (!text) return { postcode, paon, saon, street };

  // Look for "Flat N" / "Apartment N" / "Unit N"
  const flatMatch = text.match(/\b(?:Flat|Apartment|Apt|Unit)\s+([0-9]+[A-Z]?)\b/i);
  if (flatMatch) saon = flatMatch[1].toUpperCase();

  // House number + street name pattern, e.g. "16 Marlborough Street"
  // Pull the first occurrence within a window around the postcode if possible.
  const numberStreet = text.match(/\b(\d+[A-Z]?)\s+([A-Z][A-Za-z'’\-]+(?:\s+[A-Z][A-Za-z'’\-]+){0,4}?\s+(?:Street|St|Road|Rd|Lane|Ln|Avenue|Ave|Close|Cl|Drive|Dr|Way|Place|Pl|Court|Ct|Crescent|Terrace|Square|Hill|Park|Mews|Gardens|Grove|Walk|Row))\b/);
  if (numberStreet) {
    paon = numberStreet[1].toUpperCase();
    street = numberStreet[2].trim();
  } else {
    // Property name like "Rose Cottage"
    const nameMatch = text.match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?\s+(?:Cottage|House|Lodge|Manor|Barn|Farm|Villa))\b/);
    if (nameMatch && !paon) paon = nameMatch[1];
  }

  return { postcode, paon, saon, street };
}

function landRegistryCacheKey(postcode: string, paon: string | null, saon: string | null, street: string | null) {
  return `landreg:${postcode}|${paon ?? ""}|${saon ?? ""}|${street ?? ""}`;
}

function formatMonthYear(iso: string): string {
  const dt = new Date(iso);
  if (isNaN(dt.getTime())) return iso;
  return `${MONTH_NAMES[dt.getUTCMonth()]} ${dt.getUTCFullYear()}`;
}

type PpiItem = {
  pricePaid?: number;
  transactionDate?: string;
  propertyAddress?: {
    paon?: string;
    saon?: string;
    street?: string;
    postcode?: string;
  };
  // Some responses use a different shape; tolerate it.
  primaryAddressobject?: { paon?: string; saon?: string };
};

async function fetchLandRegistryPriceHistory(
  postcode: string,
  paon: string | null,
  saon: string | null,
  street: string | null,
): Promise<LandRegistryResult> {
  console.log(`fetchPriceHistory called with postcode: ${postcode}`);
  if (!postcode) {
    console.log("fetchPriceHistory returned 0 results");
    return null;
  }

  const cacheKey = landRegistryCacheKey(postcode, paon, saon, street);
  // Cache lookup
  try {
    const { data: cached } = await supabaseAdmin
      .from("listing_cache")
      .select("text_content, fetched_at")
      .eq("url", cacheKey)
      .maybeSingle();
    if (
      cached?.text_content &&
      Date.now() - new Date(cached.fetched_at).getTime() < LAND_REGISTRY_TTL_MS
    ) {
      try {
        const parsed = JSON.parse(cached.text_content);
        if (parsed && Array.isArray(parsed.entries)) {
          console.log(`fetchPriceHistory returned ${parsed.entries.length} results (cached)`);
          return parsed as LandRegistryResult;
        }
      } catch { /* ignore */ }
    }
  } catch (err) {
    console.error("[landRegistry] cache lookup failed:", err);
  }

  const pcParam = postcode.replace(/\s+/g, "+");
  const url = `https://landregistry.data.gov.uk/data/ppi/transaction-record.json?propertyAddress.postcode=${pcParam}&_page=0&_pageSize=10&_sort=-transactionDate`;

  let items: PpiItem[] = [];
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 10_000);
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!res.ok) {
      console.error(`[landRegistry] HTTP ${res.status} for ${url}`);
      console.log("fetchPriceHistory returned 0 results");
      return null;
    }
    const json = (await res.json()) as { result?: { items?: PpiItem[] } };
    items = json?.result?.items ?? [];
  } catch (err) {
    console.error("[landRegistry] fetch failed:", err);
    console.log("fetchPriceHistory returned 0 results");
    return null;
  }

  const toEntry = (it: PpiItem): LandRegistryEntry | null => {
    const price = typeof it.pricePaid === "number" ? it.pricePaid : NaN;
    const date = it.transactionDate ?? "";
    if (!Number.isFinite(price) || price <= 0 || !date) return null;
    return { date: formatMonthYear(date), price, event: "sold" as const };
  };

  const itemPaon = (it: PpiItem): string =>
    (it.propertyAddress?.paon ?? it.primaryAddressobject?.paon ?? "").toString().toUpperCase();

  // Exact-match only — if we don't know the property number, or none of the
  // postcode results match it, return null. No nearby/street-level fallback.
  if (!paon) {
    console.log("fetchPriceHistory returned 0 results (no paon to match)");
    return null;
  }

  const target = paon.toUpperCase();
  const matched = items.filter((it) => itemPaon(it) === target);
  const entries: LandRegistryEntry[] = matched
    .map(toEntry)
    .filter((x): x is LandRegistryEntry => x !== null);

  // Sort oldest-first for the timeline UI
  entries.sort((a, b) => a.date.localeCompare(b.date));

  if (entries.length === 0) {
    console.log("fetchPriceHistory returned 0 results (no exact match)");
    return null;
  }

  const result: LandRegistryResult = { entries, nearbyMode: false };
  try {
    await supabaseAdmin
      .from("listing_cache")
      .upsert(
        { url: cacheKey, text_content: JSON.stringify(result), fetched_at: new Date().toISOString() },
        { onConflict: "url" },
      );
  } catch (err) {
    console.error("[landRegistry] cache upsert failed:", err);
  }

  console.log(`fetchPriceHistory returned ${entries.length} results`);
  return result;
}

const SCOTTISH_POSTCODE_PREFIXES = [
  "EH","G","KA","KY","DD","AB","IV","PH","FK","ML","PA","KW","HS","ZE","TD","DG",
];

function isScottishPostcode(postcode: string | null): boolean {
  if (!postcode) return false;
  const pc = postcode.toUpperCase().replace(/\s+/g, "");
  // Match leading alpha area code (1-2 letters before first digit).
  const area = pc.match(/^[A-Z]+/)?.[0] ?? "";
  return SCOTTISH_POSTCODE_PREFIXES.includes(area);
}

// ---------------- Flood Risk (Environment Agency) ----------------
type FloodRiskRaw = {
  riversAndSea: string | null;
  surfaceWater: string | null;
  reservoir: boolean | null;
  groundwater: string | null;
  overallRisk: string | null;
  scotland?: boolean;
  unavailable?: boolean;
};

const FLOOD_RISK_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 days

const RISK_LEVELS = ["very low", "low", "medium", "high"] as const;
function normaliseRisk(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim().toLowerCase().replace(/\s+/g, " ");
  if (RISK_LEVELS.includes(s as (typeof RISK_LEVELS)[number])) {
    return s.replace(/\b\w/g, (c) => c.toUpperCase());
  }
  return null;
}

function highestRisk(values: (string | null)[]): string | null {
  let best = -1;
  for (const v of values) {
    if (!v) continue;
    const idx = RISK_LEVELS.indexOf(v.toLowerCase() as (typeof RISK_LEVELS)[number]);
    if (idx > best) best = idx;
  }
  if (best < 0) return null;
  const v = RISK_LEVELS[best];
  return v.replace(/\b\w/g, (c) => c.toUpperCase());
}

async function fetchFloodRisk(postcode: string | null): Promise<FloodRiskRaw | null> {
  if (!postcode) return null;
  console.log(`fetchFloodRisk called with postcode: ${postcode}`);

  if (isScottishPostcode(postcode)) {
    console.log("fetchFloodRisk: Scottish postcode, skipping EA API");
    return {
      riversAndSea: null,
      surfaceWater: null,
      reservoir: null,
      groundwater: null,
      overallRisk: null,
      scotland: true,
    };
  }

  const cacheKey = `floodrisk:${postcode}`;
  try {
    const { data: cached } = await supabaseAdmin
      .from("listing_cache")
      .select("text_content, fetched_at")
      .eq("url", cacheKey)
      .maybeSingle();
    if (
      cached?.text_content &&
      Date.now() - new Date(cached.fetched_at).getTime() < FLOOD_RISK_TTL_MS
    ) {
      try {
        const parsed = JSON.parse(cached.text_content) as FloodRiskRaw;
        console.log(`fetchFloodRisk returned cached for ${postcode}`);
        return parsed;
      } catch { /* ignore */ }
    }
  } catch (err) {
    console.error("[floodRisk] cache lookup failed:", err);
  }

  const pcParam = encodeURIComponent(postcode.replace(/\s+/g, ""));
  const url = `https://check-long-term-flood-risk.service.gov.uk/api/flood-risk-by-postcode/${pcParam}`;

  let raw: FloodRiskRaw | null = null;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 10_000);
    const res = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": "Roovr/1.0" },
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!res.ok) {
      console.error(`[floodRisk] HTTP ${res.status} for ${url}`);
      return { riversAndSea: null, surfaceWater: null, reservoir: null, groundwater: null, overallRisk: null, unavailable: true };
    }
    const json = (await res.json()) as Record<string, unknown>;
    const rivers = normaliseRisk(json.floodRiskFromRivers ?? json.riversAndSea ?? json.rivers);
    const surface = normaliseRisk(json.floodRiskFromSurface ?? json.surfaceWater ?? json.surface);
    const ground = normaliseRisk(json.floodRiskFromGroundwater ?? json.groundwater);
    const reservoirRaw = json.floodRiskFromReservoir ?? json.reservoir;
    const reservoir = typeof reservoirRaw === "boolean" ? reservoirRaw : null;
    const overall = highestRisk([rivers, surface, ground]);
    raw = {
      riversAndSea: rivers,
      surfaceWater: surface,
      reservoir,
      groundwater: ground,
      overallRisk: overall,
    };
  } catch (err) {
    console.error("[floodRisk] fetch failed:", err);
    return { riversAndSea: null, surfaceWater: null, reservoir: null, groundwater: null, overallRisk: null, unavailable: true };
  }

  try {
    await supabaseAdmin
      .from("listing_cache")
      .upsert(
        { url: cacheKey, text_content: JSON.stringify(raw), fetched_at: new Date().toISOString() },
        { onConflict: "url" },
      );
  } catch (err) {
    console.error("[floodRisk] cache upsert failed:", err);
  }

  console.log(`fetchFloodRisk returned overallRisk=${raw?.overallRisk ?? "null"}`);
  return raw;
}

// ---------------- Nearby Schools (DfE / Ofsted) ----------------
type SchoolEntry = {
  name: string;
  ofstedRating: number | null;
  schoolType: string | null;
  phase: "primary" | "secondary" | "other";
  distanceMiles: number;
};
type NearbySchoolsRaw = {
  schools: SchoolEntry[];
  unavailable?: boolean;
};

const NEARBY_SCHOOLS_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function classifyPhase(schoolType: string | null): "primary" | "secondary" | "other" {
  if (!schoolType) return "other";
  const s = schoolType.toLowerCase();
  if (/(secondary|sixth|all[- ]through|upper)/.test(s)) return "secondary";
  if (/(primary|infant|junior|first|nursery)/.test(s)) return "primary";
  return "other";
}

async function fetchNearbySchools(postcode: string | null): Promise<NearbySchoolsRaw | null> {
  if (!postcode) return null;
  console.log(`fetchNearbySchools called with postcode: ${postcode}`);

  const cacheKey = `schools:${postcode}`;
  try {
    const { data: cached } = await supabaseAdmin
      .from("listing_cache")
      .select("text_content, fetched_at")
      .eq("url", cacheKey)
      .maybeSingle();
    if (
      cached?.text_content &&
      Date.now() - new Date(cached.fetched_at).getTime() < NEARBY_SCHOOLS_TTL_MS
    ) {
      try {
        const parsed = JSON.parse(cached.text_content) as NearbySchoolsRaw;
        console.log(`fetchNearbySchools returned cached for ${postcode} (${parsed.schools?.length ?? 0})`);
        return parsed;
      } catch { /* ignore */ }
    }
  } catch (err) {
    console.error("[nearbySchools] cache lookup failed:", err);
  }

  const pcParam = encodeURIComponent(postcode.trim());
  const url = `https://educationdata.service.gov.uk/api/v1/schools/information/?postcode=${pcParam}&radius=1.6&fields=school_name,ofsted_rating,school_type,distance`;

  let raw: NearbySchoolsRaw;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 10_000);
    const res = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": "Roovr/1.0" },
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!res.ok) {
      console.error(`[nearbySchools] HTTP ${res.status} for ${url}`);
      return { schools: [], unavailable: true };
    }
    const json = (await res.json()) as unknown;
    const list: any[] = Array.isArray(json)
      ? (json as any[])
      : Array.isArray((json as any)?.results)
        ? (json as any).results
        : Array.isArray((json as any)?.data)
          ? (json as any).data
          : [];

    const schools: SchoolEntry[] = list
      .map((s) => {
        const name: string =
          s.school_name ?? s.name ?? s.schoolName ?? s.establishmentName ?? "";
        const ofstedRaw = s.ofsted_rating ?? s.ofstedRating ?? s.ofsted;
        const ofstedRating =
          typeof ofstedRaw === "number"
            ? ofstedRaw
            : typeof ofstedRaw === "string" && /^\d$/.test(ofstedRaw)
              ? Number(ofstedRaw)
              : null;
        const schoolType: string | null =
          s.school_type ?? s.schoolType ?? s.type ?? null;
        const distRaw = s.distance ?? s.distance_km ?? s.distanceKm;
        const distKm = typeof distRaw === "number" ? distRaw : Number(distRaw);
        const distanceMiles = Number.isFinite(distKm) ? distKm * 0.621371 : NaN;
        return {
          name,
          ofstedRating,
          schoolType,
          phase: classifyPhase(schoolType),
          distanceMiles,
        };
      })
      .filter((s) => s.name && Number.isFinite(s.distanceMiles))
      .sort((a, b) => a.distanceMiles - b.distanceMiles);

    raw = { schools };
  } catch (err) {
    console.error("[nearbySchools] fetch failed:", err);
    return { schools: [], unavailable: true };
  }

  try {
    await supabaseAdmin
      .from("listing_cache")
      .upsert(
        { url: cacheKey, text_content: JSON.stringify(raw), fetched_at: new Date().toISOString() },
        { onConflict: "url" },
      );
  } catch (err) {
    console.error("[nearbySchools] cache upsert failed:", err);
  }

  console.log(`fetchNearbySchools returned ${raw.schools.length} schools`);
  return raw;
}

type FetchedListing = {
  text: string;
  landRegistry: LandRegistryResult;
  scotland: boolean;
  postcode: string | null;
  floodRisk: FloodRiskRaw | null;
  nearbySchools: NearbySchoolsRaw | null;
};

async function fetchListingText(url: string): Promise<FetchedListing> {
  // SSRF guard — only allow Rightmove/Zoopla URLs through.
  validateListingUrl(url);

  // 1. Cache lookup (24h TTL) — listing text only. Land Registry has its own
  // longer-lived cache keyed by postcode+paon.
  let cachedText: string | null = null;
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
      cachedText = cached.text_content;
    }
  } catch (err) {
    console.error("[analyseListing] cache lookup failed:", err);
  }

  // We need either cached text or fresh HTML to extract postcode for the
  // Land Registry / flood-risk calls.
  let html = "";
  if (!cachedText) {
    html = await basicFetchListingHtml(url);
  }
  const sourceForExtraction = cachedText ?? (html ? htmlToCleanText(html) : "");
  const { postcode, paon, saon, street } = extractAddressBits(sourceForExtraction);
  const scotland = isScottishPostcode(postcode);

  // Run external lookups in parallel with the rest of the work.
  const landRegistryPromise: Promise<LandRegistryResult> = (postcode && !scotland)
    ? fetchLandRegistryPriceHistory(postcode, paon, saon, street).catch((err) => {
        console.error("[landRegistry] lookup failed:", err);
        return null;
      })
    : Promise.resolve(null);

  const floodRiskPromise: Promise<FloodRiskRaw | null> = postcode
    ? fetchFloodRisk(postcode).catch((err) => {
        console.error("[floodRisk] lookup failed:", err);
        return null;
      })
    : Promise.resolve(null);

  const nearbySchoolsPromise: Promise<NearbySchoolsRaw | null> = postcode
    ? fetchNearbySchools(postcode).catch((err) => {
        console.error("[nearbySchools] lookup failed:", err);
        return null;
      })
    : Promise.resolve(null);

  if (cachedText) {
    const [landRegistry, floodRisk, nearbySchools] = await Promise.all([
      landRegistryPromise,
      floodRiskPromise,
      nearbySchoolsPromise,
    ]);
    return { text: cachedText, landRegistry, scotland, postcode, floodRisk, nearbySchools };
  }

  const listed = html ? extractListedDate(html) : null;
  const { epc, councilTax } = html ? extractEpcAndCouncilTax(html) : { epc: null, councilTax: null };
  let text = html ? htmlToListingText(html) : "";
  const [landRegistry, floodRisk, nearbySchools] = await Promise.all([
    landRegistryPromise,
    floodRiskPromise,
    nearbySchoolsPromise,
  ]);

  const notes: string[] = [];
  if (listed) {
    notes.push(`LISTING DATE: ${listed.dateStr} — ${listed.daysOnMarket} days on market as of today`);
    notes.push(`Date listed: ${listed.dateStr} (${listed.daysOnMarket} days on market)`);
  }
  if (epc) {
    notes.push(`EPC RATING EXTRACTED: ${epc}`);
    notes.push(`EXTRACTED FROM PAGE HTML — EPC rating: ${epc} (use this as epc.rating)`);
  } else if (councilTax) {
    notes.push(`NOTE: Council Tax Band ${councilTax} was found in the listing. EPC rating is often shown in the same section on Rightmove — check carefully and extract it if present.`);
  }
  if (councilTax) {
    notes.push(`EXTRACTED FROM PAGE HTML — Council Tax Band: ${councilTax}`);
  }
  if (landRegistry && landRegistry.entries.length) {
    const lines = landRegistry.entries.map(
      (p) => `Sold ${p.date}: £${p.price.toLocaleString("en-GB")}`,
    );
    notes.push(`LAND REGISTRY PRICE HISTORY (official data):\n${lines.join("\n")}`);
  }
  if (floodRisk && !floodRisk.scotland && !floodRisk.unavailable) {
    const lines: string[] = [
      `Rivers and sea: ${floodRisk.riversAndSea ?? "Unknown"}`,
      `Surface water: ${floodRisk.surfaceWater ?? "Unknown"}`,
      `Reservoir: ${floodRisk.reservoir == null ? "Unknown" : floodRisk.reservoir ? "Yes" : "No"}`,
      `Groundwater: ${floodRisk.groundwater ?? "Unknown"}`,
      `Overall (highest of rivers/surface/groundwater): ${floodRisk.overallRisk ?? "Unknown"}`,
    ];
    notes.push(`ENVIRONMENT AGENCY FLOOD RISK (official data — use these values verbatim in floodRisk and write a 2-3 sentence commentary; set autoRedFlag=true only if Rivers/Sea is High):\n${lines.join("\n")}`);
  }
  if (text && notes.length) {
    text = `${notes.join("\n")}\n\n${text}`.slice(0, 25_700);
  }

  // 3. Cache successful listing text.
  if (text && text.length >= 200) {
    try {
      await supabaseAdmin
        .from("listing_cache")
        .upsert(
          { url, text_content: text, fetched_at: new Date().toISOString() },
          { onConflict: "url" },
        );
    } catch (err) {
      console.error("[analyseListing] cache upsert failed:", err);
    }
  }

  return { text, landRegistry, scotland, postcode, floodRisk, nearbySchools };
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

  // 2. Authenticated session: Buyer Pass OR Single Report by email
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
            .select("email, expires_at")
            .ilike("email", email)
            .maybeSingle();
          if (row) {
            const expiresAt = (row as { expires_at: string | null }).expires_at;
            if (!expiresAt || new Date(expiresAt).getTime() > Date.now()) return true;
          }
          // Single Report tied to this email
          const { data: sr } = await supabaseAdmin
            .from("single_report_tokens")
            .select("expires_at")
            .ilike("user_email", email)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          if (sr) {
            const exp = (sr as { expires_at: string }).expires_at;
            if (!exp || new Date(exp).getTime() > Date.now()) return true;
          }
        }
      } catch {
        /* ignore */
      }
    }
  }

  return false;
}

// Free tier: keep real costs and negotiation values so the UI can render them
// behind a visual blur/lock overlay. Only strip the truly premium narrative
// content (extra red flags, viewing questions, comparables) that has no
// "shape" to obscure visually.
function toPreview(a: AnalysisResult): AnalysisResult {
  return {
    ...a,
    redFlags: a.redFlags.slice(0, 2),
    viewingQuestions: [],
    comparables: [],
    nearbySchools: null,
    renovationCosts: null,
  };
}

// In-memory dedupe for concurrent analyses of the same URL.
// - inflight: pending promise for an in-progress analysis (same isolate)
// - recent: completed result kept for 60s so a second tab opening the same
//   URL returns immediately instead of re-running Claude.
type FullAnalysis = AnalysisResult;
const inflightAnalyses = new Map<string, Promise<FullAnalysis>>();
const recentAnalyses = new Map<string, { at: number; full: FullAnalysis }>();
const ANALYSIS_DEDUPE_TTL_MS = 60_000;

async function runAnalysis(
  url: string,
  pastedText: string,
  apiKey: string,
): Promise<FullAnalysis> {
  let listingContent = pastedText;
  let landRegistry: LandRegistryResult = null;
  let scotland = false;
  let floodRiskRaw: FloodRiskRaw | null = null;
  let nearbySchoolsRaw: NearbySchoolsRaw | null = null;
  if (!listingContent && url) {
    console.log(`[runAnalysis] Fetching listing content for ${url}...`);
    const fetched = await fetchListingText(url);
    listingContent = fetched.text;
    landRegistry = fetched.landRegistry;
    scotland = fetched.scotland;
    floodRiskRaw = fetched.floodRisk;
    nearbySchoolsRaw = fetched.nearbySchools;
    console.log(`[runAnalysis] Listing content fetched, length: ${listingContent?.length ?? 0}`);
  }
  if (!listingContent || listingContent.length < 100) {
    throw new Error(
      "FETCH_BLOCKED: We couldn't automatically read this listing. You can paste the listing description below to get your full analysis."
    );
  }

  let output: z.infer<typeof analysisSchema>;
  const client = new Anthropic({ apiKey, timeout: 120_000, maxRetries: 1 });
  const userContent = `Listing URL: ${url || "(pasted text only)"}\n\nListing content:\n${listingContent}`;

  const cleanResponse = (raw: string) =>
    raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");

  const tryRepairJson = (text: string): string => {
    // Strip trailing incomplete content after the last complete field.
    let s = text;
    // Drop a trailing partial token like `, "key": "abc` or `, "key":`
    const lastComma = s.lastIndexOf(",");
    const lastBrace = s.lastIndexOf("}");
    if (lastBrace < lastComma) {
      s = s.slice(0, lastComma);
    }
    // Balance braces and brackets
    let curly = 0;
    let square = 0;
    let inStr = false;
    let esc = false;
    for (const ch of s) {
      if (esc) { esc = false; continue; }
      if (ch === "\\") { esc = true; continue; }
      if (ch === '"') { inStr = !inStr; continue; }
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
  };

  const callClaude = async (system: string, maxTokens: number) => {
    const message = await client.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: userContent }],
    });
    return message.content[0].type === "text" ? message.content[0].text : "";
  };

  const parseWithRepair = (raw: string) => {
    const cleaned = cleanResponse(raw);
    const endsClean = cleaned.endsWith("}") || cleaned.endsWith("}}");
    if (!endsClean) {
      console.warn(
        "[analyseListing] Claude response appears truncated; attempting JSON repair."
      );
      const repaired = tryRepairJson(cleaned);
      return JSON.parse(repaired);
    }
    try {
      return JSON.parse(cleaned);
    } catch (e) {
      console.warn("[analyseListing] JSON.parse failed; attempting repair.", e);
      return JSON.parse(tryRepairJson(cleaned));
    }
  };

  try {
    let parsed: unknown;
    try {
      console.log("[runAnalysis] Calling Claude API...");
      const responseText = await callClaude(SYSTEM_PROMPT, 6000);
      console.log(`[runAnalysis] Claude response received, length: ${responseText.length}`);
      console.log("[runAnalysis] Parsing JSON response...");
      parsed = parseWithRepair(responseText);
    } catch (primaryErr) {
      console.error(
        "[runAnalysis] Primary analysis parse failed, retrying with simplified schema (no renovationCosts).",
        primaryErr
      );
      const simplifiedPrompt =
        SYSTEM_PROMPT +
        "\n\nIMPORTANT OVERRIDE: Omit the renovationCosts field entirely from your JSON response to keep it compact. Set it to null.";
      console.log("[runAnalysis] Calling Claude API (fallback)...");
      const fallbackText = await callClaude(simplifiedPrompt, 6000);
      console.log(`[runAnalysis] Claude fallback response received, length: ${fallbackText.length}`);
      console.log("[runAnalysis] Parsing fallback JSON response...");
      const fallbackParsed = parseWithRepair(fallbackText) as Record<string, unknown>;
      fallbackParsed.renovationCosts = null;
      parsed = fallbackParsed;
    }
    output = analysisSchema.parse(parsed);
  } catch (err: unknown) {
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

  if (landRegistry && landRegistry.entries.length) {
    const existing = full.priceHistory ?? {
      entries: null,
      firstSalePrice: null,
      firstSaleDate: null,
      totalAppreciation: null,
      annualGrowthRate: null,
      yearsHeld: null,
      commentary: "",
    };
    full.priceHistory = {
      ...existing,
      entries: landRegistry.entries,
      source: "land_registry",
      nearbyMode: false,
    };
  } else if (!scotland) {
    full.priceHistory = null;
  }

  if (scotland) {
    full.priceHistory = {
      entries: null,
      firstSalePrice: null,
      firstSaleDate: null,
      totalAppreciation: null,
      annualGrowthRate: null,
      yearsHeld: null,
      commentary: "",
      scotland: true,
    };
  }

  if (floodRiskRaw) {
    if (floodRiskRaw.scotland) {
      full.floodRisk = {
        riversAndSea: null,
        surfaceWater: null,
        reservoir: null,
        groundwater: null,
        overallRisk: null,
        commentary: "",
        autoRedFlag: false,
        scotland: true,
      };
    } else if (floodRiskRaw.unavailable) {
      full.floodRisk = {
        riversAndSea: null,
        surfaceWater: null,
        reservoir: null,
        groundwater: null,
        overallRisk: null,
        commentary: "",
        autoRedFlag: false,
        unavailable: true,
      };
    } else {
      const aiFlood = full.floodRisk;
      const overall = floodRiskRaw.overallRisk;
      const isHighRivers = (floodRiskRaw.riversAndSea ?? "").toLowerCase() === "high";
      full.floodRisk = {
        riversAndSea: floodRiskRaw.riversAndSea,
        surfaceWater: floodRiskRaw.surfaceWater,
        reservoir: floodRiskRaw.reservoir,
        groundwater: floodRiskRaw.groundwater,
        overallRisk: overall,
        commentary: aiFlood?.commentary ?? "",
        autoRedFlag: isHighRivers,
      };
      if (isHighRivers) {
        const title = "High flood risk — insurance and mortgage implications";
        if (!full.redFlags.some((f) => f.title === title)) {
          full.redFlags = [
            {
              severity: "high",
              title,
              detail:
                "This property is in a High flood risk zone according to the Environment Agency. Buildings insurance may be significantly more expensive, refused, or subject to exclusions. Some mortgage lenders require flood resilience measures as a condition of lending. Check the Flood Re scheme eligibility and get a specialist flood insurance quote before proceeding.",
            },
            ...full.redFlags,
          ];
        }
      }
    }
  } else {
    full.floodRisk = null;
  }

  if (nearbySchoolsRaw) {
    full.nearbySchools = {
      schools: nearbySchoolsRaw.schools,
      unavailable: nearbySchoolsRaw.unavailable ?? false,
    };
  } else {
    full.nearbySchools = null;
  }

  return full;
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

    if (url) {
      try {
        validateListingUrl(url);
      } catch (e) {
        throw e instanceof Error ? e : new Error("INVALID_URL: Unsupported URL.");
      }
    }

    // Dedupe concurrent / rapid-repeat analyses for the same URL.
    // Pasted-text submissions skip the cache (content varies per call).
    let full: FullAnalysis;
    if (url && !pastedText) {
      const cached = recentAnalyses.get(url);
      if (cached && Date.now() - cached.at < ANALYSIS_DEDUPE_TTL_MS) {
        console.log("[analyseListing] returning cached result", { url, ageMs: Date.now() - cached.at });
        full = cached.full;
      } else {
        const existing = inflightAnalyses.get(url);
        if (existing) {
          console.log("[analyseListing] joining in-flight analysis", { url });
          full = await existing;
        } else {
          const promise = runAnalysis(url, pastedText, apiKey)
            .then((result) => {
              recentAnalyses.set(url, { at: Date.now(), full: result });
              return result;
            })
            .finally(() => {
              inflightAnalyses.delete(url);
            });
          inflightAnalyses.set(url, promise);
          full = await promise;
        }
      }
    } else {
      full = await runAnalysis(url, pastedText, apiKey);
    }

    const unlocked = await hasFullAccess({
      accessToken: data.accessToken ?? null,
      sessionJwt: data.sessionJwt ?? null,
      listingUrl: url || null,
    });

    return unlocked ? full : toPreview(full);
  });

// =====================================================================
// Async job pipeline
//
// The synchronous analyseListing path can take 30–90s end-to-end, which
// exceeds the Cloudflare Worker request budget on heavier listings. The
// pattern below splits the work in two:
//
//   1. startAnalysisJob — inserts a `pending` row, schedules the long
//      analysis via ctx.waitUntil so it survives past the response,
//      and returns the job id within ~1s.
//   2. getAnalysisJob  — polled by the client every 2s; returns the
//      current status + result once `complete`.
//
// Gating (preview vs full) is applied at READ time in getAnalysisJob, so
// the stored result_json is always the full analysis.
// =====================================================================

async function processAnalysisJob(
  jobId: string,
  url: string,
  pastedText: string,
): Promise<void> {
  console.log(`[processAnalysisJob] started for jobId: ${jobId}`);
  let step = "init";
  try {
    step = "read-api-key";
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error("Analysis service is temporarily unavailable. Please try again shortly.");
    }
    let full: FullAnalysis;
    if (url && !pastedText) {
      const cached = recentAnalyses.get(url);
      if (cached && Date.now() - cached.at < ANALYSIS_DEDUPE_TTL_MS) {
        console.log(`[processAnalysisJob] using cached analysis for ${url}`);
        full = cached.full;
      } else {
        const existing = inflightAnalyses.get(url);
        if (existing) {
          console.log(`[processAnalysisJob] joining in-flight analysis for ${url}`);
          full = await existing;
        } else {
          step = "run-analysis";
          const promise = runAnalysis(url, pastedText, apiKey)
            .then((result) => {
              recentAnalyses.set(url, { at: Date.now(), full: result });
              return result;
            })
            .finally(() => {
              inflightAnalyses.delete(url);
            });
          inflightAnalyses.set(url, promise);
          full = await promise;
        }
      }
    } else {
      step = "run-analysis";
      full = await runAnalysis(url, pastedText, apiKey);
    }

    step = "update-job-row";
    console.log(`[processAnalysisJob] Analysis complete, updating job row ${jobId}...`);
    const { error: updateError } = await supabaseAdmin
      .from("analysis_jobs")
      .update({
        status: "complete",
        result_json: JSON.parse(JSON.stringify(full)),
        updated_at: new Date().toISOString(),
      })
      .eq("id", jobId);
    if (updateError) {
      throw new Error(`DB update failed: ${updateError.message}`);
    }
    console.log(`[processAnalysisJob] job ${jobId} marked complete`);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Analysis failed";
    console.error(`[processAnalysisJob] Error at ${step} for jobId ${jobId}: ${message}`, err);
    try {
      await supabaseAdmin
        .from("analysis_jobs")
        .update({
          status: "error",
          error: `[${step}] ${message}`,
          updated_at: new Date().toISOString(),
        })
        .eq("id", jobId);
    } catch (updateErr) {
      console.error(`[processAnalysisJob] failed to record error for jobId ${jobId}`, updateErr);
    }
  }
}

export const startAnalysisJob = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      url: z.string().max(2000).optional(),
      text: z.string().max(50000).optional(),
      accessToken: z.string().max(200).optional().nullable(),
      sessionJwt: z.string().max(4000).optional().nullable(),
    })
  )
  .handler(async ({ data }): Promise<{ jobId: string }> => {
    const url = data.url?.trim() ?? "";
    const pastedText = data.text?.trim() ?? "";
    if (!url && !pastedText) throw new Error("Provide a listing URL or pasted text");

    if (url) {
      try {
        validateListingUrl(url);
      } catch (e) {
        throw e instanceof Error ? e : new Error("INVALID_URL: Unsupported URL.");
      }
    }

    const { data: row, error } = await supabaseAdmin
      .from("analysis_jobs")
      .insert({
        url: url || "(pasted text)",
        pasted_text: pastedText || null,
        access_token: data.accessToken ?? null,
        session_jwt: data.sessionJwt ?? null,
        status: "pending",
      })
      .select("id")
      .single();

    if (error || !row) {
      console.error("[startAnalysisJob] insert failed", error);
      throw new Error("Failed to start analysis. Please try again.");
    }

    const jobId = row.id as string;
    console.log(`[startAnalysisJob] Invoking analyse-listing Edge Function for jobId:`, jobId);
    console.log(`[startAnalysisJob] env present:`, {
      hasSupabaseUrl: !!process.env.SUPABASE_URL,
      hasServiceRoleKey: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    });

    // Try invoking the Edge Function. We await the result so we actually
    // observe network/auth failures synchronously (a true fire-and-forget
    // promise can be cancelled when the Worker shuts down). The Edge Function
    // itself updates the analysis_jobs row when it finishes.
    let invokeFailed = false;
    let invokeErrorMessage = "";
    try {
      const result = await supabaseAdmin.functions.invoke("analyse-listing", {
        body: { jobId, url, pastedText },
      });
      console.log(`[startAnalysisJob] Edge Function invoke result:`, JSON.stringify({
        hasData: !!result.data,
        error: result.error ? String(result.error?.message ?? result.error) : null,
      }));
      if (result.error) {
        invokeFailed = true;
        invokeErrorMessage = String(result.error?.message ?? result.error);
      }
    } catch (err) {
      invokeFailed = true;
      invokeErrorMessage = err instanceof Error ? err.message : String(err);
      console.error(`[startAnalysisJob] Edge Function invoke failed:`, invokeErrorMessage);
    }

    if (invokeFailed) {
      console.warn(`[startAnalysisJob] Falling back to in-process analysis for ${jobId}`);
      try {
        await processAnalysisJob(jobId, url, pastedText, data.accessToken ?? null, data.sessionJwt ?? null);
      } catch (fallbackErr) {
        const msg = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
        console.error(`[startAnalysisJob] fallback analysis failed for ${jobId}:`, msg);
        await supabaseAdmin
          .from("analysis_jobs")
          .update({
            status: "error",
            error: `Failed to start analysis: ${invokeErrorMessage}; fallback failed: ${msg}`,
            updated_at: new Date().toISOString(),
          })
          .eq("id", jobId);
      }
    }

    return { jobId };
  });

export const getAnalysisJob = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      jobId: z.string().uuid(),
      sessionJwt: z.string().max(4000).optional().nullable(),
    })
  )
  .handler(async ({ data }): Promise<{
    status: "pending" | "complete" | "error";
    analysis: AnalysisResult | null;
    error: string | null;
  }> => {
    const { data: row, error } = await supabaseAdmin
      .from("analysis_jobs")
      .select("status, result_json, error, url, access_token")
      .eq("id", data.jobId)
      .maybeSingle();

    if (error || !row) {
      return { status: "error", analysis: null, error: "Job not found." };
    }

    const status = (row.status as "pending" | "complete" | "error") ?? "pending";
    if (status !== "complete" || !row.result_json) {
      return { status, analysis: null, error: (row.error as string | null) ?? null };
    }

    const full = row.result_json as unknown as FullAnalysis;
    const unlocked = await hasFullAccess({
      accessToken: (row.access_token as string | null) ?? null,
      sessionJwt: data.sessionJwt ?? null,
      listingUrl: (row.url as string | null) ?? null,
    });

    return {
      status: "complete",
      analysis: unlocked ? full : toPreview(full),
      error: null,
    };
  });
